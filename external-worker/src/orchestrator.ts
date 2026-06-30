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

import { generateText, type LanguageModelV1, type ToolSet } from 'ai';
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

      // Emit event for UI
      await emitEvent(
        supabase,
        jobId,
        'file_chunk' as any,
        `🤖 ${config.name} agent starting...`,
      );

      const agentStart = Date.now();

      const result = await generateText({
        model,
        system: config.systemPrompt,
        prompt: agentPrompt,
        tools: agentTools,
        maxSteps: config.maxSteps,
        temperature: 0.7,
        maxTokens: Math.min(config.maxTokens, maxCompletionTokens ?? config.maxTokens),
        onStepFinish: async ({ toolCalls, text }) => {
          for (const tc of toolCalls) {
            const toolName = tc.toolName;
            const args = tc.args as any;

            let msg = '';
            if (toolName === 'write_file') {
              msg = `📝 [${config.name}] Written: ${args.path}`;
            } else if (toolName === 'edit_file') {
              msg = `✏️ [${config.name}] Edited: ${args.path}`;
            } else if (toolName === 'read_file') {
              msg = `📖 [${config.name}] Reading: ${args.path}`;
            } else if (toolName === 'delete_file') {
              msg = `🗑️ [${config.name}] Deleted: ${args.path}`;
            } else if (toolName === 'search_code') {
              msg = `🔍 [${config.name}] Searching: ${args.pattern}`;
            } else if (toolName === 'list_files') {
              msg = `📋 [${config.name}] Listing files`;
            } else if (toolName === 'list_uploads') {
              msg = `📤 [${config.name}] Listing uploads`;
            } else if (toolName === 'run_shell') {
              msg = `⚡ [${config.name}] Running: ${args.command?.slice(0, 60)}`;
            } else if (toolName === 'run_tests') {
              msg = `🧪 [${config.name}] Running tests`;
            } else if (toolName === 'take_screenshot') {
              msg = `📸 [${config.name}] Taking screenshot`;
            } else if (toolName === 'done') {
              msg = `✅ [${config.name}] Done: ${(args.summary || '').slice(0, 80)}`;
            }

            if (msg) {
              try {
                await emitEvent(supabase, jobId, 'file_chunk' as any, msg);
              } catch {
                /* best-effort */
              }
            }
          }
        },
      });

      const agentDuration = Date.now() - agentStart;
      const agentText = result.text;
      const agentSuccess = result.finishReason !== 'error';

      agentResults.push({
        role,
        success: agentSuccess,
        text: agentText,
        duration: agentDuration,
      });

      logger.info(
        `[orchestrator] ${config.name} finished: ${result.finishReason}, ${agentText.length} chars, ${agentDuration}ms`,
      );

      // Store context for next agent
      if (role === 'researcher') {
        researcherContext = agentText;
      } else if (role === 'builder') {
        builderContext = agentText;
      } else if (role === 'tester') {
        testerContext = agentText;
      }

      // Emit completion event
      await emitEvent(
        supabase,
        jobId,
        'file_chunk' as any,
        `✅ ${config.name} agent completed (${(agentDuration / 1000).toFixed(1)}s)`,
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
  }
}
