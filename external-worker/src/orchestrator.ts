/**
 * Orchestrator — Coordinates subagents to build a project
 *
 * Flow:
 * 1. Orchestrator reads the user prompt + worklog + manifest
 * 2. Orchestrator creates a build plan (which agents to call, in what order)
 * 3. For each step in the plan:
 *    a. Get the agent config (role, tools, system prompt)
 *    b. Filter tools to only allowed ones
 *    c. Run generateText with that agent's config
 *    d. Collect the result
 * 4. Return the final result (files from Builder, verification from Tester)
 *
 * In Phase 1, we use a DEFAULT_AGENT_FLOW (Researcher → Builder → Tester)
 * instead of asking the Orchestrator LLM to plan. This is simpler and
 * more reliable. The Orchestrator LLM planning can be added in Phase 2.
 */

import { streamText, type LanguageModelV1, type ToolSet } from 'ai';
import { createAgentTools, resetProjectFiles, getProjectFiles } from './agent-tools';
import { filterTools, getAgentConfig, DEFAULT_AGENT_FLOW, type AgentRole } from './agent-registry';
import { logger } from './logger';
import { emitEvent } from './event-emitter';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FileOperation } from './generator';
import {
  readWorklog,
  appendToWorklog,
  readManifest,
  writeManifest,
  generateWorklogEntry,
  generateSmartManifest,
  writePalmkitMemory,
} from './workspace-manager';

export interface OrchestratorResult {
  success: boolean;
  files: FileOperation[];
  rawText: string;
  totalDuration: number;
  agentResults: Array<{ role: AgentRole; success: boolean; text: string; duration: number }>;
}

/**
 * Run the full agent pipeline: Researcher → Builder → Tester
 *
 * Each agent gets its own generateText call with filtered tools.
 * The Researcher's output is passed as context to the Builder.
 * The Builder's output (files) is passed to the Tester.
 */
