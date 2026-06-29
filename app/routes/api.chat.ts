import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { isReasoningModel, MAX_RESPONSE_SEGMENTS, type FileMap } from '~/lib/common/llm/constants';
import { CLOSE_OUT_PROMPT, CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { PROVIDER_LIST } from '~/utils/constants';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { WORK_DIR } from '~/utils/constants';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { DesignScheme } from '~/types/design-scheme';
import { MCPService } from '~/lib/services/mcpService';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';
import { builtInTools, phase2Tools } from '~/lib/.server/llm/built-in-tools';
import { shouldDecompose, orchestrateBuild } from '~/lib/.server/llm/build-orchestrator';
import { validateBuildOutput, completenessToJobStatus } from '~/lib/runtime/output-validator';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

const logger = createScopedLogger('api.chat');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages, files, promptId, contextOptimization, supabase, chatMode, designScheme, maxLLMSteps } =
    await request.json<{
      messages: Messages;
      files: any;
      promptId?: string;
      contextOptimization: boolean;
      chatMode: 'discuss' | 'build';
      designScheme?: DesignScheme;
      supabase?: {
        isConnected: boolean;
        hasSelectedProject: boolean;
        credentials?: {
          anonKey?: string;
          supabaseUrl?: string;
        };
      };
      maxLLMSteps: number;
    }>();

  const cookieHeader = request.headers.get('Cookie');
  let apiKeys: Record<string, string> = {};
  let providerSettings: Record<string, IProviderSetting> = {};

  try {
    apiKeys = JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  } catch {
    logger.warn('Malformed apiKeys cookie — treating as empty');
  }

  try {
    providerSettings = JSON.parse(parseCookies(cookieHeader || '').providers || '{}');
  } catch {
    logger.warn('Malformed providers cookie — treating as empty');
  }

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  /*
   * StreamRecoveryManager in outer scope so the TransformStream wrapper
   * (which processes every outgoing chunk) can call updateActivity() to
   * keep the timeout timer alive while data is actively flowing.
   */
  let streamRecovery: StreamRecoveryManager | null = null;

  try {
    const mcpService = MCPService.getInstance();
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    let lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        /*
         * Stream recovery: if no data arrives for the configured timeout the
         * AI service is likely unresponsive.  We cannot re-create the stream
         * mid-flight, but we CAN notify the client so it can show a clear
         * error instead of hanging forever.
         *
         * NOTE: the actual StreamRecoveryManager is constructed further down,
         * AFTER processedMessages is available — we need the message list to
         * detect the selected model and pick a dynamic timeout (reasoning
         * models get 5 min, standard models get 2 min). This early block just
         * sets up the file-path / summary state used by context optimization.
         */
        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        const processedMessages = await mcpService.processToolInvocations(messages, dataStream);

        if (processedMessages.length > 3) {
          messageSliceId = processedMessages.length - 3;
        }

        if (filePaths.length > 0 && contextOptimization) {
          try {
            logger.debug('Generating Chat Summary');
            dataStream.writeData({
              type: 'progress',
              label: 'summary',
              status: 'in-progress',
              order: progressCounter++,
              message: 'Analysing Request',
            } satisfies ProgressAnnotation);

            logger.debug(`Messages count: ${processedMessages.length}`);

            summary = await createSummary({
              messages: [...processedMessages],
              env: context.cloudflare?.env,
              apiKeys,
              providerSettings,
              promptId,
              contextOptimization,
              onFinish(resp) {
                if (resp.usage) {
                  logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                  cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                  cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                  cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
                }
              },
            });
            dataStream.writeData({
              type: 'progress',
              label: 'summary',
              status: 'complete',
              order: progressCounter++,
              message: 'Analysis Complete',
            } satisfies ProgressAnnotation);

            dataStream.writeMessageAnnotation({
              type: 'chatSummary',
              summary,
              chatId: processedMessages.slice(-1)?.[0]?.id,
            } as ContextAnnotation);
          } catch (summaryError: any) {
            logger.warn(
              `Context optimization: createSummary failed (${summaryError.message}) — continuing without summary`,
            );
            dataStream.writeData({
              type: 'progress',
              label: 'summary',
              status: 'complete',
              order: progressCounter++,
              message: 'Skipped',
            } satisfies ProgressAnnotation);
          }

          try {
            logger.debug('Updating Context Buffer');
            dataStream.writeData({
              type: 'progress',
              label: 'context',
              status: 'in-progress',
              order: progressCounter++,
              message: 'Determining Files to Read',
            } satisfies ProgressAnnotation);

            logger.debug(`Messages count: ${processedMessages.length}`);
            filteredFiles = await selectContext({
              messages: [...processedMessages],
              env: context.cloudflare?.env,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              summary: summary || '(no summary available)',
              onFinish(resp) {
                if (resp.usage) {
                  logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                  cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                  cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                  cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
                }
              },
            });

            if (filteredFiles) {
              logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
            }

            dataStream.writeMessageAnnotation({
              type: 'codeContext',
              files: Object.keys(filteredFiles || {}).map((key) => {
                let path = key;

                if (path.startsWith(WORK_DIR)) {
                  path = path.replace(WORK_DIR, '');
                }

                return path;
              }),
            } as ContextAnnotation);

            dataStream.writeData({
              type: 'progress',
              label: 'context',
              status: 'complete',
              order: progressCounter++,
              message: 'Code Files Selected',
            } satisfies ProgressAnnotation);
          } catch (contextError: any) {
            logger.warn(
              `Context optimization: selectContext failed (${contextError.message}) — continuing without context files`,
            );
            filteredFiles = undefined;
            dataStream.writeData({
              type: 'progress',
              label: 'context',
              status: 'complete',
              order: progressCounter++,
              message: 'Skipped',
            } satisfies ProgressAnnotation);
          }
        }

        /*
         * Streaming options — note: NO onFinish callback.
         * The old onFinish handled auto-continue by starting a new
         * mergeIntoDataStream from within the callback, but that new
         * merge was never awaited, so the execute() function returned
         * and createDataStream closed the stream before the continue
         * segment could finish — causing the "cuts off mid-creation" bug.
         *
         * Instead, we now use a while-loop below that awaits each
         * mergeIntoDataStream and checks finishReason afterwards.
         */
        /*
         * Built-in tools (Phase 1.2 + Phase 2):
         *
         * SMART ENABLING — only enable tools when they add value:
         *   - read_file / list_files: only when there ARE existing files (edit mode)
         *     In a fresh build, the LLM has no files to read, so these tools just
         *     distract it from producing <palmkitArtifact> tags.
         *   - web_search / read_url: always available (useful for research)
         *   - grep: always available (fast code search, no sandbox needed)
         *   - run_shell / screenshot / read_sandbox_file: only when sandboxId is available
         *     (these call /api/sb which requires a running E2B sandbox)
         *
         * Phase 2 tools let the LLM:
         * - Run `npm run build` to verify the project compiles
         * - Take a screenshot to visually verify the preview
         * - Read files from the sandbox filesystem (post-build verification)
         * - Grep across all files (find definitions, imports, TODOs)
         */
        const hasExistingFiles = files && Object.keys(files).length > 0;

        /*
         * Phase 2: check if there's an active sandbox for this chat session.
         * The sandboxId is stored in buildStatusStore when the sandbox launches.
         * For server-side tool calls, we read it from the request context.
         */
        const sandboxId = (context as any)?.cloudflare?.env?.CURRENT_SANDBOX_ID as string | undefined;

        const toolsForRequest: Record<string, any> = {
          ...mcpService.toolsWithoutExecute,
          web_search: {
            ...builtInTools.web_search,
          },
          read_url: {
            ...builtInTools.read_url,
          },

          // grep doesn't need a sandbox — searches the project's file map
          grep: {
            ...phase2Tools.grep,
            execute: (args: any, opts: any) => (phase2Tools.grep as any).execute(args, { ...opts, files }),
          },
        };

        if (hasExistingFiles) {
          // Edit/iterate mode: enable file verification tools
          toolsForRequest.read_file = {
            ...builtInTools.read_file,
            execute: (args: any, opts: any) => (builtInTools.read_file as any).execute(args, { ...opts, files }),
          };
          toolsForRequest.list_files = {
            ...builtInTools.list_files,
            execute: (_args: any, opts: any) => (builtInTools.list_files as any).execute({}, { ...opts, files }),
          };
        }

        /*
         * Phase 2: enable sandbox tools when a sandbox is available.
         * These let the LLM verify builds, take screenshots, and read sandbox files.
         */
        if (sandboxId) {
          toolsForRequest.run_shell = {
            ...phase2Tools.run_shell,
            execute: (args: any, opts: any) => (phase2Tools.run_shell as any).execute(args, { ...opts, sandboxId }),
          };
          toolsForRequest.screenshot = {
            ...phase2Tools.screenshot,
            execute: (args: any, opts: any) => (phase2Tools.screenshot as any).execute(args, { ...opts, sandboxId }),
          };
          toolsForRequest.read_sandbox_file = {
            ...phase2Tools.read_sandbox_file,
            execute: (args: any, opts: any) =>
              (phase2Tools.read_sandbox_file as any).execute(args, { ...opts, sandboxId }),
          };
        }

        const streamOptions: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: toolsForRequest,
          maxSteps: maxLLMSteps,
          onStepFinish: ({ toolCalls }) => {
            toolCalls.forEach((toolCall) => {
              mcpService.processToolCall(toolCall, dataStream);
            });
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        /*
         * ═══════════════════════════════════════════════════════════════════
         * PHASE 3: BUILD ORCHESTRATOR
         * ═══════════════════════════════════════════════════════════════════
         * For complex prompts (multi-component, detailed specs), decompose
         * the build into sequential tasks instead of one massive LLM call.
         *
         * This prevents the #1 bug: "stream cutoff on complex prompts".
         * Each task is a small LLM call (~1000-3000 chars) that won't be cut.
         *
         * The orchestrator:
         *   1. Decomposes the prompt into 3-8 tasks
         *   2. Generates each task sequentially
         *   3. Streams progress to the user at each step
         *   4. Assembles the final artifact
         *
         * Simple prompts skip this and go through the normal single-shot path.
         */
        const lastUserMessage = processedMessages.filter((x) => x.role === 'user').slice(-1)[0];
        const userPromptText: string =
          typeof lastUserMessage?.content === 'string'
            ? lastUserMessage.content
            : Array.isArray((lastUserMessage as any)?.content)
              ? (lastUserMessage as any).content.map((p: any) => (p.type === 'text' ? p.text : '')).join(' ')
              : '';

        // Only decompose for fresh builds (no existing files) with complex prompts
        const isFreshBuild = !hasExistingFiles;
        const isComplexPrompt = shouldDecompose(userPromptText);

        if (isFreshBuild && isComplexPrompt) {
          logger.info(`[orchestrator] Complex prompt detected (${userPromptText.length} chars), using orchestrator`);

          // Get the model instance for direct generateText calls
          const { model: orchestratorModel, provider: orchestratorProvider } =
            extractPropertiesFromMessage(lastUserMessage);
          const providerObj = PROVIDER_LIST.find((p) => p.name === orchestratorProvider) || PROVIDER_LIST[0];

          if (providerObj) {
            try {
              const modelInstance = providerObj.getModelInstance({
                model: orchestratorModel,
                serverEnv: context.cloudflare?.env as any,
                apiKeys,
                providerSettings,
              });

              const orchestratorResult = await orchestrateBuild(userPromptText, modelInstance, (update) => {
                dataStream.writeData({
                  type: 'progress',
                  label: 'orchestrator',
                  status: update.type === 'error' ? 'error' : update.type === 'complete' ? 'complete' : 'in-progress',
                  order: progressCounter++,
                  message: update.message,
                } satisfies ProgressAnnotation);
              });

              if (orchestratorResult.success && orchestratorResult.artifactText) {
                /*
                 * Write the assembled artifact as text-delta chunks.
                 * The Vercel AI SDK protocol writes text-delta as "0: text\n"
                 * which the frontend's message parser processes as assistant
                 * message text. The parser then extracts <palmkitArtifact>
                 * tags and creates file actions.
                 *
                 * We split into chunks to avoid writing one massive string.
                 */
                const chunkSize = 4000;
                const text = orchestratorResult.artifactText;

                for (let i = 0; i < text.length; i += chunkSize) {
                  dataStream.writeData({
                    type: 'text-delta',
                    textDelta: text.slice(i, i + chunkSize),
                  });
                }

                dataStream.writeData({
                  type: 'progress',
                  label: 'response',
                  status: 'complete',
                  order: progressCounter++,
                  message: `Build complete — ${orchestratorResult.taskResults.filter((r) => r.success).length}/${orchestratorResult.taskResults.length} tasks succeeded`,
                } satisfies ProgressAnnotation);

                streamRecovery?.stop();

                return; // Skip the normal generation loop — orchestrator handled it
              }
            } catch (orchestratorErr) {
              logger.warn(
                `Orchestrator failed: ${orchestratorErr instanceof Error ? orchestratorErr.message : String(orchestratorErr)}, falling back to normal generation`,
              );

              // Fall through to normal generation
              dataStream.writeData({
                type: 'progress',
                label: 'orchestrator',
                status: 'error',
                order: progressCounter++,
                message: 'Orchestrator failed, falling back to direct generation...',
              } satisfies ProgressAnnotation);
            }
          }
        }

        /*
         * Stream recovery — constructed here (after processedMessages is
         * available) so we can detect the selected model and pick a dynamic
         * timeout:
         *  - Reasoning models (DeepSeek R1, o1/o3, Claude thinking, Gemini
         *    thinking, Qwen QwQ): 300s — these can spend 2-4 minutes
         *    "thinking" before the first output token.
         *  - Standard models: 120s — plenty for first-token latency.
         *
         * The old fixed 120s was killing reasoning models mid-thought, which
         * users experienced as "cuts off mid-creation" / "Server Error".
         */
        const lastUserMsgForModel = processedMessages.filter((x) => x.role === 'user').slice(-1)[0];
        const { model: selectedModel } = extractPropertiesFromMessage(lastUserMsgForModel);
        const isReasoning = isReasoningModel(selectedModel);
        const streamTimeoutMs = isReasoning ? 300_000 : 120_000;
        const streamTimeoutLabel = isReasoning ? '5 minutes' : '2 minutes';

        streamRecovery = new StreamRecoveryManager({
          timeout: streamTimeoutMs,
          maxRetries: 2,
          onTimeout: () => {
            logger.warn(
              `Stream timeout — no data received for ${streamTimeoutLabel} (model=${selectedModel}, reasoning=${isReasoning}), notifying client`,
            );
            dataStream.writeData({
              type: 'progress',
              label: 'response',
              status: 'error',
              order: progressCounter++,
              message: isReasoning
                ? `The AI service timed out after ${streamTimeoutLabel}. ${selectedModel} is a reasoning model and can spend several minutes thinking. Try again, or select a non-reasoning model for faster responses.`
                : `The AI service timed out after ${streamTimeoutLabel}. The model may be processing a complex request. Try again or select a faster model.`,
            } satisfies ProgressAnnotation);
            streamRecovery?.stop();
          },
        });

        streamRecovery.startMonitoring();

        const currentMessages = [...processedMessages];
        let continueSegmentCount = 0;

        /*
         * MAIN GENERATION LOOP
         * ====================
         * Each iteration: call streamText → await mergeIntoDataStream →
         * check finishReason → continue or break.
         *
         * Key fix: we use a SINGLE consumer (mergeIntoDataStream) for the
         * stream. The old code also ran a `for await (result.fullStream)`
         * loop concurrently, which raced with mergeIntoDataStream for the
         * same ReadableStream — causing data loss and silent cutoffs.
         */
        while (true) {
          const result = await streamText({
            messages: [...currentMessages],
            env: context.cloudflare?.env,
            options: streamOptions,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            contextFiles: filteredFiles,
            chatMode,
            designScheme,
            summary,
            messageSliceId,
          });

          /*
           * mergeIntoDataStream is void (fire-and-forget).  Internally
           * it calls writer.merge() which pushes a promise onto
           * createDataStream's ongoingStreamPromises array.  The
           * createDataStream keeps the response stream open until
           * every promise in that array resolves.
           *
           * The result promises (text, finishReason, usage) are
           * ResolvablePromises resolved by the SDK's internal
           * generation loop — they do NOT depend on the merge.
           * We await them here to know when the generation is done
           * and what the outcome was.
           */
          result.mergeIntoDataStream(dataStream);

          let finishReason: string;
          let text: string;
          let usage: any;

          try {
            /*
             * Phase 1 Safety Gate — Silent Cutoff Protection
             * ================================================
             * The result.text/finishReason promises can hang indefinitely if
             * the stream is silently cut (CF Pages Function wall-clock
             * expiry, OpenRouter connection drop, etc.). The old code
             * awaited Promise.all without a timeout, which meant the
             * validation gate NEVER ran on silent cutoffs — the user saw
             * a broken preview with no error message.
             *
             * Fix: race the await against a 25s timeout. If the timeout
             * fires, we treat the segment as incomplete and run validation
             * on whatever text accumulated so far (result.text is a
             * ResolvablePromise that may have partially resolved).
             *
             * 90s is chosen because:
             *   - Promise.all([finishReason, text, usage]) resolves only
             *     when the LLM FINISHES generating — not per-token.
             *   - Complex projects (portfolio, SaaS) can take 60-90s to
             *     generate fully. 25s fired prematurely on active streams.
             *   - StreamRecoveryManager handles truly dead streams
             *     (120s no-data timeout). This covers completion wait time.
             */
            const SEGMENT_AWAIT_TIMEOUT_MS = 90_000;
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('SEGMENT_AWAIT_TIMEOUT')), SEGMENT_AWAIT_TIMEOUT_MS),
            );

            [finishReason, text, usage] = await Promise.race([
              Promise.all([
                result.finishReason as Promise<string>,
                result.text as Promise<string>,
                result.usage as Promise<any>,
              ]),
              timeoutPromise,
            ]);
          } catch (resultError: any) {
            const isTimeout = resultError?.message === 'SEGMENT_AWAIT_TIMEOUT';
            logger.error(
              `Stream result ${isTimeout ? 'timeout' : 'error'} in segment ${continueSegmentCount + 1}: ${resultError.message}`,
            );

            /*
             * On timeout/error, try to salvage whatever text accumulated.
             * result.text is a ResolvablePromise — if the stream produced
             * ANY tokens before dying, the promise may have partially
             * resolved. We race it against a 1s deadline to avoid hanging
             * the error path too.
             */
            let salvagedText = '';

            try {
              salvagedText = await Promise.race([
                result.text as Promise<string>,
                new Promise<string>((resolve) => setTimeout(() => resolve(''), 1000)),
              ]);
            } catch {
              /* ignore — salvagedText stays '' */
            }

            text = salvagedText;
            finishReason = isTimeout ? 'silent_cutoff' : 'error';
            usage = null;

            /*
             * Run validation on the salvaged text. This is the KEY fix:
             * even on silent cutoff, the validator runs and either:
             *   - finds incomplete output → emit failed_clean (if retries
             *     exhausted) OR auto-continue (if retries remain)
             *   - finds complete output (unlikely but possible) → ready
             *
             * The validation logic below handles all outcomes.
             */
            if (text) {
              logger.info(`Salvaged ${text.length} chars after ${finishReason}, running validation`);

              /*
               * Fall through to the validation block below — don't break.
               * The validation logic will decide: retry, fail clean, or ready.
               */
            } else {
              try {
                dataStream.writeData({
                  type: 'progress',
                  label: 'response',
                  status: 'error',
                  order: progressCounter++,
                  message: isTimeout
                    ? 'Build incomplete — stream was interrupted. Please try again.'
                    : `Stream error: ${resultError.message || 'Unknown error'}`,
                } satisfies ProgressAnnotation);
              } catch {
                /* dataStream may already be closed */
              }
              streamRecovery?.stop();
              break;
            }
          }

          logger.debug(`Segment ${continueSegmentCount + 1} finished: reason=${finishReason}, textLen=${text.length}`);

          if (usage) {
            cumulativeUsage.completionTokens += usage.completionTokens || 0;
            cumulativeUsage.promptTokens += usage.promptTokens || 0;
            cumulativeUsage.totalTokens += usage.totalTokens || 0;
          }

          /*
           * Tool-call handling — when the LLM calls tools (read_file, web_search,
           * etc.), finishReason='tool-calls' and `text` is just the intro
           * (no <palmkitArtifact> yet). The Vercel AI SDK executes the tools
           * internally and feeds results back to the LLM in the next step.
           *
           * CRITICAL: Do NOT validate on tool-call steps. The validator would
           * see "no artifact" → "garbage" → build fails. Instead, skip
           * validation and let the loop continue to the next step where the
           * LLM produces the actual artifact.
           *
           * The maxSteps limit (15) ensures this can't loop forever.
           */
          if (finishReason === 'tool-calls' || finishReason === 'tool_calls') {
            logger.info(
              `Step ${continueSegmentCount + 1}: LLM called tools (finishReason=${finishReason}). Continuing to next step.`,
            );

            /*
             * Push the current text (intro) as an assistant message so the
             * next iteration has context, then continue the loop.
             */
            if (text && text.trim().length > 0) {
              currentMessages.push({ id: generateId(), role: 'assistant', content: text });
            }

            continueSegmentCount++;

            if (continueSegmentCount > MAX_RESPONSE_SEGMENTS) {
              logger.warn(`Auto-continue limit reached after tool calls (${MAX_RESPONSE_SEGMENTS}). Stopping.`);
              break;
            }

            continue; // ← skip validation, let LLM produce artifact in next step
          }

          /*
           * Phase 1 Safety Gate — Output Validation
           * ========================================
           * After each segment completes normally (finishReason !== 'length'),
           * we run the output validator. This is the GATE that prevents broken
           * previews from reaching the user.
           *
           * Outcomes:
           *   - complete       → ready_for_preview, break the loop
           *   - incomplete     → if retryCount < MAX_VALIDATION_RETRIES (2),
           *                      emit incomplete_retrying + auto-continue with
           *                      CONTINUE_PROMPT. Otherwise: failed_clean.
           *   - garbage/invalid → failed_clean immediately (retry won't help).
           *
           * IMPORTANT: this is BOUNDED. We do NOT loop forever inside Cloudflare.
           * After MAX_VALIDATION_RETRIES the user sees a clean failure message,
           * never a broken preview.
           *
           * See ROADMAP.md → Phase 1 for the full design.
           */

          /*
           * Aggregate the full assistant text from all segments so far.
           * currentMessages already contains the assistant segments we pushed
           * in previous iterations (line ~445 below), plus the current `text`.
           */
          const fullAssistantText =
            currentMessages
              .filter((m) => m.role === 'assistant')
              .map((m) => (typeof m.content === 'string' ? m.content : ''))
              .join('\n') +
            '\n' +
            text;

          const validationResult = validateBuildOutput(fullAssistantText);
          const jobStatus = completenessToJobStatus(validationResult);
          const MAX_VALIDATION_RETRIES = 2;

          // Push an annotation so the frontend knows the validation outcome.
          dataStream.writeMessageAnnotation({
            type: 'validation' as const,
            value: {
              completeness: validationResult.completeness,
              jobStatus,
              hasCompletionMarker: validationResult.hasCompletionMarker,
              artifactTagsBalanced: validationResult.artifactTagsBalanced,
              fileActionsBalanced: validationResult.fileActionsBalanced,
              fileCount: validationResult.fileCount,
              issues: validationResult.issues,
              retryCount: continueSegmentCount,
            },
          } as any);

          if (validationResult.completeness === 'complete') {
            // ✅ All checks passed — emit ready_for_preview and break.
            streamRecovery?.stop();
            dataStream.writeData({
              type: 'progress',
              label: 'response',
              status: 'complete',
              order: progressCounter++,
              message: 'Build complete — ready for preview',
            } satisfies ProgressAnnotation);
            break;
          }

          if (!validationResult.retryable || continueSegmentCount >= MAX_VALIDATION_RETRIES) {
            // ❌ Not retryable, or we've exhausted retries — fail clean.
            streamRecovery?.stop();

            const failMessage =
              validationResult.completeness === 'garbage'
                ? 'Build failed: model did not produce valid project structure. Try rephrasing your request.'
                : validationResult.completeness === 'invalid'
                  ? `Build failed: ${validationResult.issues[0]?.message || 'placeholder/empty file detected'}`
                  : `Build incomplete after ${continueSegmentCount} attempts. Stream was interrupted. Please try again.`;

            dataStream.writeData({
              type: 'progress',
              label: 'response',
              status: 'error',
              order: progressCounter++,
              message: failMessage,
            } satisfies ProgressAnnotation);
            logger.warn(
              `Build failed clean: completeness=${validationResult.completeness}, retries=${continueSegmentCount}, issues=${validationResult.issues.length}`,
            );
            break;
          }

          // 🔄 Retryable incomplete — emit incomplete_retrying + auto-continue.
          dataStream.writeData({
            type: 'progress',
            label: 'response',
            status: 'in-progress',
            order: progressCounter++,
            message: `Still building… (attempt ${continueSegmentCount + 1}/${MAX_VALIDATION_RETRIES + 1})`,
          } satisfies ProgressAnnotation);
          logger.info(
            `Build incomplete (attempt ${continueSegmentCount + 1}), retrying. Issues: ${validationResult.issues.map((i) => i.code).join(', ')}`,
          );

          /* Token limit hit — auto-continue (also used for incomplete retry) */
          continueSegmentCount++;

          if (continueSegmentCount > MAX_RESPONSE_SEGMENTS) {
            logger.warn(`Auto-continue limit reached (${MAX_RESPONSE_SEGMENTS} segments). Stopping.`);
            dataStream.writeData({
              type: 'progress',
              label: 'response',
              status: 'error',
              order: progressCounter++,
              message: `Response was truncated after ${MAX_RESPONSE_SEGMENTS} segments. The project may be incomplete — try asking the AI to continue.`,
            } satisfies ProgressAnnotation);
            streamRecovery?.stop();
            break;
          }

          const switchesLeft = MAX_RESPONSE_SEGMENTS - continueSegmentCount;
          logger.info(
            `Reached token limit, auto-continuing segment ${continueSegmentCount}/${MAX_RESPONSE_SEGMENTS} (${switchesLeft} remaining)`,
          );

          const lastUserMessage = processedMessages.filter((x) => x.role === 'user').slice(-1)[0];
          const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

          /*
           * Use a targeted "close out" prompt when all files are done but only the
           * completion marker is missing — avoids confusing the model into duplicating content.
           */
          const onlyMissingMarker =
            validationResult.issues.length === 1 && validationResult.issues[0].code === 'MISSING_COMPLETION_MARKER';
          const retryPrompt = onlyMissingMarker ? CLOSE_OUT_PROMPT : CONTINUE_PROMPT;

          currentMessages.push({ id: generateId(), role: 'assistant', content: text });
          currentMessages.push({
            id: generateId(),
            role: 'user',
            content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${retryPrompt}`,
          });
        }
      },
      onError: (error: any) => {
        streamRecovery?.stop();

        // Provide more specific error messages for common issues
        const errorMessage = error.message || 'Unknown error';
        const lowerMessage = errorMessage.toLowerCase();

        /*
         * Full error logged server-side for diagnosis (visible in Cloudflare
         * Pages function logs / wrangler tail).
         */
        logger.error('chat stream onError:', errorMessage, error?.cause || '');

        if (errorMessage.includes('model') && errorMessage.includes('not found')) {
          return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
        }

        if (errorMessage.includes('Invalid JSON response')) {
          return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues. Try selecting a different model or check your API key.';
        }

        /*
         * Forbidden / 403 — the provider rejected the request. Most common
         * causes on OpenRouter:
         *  - The selected model is not enabled in the account (some models
         *    require manual activation at openrouter.ai)
         *  - The API key lacks permission for that provider
         *  - The account has no credits and the model is not free
         *  - The model was deprecated/renamed
         * Give the user a clear, actionable message instead of a bare
         * "Custom error: Forbidden".
         */
        if (
          lowerMessage.includes('forbidden') ||
          lowerMessage.includes('403') ||
          lowerMessage.includes('access denied')
        ) {
          return 'Custom error: The AI provider rejected the request (Forbidden). This usually means the selected model is not enabled for your API key, your account has insufficient credits, or the model has been deprecated. Try selecting a different model (e.g. a free one) or check your provider account.';
        }

        if (
          errorMessage.includes('API key') ||
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('authentication') ||
          lowerMessage.includes('401')
        ) {
          return 'Custom error: Invalid or missing API key. Please check your API key configuration.';
        }

        if (errorMessage.includes('token') && errorMessage.includes('limit')) {
          return 'Custom error: Token limit exceeded. The conversation is too long for the selected model. Try using a model with larger context window or start a new conversation.';
        }

        if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
          return 'Custom error: API rate limit exceeded. Please wait a moment before trying again.';
        }

        if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
          return 'Custom error: Network error. Please check your internet connection and try again.';
        }

        return `Custom error: ${errorMessage}`;
      },
    }).pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          /*
           * Every chunk that passes through here means data is actively
           * flowing to the client — keep the recovery timer alive.
           */
          streamRecovery?.updateActivity();

          if (!lastChunk) {
            lastChunk = ' ';
          }

          if (typeof chunk === 'string') {
            if (chunk.startsWith('g') && !lastChunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "<div class=\\"__palmkitThought__\\">"\n`));
            }

            if (lastChunk.startsWith('g') && !chunk.startsWith('g')) {
              controller.enqueue(encoder.encode(`0: "</div>\\n"\n`));
            }
          }

          lastChunk = chunk;

          let transformedChunk = chunk;

          if (typeof chunk === 'string' && chunk.startsWith('g')) {
            let content = chunk.split(':').slice(1).join(':');

            if (content.endsWith('\n')) {
              content = content.slice(0, content.length - 1);
            }

            transformedChunk = `0:${content}\n`;
          }

          // Convert the string stream to a byte stream
          const str = typeof transformedChunk === 'string' ? transformedChunk : JSON.stringify(transformedChunk);
          controller.enqueue(encoder.encode(str));
        },
      }),
    );

    return new Response(dataStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    /*
     * streamRecovery is only assigned inside execute(); if we're here,
     * execute never ran or threw before the assignment, so it's null.
     */
    logger.error(error);

    const errorResponse = {
      error: true,
      message: error.message || 'An unexpected error occurred',
      statusCode: error.statusCode || 500,
      isRetryable: error.isRetryable !== false, // Default to retryable unless explicitly false
      provider: error.provider || 'unknown',
    };

    if (error.message?.includes('API key')) {
      return new Response(
        JSON.stringify({
          ...errorResponse,
          message: 'Invalid or missing API key',
          statusCode: 401,
          isRetryable: false,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Unauthorized',
        },
      );
    }

    return new Response(JSON.stringify(errorResponse), {
      status: errorResponse.statusCode,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Error',
    });
  }
}