export async function runOrchestratedBuild(
  prompt: string,
  model: LanguageModelV1,
  jobId: string,
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  maxCompletionTokens?: number,
  appType?: string,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  resetProjectFiles();

  logger.info(`[orchestrator] Starting orchestrated build for job ${jobId} (project ${projectId})`);

  // Read worklog for context
  const worklog = await readWorklog(projectId);
  const hasWorklog = !!worklog;

  // Create all tools (shared across agents, filtered per agent)
  const allTools = createAgentTools(jobId, supabase, projectId);

  // Keep-alive timer (every 10s instead of 5s to reduce Realtime events)
  const keepAlive = setInterval(async () => {
    try {
      await emitEvent(
        supabase,
        jobId,
        'file_chunk' as any,
        `⏳ Building... (${Math.round((Date.now() - startTime) / 1000)}s)`,
      );
    } catch {
      /* best-effort */
    }
  }, 10000);

  // Hard-cap the whole orchestrator at 20 minutes.
  //
  // 8 minutes was too tight (real projects need Builder + Tester + npm install
  // + npm run build which alone can take 5-7 min on cold E2B sandboxes).
  // 15 minutes still wasn't enough for complex 15+ file React projects with
  // GLM-5.x (which tends to not call done() proactively and burns steps).
  //
  // 20 minutes gives enough headroom for the largest reasonable projects
  // while still bounding hung LLM providers.
  //
  // Note: the throw here crashes the worker process. systemd's Restart=always
  // brings it back up in ~5s, but the in-flight job is lost. The job_processor
  // catch block marks the job as failed_clean. Future improvement: use
  // AbortController.signal passed to streamText so we can cancel the LLM
  // request without crashing the worker.
  const HARD_TIMEOUT_MS = 20 * 60 * 1000;
  const hardTimeout = setTimeout(() => {
    logger.error(`[orchestrator] Hard timeout (${HARD_TIMEOUT_MS}ms) reached for job ${jobId}`);
    throw new Error(`Build exceeded ${HARD_TIMEOUT_MS / 1000}s timeout`);
  }, HARD_TIMEOUT_MS);

  const agentResults: OrchestratorResult['agentResults'] = [];
  let researcherContext = '';
  let builderContext = '';
  let testerContext = '';
  let overallSuccess = false;

  try {
    for (const role of DEFAULT_AGENT_FLOW) {
      const config = getAgentConfig(role);

      /*
       * TOKEN OPTIMIZATION: Skip Researcher for new projects (no worklog).
       * Researcher is only useful when editing existing projects — it reads
       * files and searches code. For a new project, there's nothing to read.
       * Skipping it saves ~5 LLM calls (5 maxSteps × 4000 tokens = 20K tokens).
       */
      if (role === 'researcher' && !hasWorklog) {
        logger.info('[orchestrator] Skipping Researcher (new project, nothing to read)');
        await emitEvent(
          supabase,
          jobId,
          'file_chunk' as any,
          '⏭️ Skipping Researcher (new project)',
        );
        continue;
      }

      const agentTools = filterTools(allTools as unknown as ToolSet, config.allowedTools);

      // Build the agent's prompt (includes context from previous agents)
      let agentPrompt = prompt;

      if (role === 'researcher' && hasWorklog) {
        agentPrompt = `${prompt}\n\nPROJECT MEMORY (worklog.md):\n${worklog}`;
      }

      if (role === 'builder' && researcherContext) {
        agentPrompt = `${prompt}\n\nRESEARCHER FINDINGS:\n${researcherContext}\n\nNow build the project based on these findings and the user's request.`;
      }

      if (role === 'tester' && builderContext) {
        agentPrompt = `The Builder has finished creating the project. Here's the summary:\n${builderContext}\n\nNow verify the project works. The files are already written — just run the build, tests, and screenshot.`;
      }

      logger.info(`[orchestrator] Running ${config.name} agent (maxSteps=${config.maxSteps})`);

      // Emit agent_started — lets the activity stream UI open a new group for this agent.
      await emitEvent(
        supabase,
        jobId,
        'agent_started',
        `🤖 ${config.name} agent starting...`,
        { agent: config.name, role },
      );

      const agentStart = Date.now();

      /*
       * Token budget per step.
       *
       * The old code did Math.min(config.maxTokens, maxCompletionTokens ?? config.maxTokens)
       * — which means if maxCompletionTokens was undefined (model didn't expose it),
       * we got config.maxTokens (was 12000). And if maxCompletionTokens WAS set
       * (e.g. 65536 for GLM-5.2), we still got Math.min(32000, 65536) = 32000.
       * Either way, large models were capped at the registry floor.
       *
       * The fix: prefer maxCompletionTokens (the model's actual limit). Only fall
       * back to config.maxTokens when it's missing. Never Math.min — the registry
       * floor is already conservative.
       */
      const stepMaxTokens = maxCompletionTokens ?? config.maxTokens;

      /*
       * providerOptions for OpenRouter reasoning support.
       *
       * OpenRouter's API accepts `reasoning: { enabled: true }` in the request
       * body. For models that support reasoning (DeepSeek-R1, GLM-4.7+,
       * Claude thinking, o1/o3, etc.), this makes the model emit reasoning
       * tokens alongside regular text. For models that don't support it,
       * OpenRouter silently ignores the parameter — so it's always safe to
       * pass.
       *
       * We always pass it for OpenRouter (no regex check) because:
       * 1. OpenRouter itself decides whether to use it based on model capability
       * 2. Even GLM-4.7 supports reasoning — the old regex missed it
       * 3. Harmless for non-reasoning models
       */
      const providerOptions = { openrouter: { reasoning: { enabled: true } } };

      /*
       * STREAMING — use streamText (not generateText) so the LLM's text and
       * reasoning tokens arrive as live delta chunks. This is what makes the
       * "Thought Process" panel stream in real-time, exactly like Claude Code
       * / Cursor / Super Z.
       *
       * We iterate result.fullStream to consume every chunk:
       *   - text-delta  → the model's regular text output (narration between
       *                   tool calls). This IS the reasoning the user sees.
       *   - reasoning   → dedicated reasoning tokens (for models that support
       *                   a separate reasoning channel, e.g. DeepSeek-R1).
       *   - tool-call   → the model is requesting a tool execution. We emit
       *                   a tool-specific event for tools that don't emit
       *                   their own (read_file, run_shell, etc.). Tools that
       *                   DO emit their own (write_file, update_todos, done)
       *                   are skipped here to avoid duplication.
       *   - step-finish → a step boundary. Flush the text buffer and increment
       *                   the stepId so the next text-delta starts a new
       *                   reasoning entry in the client UI.
       *   - finish      → the entire stream is done. Capture finishReason.
       *   - error       → stream error. Log and rethrow.
       *
       * The text buffer is flushed every 500ms (or on step-finish / tool-call)
       * so the user sees live streaming without flooding the event system.
       */
      let stepId = 0;
      let textBuffer = '';
      let lastFlushTime = Date.now();
      const FLUSH_INTERVAL_MS = 500;

      const flushText = async (isFinal: boolean) => {
        if (textBuffer.length === 0) {
          return;
        }

        const text = textBuffer;
        textBuffer = '';

        try {
          await emitEvent(
            supabase,
            jobId,
            'reasoning',
            `💭 ${config.name}: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`,
            {
              agent: config.name,
              role,
              text,
              stepId,
              isFinal,
            },
          );
        } catch {
          /* best-effort */
        }
      };

      /*
       * Tools that emit their OWN events from inside their execute() function.
       * We do NOT emit orchestrator-level events for these to avoid duplication.
       * Tools NOT in this set get an orchestrator-level event on tool-call.
       */
      const SELF_EMITTING_TOOLS = new Set([
        'write_file',
        'edit_file',
        'delete_file',
        'update_todos',
        'done',
      ]);

      const emitToolEvent = async (toolName: string, args: any) => {
        try {
          if (toolName === 'read_file') {
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `📖 [${config.name}] Read: ${args.path}`,
              { agent: config.name, kind: 'read', path: args.path },
            );
          } else if (toolName === 'search_code') {
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `🔍 [${config.name}] Search: ${args.pattern}`,
              { agent: config.name, kind: 'search', pattern: args.pattern },
            );
          } else if (toolName === 'list_files') {
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `📋 [${config.name}] List files`,
              { agent: config.name, kind: 'list' },
            );
          } else if (toolName === 'list_uploads') {
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `📤 [${config.name}] List uploads`,
              { agent: config.name, kind: 'list_uploads' },
            );
          } else if (toolName === 'run_shell') {
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `⚡ [${config.name}] Run: ${args.command?.slice(0, 80)}`,
              { agent: config.name, kind: 'shell', command: args.command },
            );
          } else if (toolName === 'run_tests') {
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `🧪 [${config.name}] Run tests`,
              { agent: config.name, kind: 'tests' },
            );
          } else if (toolName === 'take_screenshot') {
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `📸 [${config.name}] Screenshot`,
              { agent: config.name, kind: 'screenshot' },
            );
          }
        } catch {
          /* best-effort */
        }
      };

      const streamResult = streamText({
        model,
        system: config.systemPrompt,
        prompt: agentPrompt,
        tools: agentTools,
        maxSteps: config.maxSteps,
        temperature: 0.7,
        maxTokens: stepMaxTokens,
        providerOptions,
      });

      let streamError: Error | null = null;

      try {
        for await (const part of streamResult.fullStream) {
          switch (part.type) {
            /*
             * text-delta — the model's regular text output.
             * For tool-using models, this is the narration between tool calls
             * ("Let me create the App.tsx file now..."). This IS the reasoning
             * the user wants to see streaming live.
             */
            case 'text-delta': {
              textBuffer += part.textDelta;

              if (Date.now() - lastFlushTime > FLUSH_INTERVAL_MS) {
                await flushText(false);
                lastFlushTime = Date.now();
              }

              break;
            }

            /*
             * reasoning — dedicated reasoning tokens (separate from text).
             * Models like DeepSeek-R1 emit these via a special channel.
             * We treat them the same as text-delta — both go into the
             * Thought Process panel.
             */
            case 'reasoning': {
              textBuffer += part.textDelta;

              if (Date.now() - lastFlushTime > FLUSH_INTERVAL_MS) {
                await flushText(false);
                lastFlushTime = Date.now();
              }

              break;
            }

            /*
             * tool-call — the model is requesting a tool execution.
             * Flush any accumulated text first (closes the current reasoning
             * bubble), then emit a tool-specific event for tools that don't
             * emit their own.
             *
             * Note: the tool's execute() function runs AFTER this part
             * (during the tool-result phase). Tools that emit their own
             * events (write_file, update_todos, etc.) will fire their events
             * during execution — we don't duplicate them here.
             */
            case 'tool-call': {
              await flushText(true);

              if (!SELF_EMITTING_TOOLS.has(part.toolName)) {
                await emitToolEvent(part.toolName, part.args);
              }

              break;
            }

            /*
             * step-finish — a step boundary (one LLM call + tool executions
             * completed). Flush remaining text and increment stepId so the
             * next text-delta starts a fresh reasoning entry in the client.
             */
            case 'step-finish': {
              await flushText(true);
              stepId++;
              break;
            }

            /*
             * finish — the entire stream is done (all steps completed).
             * Flush any remaining text.
             */
            case 'finish': {
              await flushText(true);
              break;
            }

            /*
             * error — the stream encountered an error. Capture it and break
             * out of the loop. We rethrow after the loop so the outer
             * try/catch can handle it.
             */
            case 'error': {
              logger.error(`[orchestrator] Stream error in ${config.name}: ${part.error}`);
              streamError = part.error instanceof Error
                ? part.error
                : new Error(String(part.error));
              break;
            }

            default:
              // Other part types (tool-call-streaming-start, tool-call-delta,
              // tool-result, step-start, source, file, reasoning-signature,
              // redacted-reasoning) — not relevant to event emission.
              break;
          }

          if (streamError) {
            break;
          }
        }
      } catch (streamErr) {
        streamError = streamErr instanceof Error
          ? streamErr
          : new Error(String(streamErr));
      }

      if (streamError) {
        throw streamError;
      }

      /*
       * After the stream completes, access the final values.
       * These are Promises in streamText (unlike generateText where they're
       * synchronous). Await them to get the actual values.
       */
      const agentText = await streamResult.text;
      const finishReason = await streamResult.finishReason;
      const steps = await streamResult.steps;

      const agentDuration = Date.now() - agentStart;
      /*
       * Success criteria — only true when the LLM finished cleanly AND made at
       * least one tool call. The old code (result.finishReason !== 'error')
       * treated 'length' (token-cap truncation) and 'tool-calls' (maxSteps hit)
       * as success — so a builder that hit maxSteps=30 mid-way through file 8
       * was reported as "succeeded" even though the project was incomplete.
       *
       * Now we explicitly fail on 'length' (truncated mid-file) and 'tool-calls'
       * (hit step limit, didn't reach done()). The orchestrator's overallSuccess
       * check still requires fileCount > 0.
       */
      const madeToolCalls = (steps?.length ?? 0) > 0;
      const agentSuccess =
        finishReason !== 'error' &&
        finishReason !== 'length' &&
        (finishReason !== 'tool-calls' || madeToolCalls);

      if (finishReason === 'length') {
        logger.warn(
          `[orchestrator] ${config.name} hit token cap (finishReason=length) — output truncated. Consider raising maxTokens.`,
        );
        await emitEvent(
          supabase,
          jobId,
          'file_chunk' as any,
          `⚠️ ${config.name} hit token cap — output may be truncated.`,
        );
      } else if (finishReason === 'tool-calls') {
        logger.warn(
          `[orchestrator] ${config.name} hit maxSteps (${config.maxSteps}) — agent did not call done().`,
        );
        await emitEvent(
          supabase,
          jobId,
          'file_chunk' as any,
          `⚠️ ${config.name} reached step limit (${config.maxSteps}) — continuing with what was built.`,
        );
      }

      agentResults.push({
        role,
        success: agentSuccess,
        text: agentText,
        duration: agentDuration,
      });

      logger.info(
        `[orchestrator] ${config.name} finished: ${finishReason}, ${agentText.length} chars, ${agentDuration}ms`,
      );

      // Store context for next agent
      if (role === 'researcher') {
        researcherContext = agentText;
      } else if (role === 'builder') {
        builderContext = agentText;
      } else if (role === 'tester') {
        testerContext = agentText;
      }

      // Emit agent_completed — closes the activity stream group for this agent.
      await emitEvent(
        supabase,
        jobId,
        'agent_completed',
        `✅ ${config.name} agent completed (${(agentDuration / 1000).toFixed(1)}s)`,
        { agent: config.name, role, durationMs: agentDuration, success: agentSuccess },
      );
    }

    // Check final result
    const files = getProjectFiles() as Record<string, string>;
    const fileCount = Object.keys(files).length;
    overallSuccess = fileCount > 0;

    logger.info(
      `[orchestrator] Build finished: ${fileCount} files, ${agentResults.length} agents ran`,
    );

    // Write worklog + manifest + .palmkit/ memory
    if (overallSuccess) {
      const totalSize = Object.values(files).reduce((s: number, c: string) => s + c.length, 0);
      const duration = Date.now() - startTime;
      const summary = testerContext || builderContext.slice(-500) || undefined;

      await emitEvent(
        supabase,
        jobId,
        'file_generation_completed' as any,
        `🚀 Orchestrated build complete: ${fileCount} files, ${totalSize} chars, ${agentResults.length} agents`,
        { fileCount, agents: agentResults.map((a) => a.role) },
      );

      try {
        // 1. Worklog
        const worklogEntry = generateWorklogEntry({
          prompt,
          fileCount,
          totalSize,
          summary,
          appType,
          duration,
        });
        await appendToWorklog(projectId, worklogEntry, supabase, userId);

        // 2. Smart manifest
        const smartManifest = generateSmartManifest({
          projectId,
          appType: appType ?? null,
          files,
          prompt,
          summary,
        });

        const manifest = await readManifest(projectId);
        manifest.lastBuildAt = new Date().toISOString();
        manifest.lastBuildSummary = summary?.slice(0, 200) || null;
        manifest.fileCount = fileCount;
        manifest.appType = appType ?? manifest.appType;
        manifest.schemaVersion = smartManifest.schemaVersion;
        manifest.projectType = smartManifest.projectType;
        manifest.stack = smartManifest.stack;
        manifest.entrypoints = smartManifest.entrypoints;
        manifest.importantFiles = smartManifest.importantFiles;
        manifest.commands = smartManifest.commands;
        manifest.apiRoutes = smartManifest.apiRoutes;
        manifest.qualityGates = smartManifest.qualityGates;
        manifest.lastKnownStatus = testerContext.includes('build pass')
          ? 'build_passed'
          : 'build_unknown';
        manifest.knownIssues = smartManifest.knownIssues;
        await writeManifest(manifest, supabase, userId);

        // 3. .palmkit/ memory layer
        await writePalmkitMemory(
          projectId,
          { prompt, files, appType: appType ?? null, summary, manifest: smartManifest },
          supabase,
          userId,
        );

        logger.info(`[orchestrator] Worklog + manifest + .palmkit/ memory updated for ${projectId}`);
      } catch (e) {
        logger.warn(`[orchestrator] Failed to update memory: ${e}`);
      }
    }

    // Convert files to FileOperation[] format
    const fileOps: FileOperation[] = Object.entries(getProjectFiles()).map(([path, content]) => ({
      op: 'write_file' as const,
      path,
      content,
    }));

    return {
      success: overallSuccess,
      files: fileOps,
      rawText: agentResults.map((a) => `[${a.role}]: ${a.text.slice(0, 200)}`).join('\n\n'),
      totalDuration: Date.now() - startTime,
      agentResults,
    };
  } catch (err) {
    logger.error(`[orchestrator] Build failed: ${err instanceof Error ? err.message : String(err)}`);

    const errFiles = getProjectFiles() as Record<string, string>;
    const errFileOps: FileOperation[] = Object.entries(errFiles).map(([path, content]) => ({
      op: 'write_file' as const,
      path,
      content,
    }));

    return {
      success: errFileOps.length > 0,
      files: errFileOps,
      rawText: `orchestrator-error: ${err instanceof Error ? err.message : String(err)}`,
      totalDuration: Date.now() - startTime,
      agentResults,
    };
  } finally {
    clearInterval(keepAlive);
    clearTimeout(hardTimeout);
  }
}
