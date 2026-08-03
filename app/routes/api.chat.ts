import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import {
  isReasoningModel,
  MAX_RESPONSE_SEGMENTS,
  NUDGE_MIN_PROMISE_CHARS,
  type FileMap,
} from '~/lib/common/llm/constants';
import { CLOSE_OUT_PROMPT, CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
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
import { toolRegistry, resolveToolMode, type ToolContext } from '~/lib/.server/tools/registry';
import { validateBuildOutput, completenessToJobStatus, asksTheUser } from '~/lib/runtime/output-validator';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { readCatalog } from '~/lib/.server/llm/capability-registry';
import { chooseModel, type Capability } from '~/lib/.server/llm/model-router';
import { fetchOwnMediaAsDataUrl, storeGeneratedMedia } from '~/lib/.server/llm/generated-media';
import { readAllProviderKeys } from '~/lib/.server/llm/user-keys';
import { DEFAULT_EFFORT, type Effort } from '~/lib/modules/llm/effort';
import type { ModelDescriptor } from '~/lib/modules/llm/model-descriptor';

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
  /*
   * ════════════════════════════════════════════════════════════════════════
   * CLEAN STREAMING REBUILD — single-pass, protocol-pure, model-driven
   * ════════════════════════════════════════════════════════════════════════
   *
   * What was REMOVED (the disease):
   *   1. URL-based chatMode override — the model now decides what to do
   *      (answer / build / create file / search) based on user intent,
   *      NOT which tab the user is on.
   *   2. The TransformStream that converted `g:` (reasoning) → `0:` (text)
   *      and wrapped it in <div class="__palmkitThought__">. This was
   *      DESTROYING the AI SDK's native reasoning protocol — the frontend
   *      never received reasoning parts, so the Reasoning component never
   *      rendered during streaming.
   *   3. The build orchestrator that ran multiple LLM calls and then
   *      dumped the artifact as a 4000-char blob (the "Thinking... then
   *      dump all at once" bug). Now we stream naturally.
   *   4. The aggressive validation retry loop that ran 2-3 LLM round
   *      trips per turn. Validation now runs ONCE at the end as an
   *      annotation; auto-continue only fires for genuine token-limit
   *      cutoffs (finishReason === 'length').
   *
   * What KEPT:
   *   - Tool registry (mode-aware: chat / work / code tools)
   *   - Context optimization (summary + file selection)
   *   - StreamRecoveryManager (timeout protection)
   *   - Single auto-continue on 'length' finishReason (token limit hit)
   *   - Memory block injection
   *
   * The stream now flows: streamText → mergeIntoDataStream → Response.
   * No middleware transforms. The AI SDK's native protocol (text-delta,
   * reasoning-delta, tool-call, tool-result, source) reaches the browser
   * untouched. The frontend's StreamMessage + AI Elements library render
   * each part type correctly.
   */

  const body = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
    chatMode?: 'discuss' | 'build';
    sidebarMode?: 'chat' | 'work' | 'code';
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
    memoryBlock?: string;
    effort?: Effort;
  }>();
  const { messages, files, promptId, contextOptimization, supabase, designScheme, maxLLMSteps, memoryBlock } = body;

  /*
   * Only ever one of three values; anything else is ignored rather than passed
   * through to a provider that would reject it.
   */
  const effort: Effort = ['fast', 'balanced', 'deep'].includes(body.effort ?? '') ? body.effort! : DEFAULT_EFFORT;

  /*
   * What the selected model can do, read once per request from the shared
   * catalog. Needed here because the effort setting is only meaningful — and
   * only safe to send — on a model that accepts it.
   *
   * Memoised: the stream runs in a loop for auto-continue, and re-reading the
   * catalog on every pass would spend a round trip to say the same thing.
   */
  const selected = (() => {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    return last ? extractPropertiesFromMessage(last as never) : { model: undefined, provider: undefined };
  })();

  let catalogPromise: Promise<Map<string, ModelDescriptor>> | undefined;

  const loadCatalog = () => {
    catalogPromise ??= (async () => {
      try {
        const { user, supabase } = await getAuthedUser(request, context);

        if (!user || !supabase || !selected.provider) {
          return new Map<string, ModelDescriptor>();
        }

        return await readCatalog(supabase, selected.provider);
      } catch {
        return new Map<string, ModelDescriptor>();
      }
    })();

    return catalogPromise;
  };

  const lookupDescriptor = async (): Promise<ModelDescriptor | undefined> => {
    if (!selected.model || !selected.provider) {
      return undefined;
    }

    return (await loadCatalog()).get(`${selected.provider}::${selected.model}`);
  };

  /*
   * Which model a tool gets when it needs one the composer's model is not.
   * `generate_image` cannot run on a text model, so it asks for an image
   * model and this answers — from the user's choice if they made one, and
   * otherwise from the catalog.
   *
   * Assignments are read once. Absent means automatic, which is the default
   * and the common case, so a user who never opened that screen pays nothing
   * for it.
   */
  let assignmentsPromise: Promise<Map<string, string>> | undefined;

  const loadAssignments = () => {
    assignmentsPromise ??= (async () => {
      try {
        const { user, supabase } = await getAuthedUser(request, context);

        if (!user || !supabase) {
          return new Map<string, string>();
        }

        const { data, error } = await supabase
          .from('model_assignments')
          .select('capability, model')
          .eq('user_id', user.id);

        if (error) {
          // Migration 0021 not applied — everything is automatic, which works.
          return new Map<string, string>();
        }

        return new Map(
          (data ?? []).map((r) => [(r as { capability: string }).capability, (r as { model: string }).model]),
        );
      } catch {
        return new Map<string, string>();
      }
    })();

    return assignmentsPromise;
  };

  const routeFor = async (capability: Capability) => {
    const [catalog, assignments] = await Promise.all([loadCatalog(), loadAssignments()]);

    /*
     * A pinned model still has to qualify. `chooseModel` ignores a preference
     * that cannot do the job rather than honouring it into a failure at the
     * provider — the model was retired, or the user switched to a key that
     * does not carry it, and falling back beats breaking.
     */
    return chooseModel(catalog, {
      capability,
      provider: selected.provider,
      preferred: assignments.get(capability),
    });
  };

  /*
   * Generated files go to storage, so what travels back through the model is
   * a link rather than a megabyte of base64.
   */
  const storeMedia = async (bytes: Uint8Array, mime: string) => {
    const { user, supabase } = await getAuthedUser(request, context);

    if (!user || !supabase) {
      return undefined;
    }

    return storeGeneratedMedia(supabase, user.id, bytes, mime);
  };

  /*
   * Only files this app issued are read back, and only from the Supabase host
   * it issued them from — a URL that arrives in a tool argument came through
   * the model, and a server that fetches whatever it is told is a server that
   * will read an internal address on a model's say-so.
   */
  const storageHost = (() => {
    try {
      return getEnv(context).SUPABASE_URL ? new URL(getEnv(context).SUPABASE_URL!).hostname : undefined;
    } catch {
      return undefined;
    }
  })();

  const readOwnMedia = async (url: string) => {
    const { user, supabase } = await getAuthedUser(request, context);

    return fetchOwnMediaAsDataUrl(url, storageHost, user && supabase ? { supabase, userId: user.id } : undefined);
  };

  /*
   * ════════════════════════════════════════════════════════════════════════
   * MODE HANDLING — tools only, NOT behavior
   * ════════════════════════════════════════════════════════════════════════
   *
   * The client sends chatMode and sidebarMode based on the URL.
   * We use them ONLY for TOOL SELECTION (different tabs have different
   * tool sets: /chat has minimal tools, /work has document/research
   * tools, /code has file/shell tools).
   *
   * We do NOT use these modes to force model behavior. The unified
   * prompt in prompts.ts has the adaptive_intelligence section that
   * lets the MODEL decide: answer / build / create file / search.
   * No hardcoded "discuss never builds" or "build always builds".
   *
   * If the client doesn't send modes (legacy), we read the Referer
   * header as a fallback.
   */
  const clientChatMode = body.chatMode;
  const clientSidebarMode = body.sidebarMode;
  const refererPath = (request.headers.get('Referer') || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];

  const chatMode: 'discuss' | 'build' = clientChatMode
    ? clientChatMode === 'discuss'
      ? 'discuss'
      : 'build'
    : refererPath.startsWith('/chat') || refererPath.startsWith('/work')
      ? 'discuss'
      : 'build';

  const sidebarMode: 'chat' | 'work' | 'code' = clientSidebarMode
    ? clientSidebarMode
    : refererPath.startsWith('/chat')
      ? 'chat'
      : refererPath.startsWith('/work')
        ? 'work'
        : 'code';

  const cookieHeader = request.headers.get('Cookie');
  let providerSettings: Record<string, IProviderSetting> = {};

  try {
    providerSettings = JSON.parse(parseCookies(cookieHeader || '').providers || '{}');
  } catch {
    logger.warn('Malformed providers cookie — treating as empty');
  }

  /*
   * Keys come from the account, and only from the account.
   *
   * The `apiKeys` cookie used to be read here first and the database was the
   * fallback — which had two costs. A decrypted key sat in a browser cookie
   * readable by any script on the page, and because the cookie won, switching
   * the active provider in settings changed nothing until the cookie happened
   * to be replaced. Both go away together.
   */
  let apiKeys: Record<string, string> = {};

  try {
    const { user, supabase } = await getAuthedUser(request, context);

    if (user && supabase) {
      apiKeys = await readAllProviderKeys(supabase, user.id, getEnv(context).API_KEY_ENCRYPTION_KEY);
    }
  } catch (authErr) {
    /*
     * Signed out, or Supabase misconfigured. Providers still resolve keys
     * from the server environment; if there is none, streamText fails with a
     * clear message.
     */
    logger.debug(`API key lookup skipped: ${(authErr as Error).message}`);
  }

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  let progressCounter: number = 1;

  let streamRecovery: StreamRecoveryManager | null = null;

  try {
    const mcpService = MCPService.getInstance();
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    const dataStream = createDataStream({
      async execute(dataStream) {
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

        const hasExistingFiles = files && Object.keys(files).length > 0;
        const sandboxId = (context as any)?.cloudflare?.env?.CURRENT_SANDBOX_ID as string | undefined;

        /*
         * Tool selection via toolRegistry (mode-aware).
         * The tool SET varies by tab (chat has minimal tools, work has
         * document/research tools, code has file/shell tools), but the
         * PROMPT does not force behavior — the model picks the right
         * tool for the job, or no tool at all.
         */
        const toolMode = resolveToolMode(chatMode, sidebarMode);

        const toolContext: ToolContext = {
          files: hasExistingFiles ? files : undefined,
          sandboxId,

          /*
           * The user's own keys, already resolved for this request. Tools used
           * to get a single OpenRouter key read from the deployment's
           * environment, which on the hosted app is not set — so anything
           * needing a provider key was dead for every user.
           */
          apiKeys,

          routeModel: (capability) => routeFor(capability),
          storeMedia: (bytes, mime) => storeMedia(bytes, mime),
          readOwnMedia: (url) => readOwnMedia(url),
          searchApiKey: ((context.cloudflare?.env as any)?.TAVILY_API_KEY ??
            (context.cloudflare?.env as any)?.SERPAPI_KEY ??
            process.env.TAVILY_API_KEY ??
            process.env.SERPAPI_KEY) as string | undefined,
          mode: toolMode,
        };

        const registryTools = toolRegistry.getToolsForMode(toolMode, toolContext);

        const toolsForRequest: Record<string, any> = {
          ...mcpService.toolsWithoutExecute,
        };

        for (const [name, toolObj] of Object.entries(registryTools)) {
          if (!hasExistingFiles && (name === 'read_file' || name === 'list_files')) {
            continue;
          }

          if (!sandboxId && (name === 'run_shell' || name === 'screenshot' || name === 'read_sandbox_file')) {
            continue;
          }

          /*
           * A tool that cannot work costs more than its description.
           *
           * With no search key configured, `web_search` was still offered, and
           * on production the model duly called it while building a landing
           * page, got back "Web search is not configured", and spent a whole
           * segment — another eight thousand prompt tokens — recovering from
           * a dead end this request already knew about.
           */
          if (!toolContext.searchApiKey && (name === 'web_search' || name === 'deep_search')) {
            continue;
          }

          toolsForRequest[name] = toolObj;
        }

        const streamOptions: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: toolsForRequest,
          maxSteps: maxLLMSteps,
          onStepFinish: ({ toolCalls, text: partial }) => {
            if (toolCalls.length > 0) {
              usedTools = true;
            }

            if (partial) {
              stepText += partial;
            }

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
         * Stream recovery — dynamic timeout based on model type.
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
         * Whether the model did any work with tools this turn.
         *
         * A turn that searched the web and answered is a finished turn. A
         * turn that produced neither tool calls nor an artifact, in build
         * mode, produced nothing at all — and those two look identical from
         * the text alone.
         */
        let usedTools = false;

        /*
         * Everything the model wrote this turn, across every step.
         *
         * `result.text` is the LAST step's text, not the turn's. Measured
         * against the same model and prompt: one step returns 14,251
         * characters, and adding tools with maxSteps returns 1,106 across
         * eight steps — the other thirteen thousand are still streamed to
         * the browser, they are simply not in `result.text`. Everything on
         * the server that asks "what did the model produce" — the validator,
         * the job status, the nudge below — was reading the last fragment
         * and concluding nothing had been built.
         */
        let stepText = '';

        /* At most one nudge per request; a model that ignores it twice is not going to comply. */
        let nudgedForEmptyBuild = false;

        /*
         * MAIN GENERATION LOOP
         * ====================
         * Single consumer: mergeIntoDataStream. No concurrent for-await
         * loop on fullStream (that caused data races + silent cutoffs).
         *
         * Auto-continue ONLY fires when:
         *   - finishReason === 'length' (genuine token limit hit)
         *   - AND we haven't exhausted MAX_RESPONSE_SEGMENTS
         *
         * Tool-call steps (finishReason === 'tool-calls') continue to the
         * next step naturally — the Vercel AI SDK executes tools and
         * feeds results back internally via maxSteps.
         *
         * NO orchestrator. NO validation retry loop. The model streams
         * naturally and the frontend renders each part type as it
         * arrives (text, reasoning, tool-call, tool-result, source).
         */
        while (true) {
          /*
           * Per segment. A continuation's previous text is already in
           * `currentMessages`, so carrying it here too would count it twice.
           */
          stepText = '';

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
            memoryBlock,
            effort,
            descriptor: await lookupDescriptor(),
          });

          result.mergeIntoDataStream(dataStream);

          let finishReason: string;
          let text: string;
          let usage: any;

          try {
            /*
             * A long build is not a hung one.
             *
             * This was a flat 90 seconds of wall clock, and a real project
             * takes longer than that: asked for a coffee-roastery landing
             * page, the model worked for 149 seconds and finished cleanly
             * with 7,276 tokens — and every one of them was thrown away,
             * because at 90 seconds this fired, the salvage below raced the
             * text with a one-second timeout, got nothing, and the loop
             * broke with "Build incomplete — stream was interrupted".
             *
             * Silence is what indicates a hang, and `streamRecovery` already
             * watches for exactly that: its timer resets on every chunk, so
             * it fires only when nothing has arrived for two minutes (five
             * for a reasoning model). This ceiling exists purely so a
             * promise that never settles cannot hang the request forever,
             * which is a different job and wants a much larger number.
             */
            const SEGMENT_AWAIT_TIMEOUT_MS = Math.max(streamTimeoutMs * 4, 600_000);
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

            let salvagedText = '';

            try {
              /*
               * Give the text a real chance to arrive. One second was not a
               * salvage attempt, it was a formality: a model still writing
               * has not resolved `result.text` yet, so this returned '' every
               * time and the work was discarded as if nothing had been
               * produced.
               */
              salvagedText = await Promise.race([
                result.text as Promise<string>,
                new Promise<string>((resolve) => setTimeout(() => resolve(''), 20_000)),
              ]);
            } catch {
              /* ignore */
            }

            text = salvagedText;
            finishReason = isTimeout ? 'silent_cutoff' : 'error';
            usage = null;

            if (text) {
              logger.info(`Salvaged ${text.length} chars after ${finishReason}, running validation`);
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

          logger.debug(
            `Segment ${continueSegmentCount + 1} finished: reason=${finishReason}, ` +
              `textLen=${text.length}, acrossSteps=${stepText.length}`,
          );

          if (usage) {
            cumulativeUsage.completionTokens += usage.completionTokens || 0;
            cumulativeUsage.promptTokens += usage.promptTokens || 0;
            cumulativeUsage.totalTokens += usage.totalTokens || 0;
          }

          /*
           * Tool-call steps: continue naturally. The AI SDK executes
           * tools and feeds results back to the model in the next step.
           * Do NOT validate on tool-call steps.
           */
          if (finishReason === 'tool-calls' || finishReason === 'tool_calls') {
            logger.info(
              `Step ${continueSegmentCount + 1}: LLM called tools (finishReason=${finishReason}). Continuing.`,
            );

            if (text && text.trim().length > 0) {
              currentMessages.push({ id: generateId(), role: 'assistant', content: text });
            }

            continueSegmentCount++;

            if (continueSegmentCount > MAX_RESPONSE_SEGMENTS) {
              logger.warn(`Auto-continue limit reached after tool calls (${MAX_RESPONSE_SEGMENTS}). Stopping.`);
              break;
            }

            continue;
          }

          /*
           * ONE-TIME validation annotation — ONLY in build mode.
           * In discuss mode (/chat, /work), the model answers questions
           * and creates files — there's no <palmkitArtifact> expected.
           * Running validation in discuss mode produces "garbage"/"failed_clean"
           * which shows "Build failed" in the UI — confusing for users
           * who just asked a question.
           */
          /*
           * Everything the assistant has produced across segments so far.
           * Declared here, not inside the build-mode block below: the
           * auto-continue branch further down also inspects it to decide
           * between CONTINUE_PROMPT and CLOSE_OUT_PROMPT, and a block-scoped
           * `const` left that reference unresolved (`tsc` error TS2304).
           */
          /*
           * Prefer what was accumulated across steps; `text` alone is the
           * final step and loses everything written before a tool call.
           */
          const turnText = stepText.length > text.length ? stepText : text;

          const fullAssistantText =
            currentMessages
              .filter((m) => m.role === 'assistant')
              .map((m) => (typeof m.content === 'string' ? m.content : ''))
              .join('\n') +
            '\n' +
            turnText;

          /*
           * A turn that asked the user a question wrote no files on purpose.
           * Validating it reports "garbage" and the UI says the build failed,
           * which is exactly backwards: it is waiting, not broken.
           */
          const askedTheUser = asksTheUser(turnText);

          if (chatMode === 'build' && !askedTheUser) {
            try {
              const validationResult = validateBuildOutput(fullAssistantText);
              const jobStatus = completenessToJobStatus(validationResult);

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
            } catch {
              /* validation is best-effort — never block the response */
            }
          }

          /*
           * The model said it would build something and then stopped.
           *
           * "I'll create a minimal, elegant restaurant landing page." —
           * finishReason 'stop', zero artifact tags, 101 characters. The
           * validator caught it and wrote `completeness: garbage` into an
           * annotation, and nothing acted on it, because auto-continue only
           * fires on a token-limit cutoff. The user asked for a website and
           * received a sentence.
           *
           * Three conditions together, because any one alone would fire on a
           * turn that was fine: build mode, so an artifact was the point; no
           * artifact and no file actions, so nothing was built; and no tool
           * calls, so nothing was done another way. A turn that ran a search
           * and answered a question satisfies none of them.
           *
           * The cost of being wrong here is one extra round trip. The cost of
           * not trying is the whole request.
           */
          if (chatMode === 'build' && finishReason === 'stop' && !usedTools && !nudgedForEmptyBuild && !askedTheUser) {
            let producedNothing = false;

            try {
              producedNothing = validateBuildOutput(fullAssistantText).completeness === 'garbage';
            } catch {
              /* If it cannot be validated, leave the turn alone. */
            }

            /*
             * A short answer is an answer, not an abandoned build.
             *
             * This fires when a build turn wrote no files, and it used to fire
             * on any such turn. Asked to "reply with exactly: PONG", the model
             * replied PONG — correctly — and was then pushed into writing an
             * index.html containing the word PONG, at the cost of a second
             * segment: another eight and a half thousand prompt tokens for a
             * file nobody wanted.
             *
             * A model that means to build says so first, at length. Four
             * characters is not a plan that lost its files.
             */
            if (producedNothing && turnText.trim().length < NUDGE_MIN_PROMISE_CHARS) {
              producedNothing = false;
            }

            if (producedNothing) {
              const lastUserMessage = processedMessages.filter((x) => x.role === 'user').slice(-1)[0];
              const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

              logger.warn('Build turn produced no artifact and used no tools — asking once for the files');

              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'in-progress',
                order: progressCounter++,
                message: 'Writing the files…',
              } satisfies ProgressAnnotation);

              currentMessages.push({ id: generateId(), role: 'assistant', content: turnText });
              currentMessages.push({
                id: generateId(),
                role: 'user',
                content:
                  `[Model: ${model}]\n\n[Provider: ${provider}]\n\n` +
                  'You described what you would build but did not write any files. ' +
                  'Write them now inside <palmkitArtifact> with <palmkitAction type="file"> tags, ' +
                  'full content for each file, and nothing else before the artifact. ' +
                  'Finish with __PALMKIT_DONE__ on its own line.',
              });

              nudgedForEmptyBuild = true;
              continue;
            }
          }

          /*
           * Auto-continue ONLY on genuine token-limit cutoff.
           * The model's stream was interrupted mid-file — we ask it
           * to continue from where it stopped. This is the ONLY retry
           * path, and it's bounded by MAX_RESPONSE_SEGMENTS.
           */
          if (finishReason === 'length' && continueSegmentCount < MAX_RESPONSE_SEGMENTS) {
            const lastUserMessage = processedMessages.filter((x) => x.role === 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);

            // Detect if only the completion marker is missing
            let retryPrompt = CONTINUE_PROMPT;

            try {
              const vr = validateBuildOutput(fullAssistantText);
              const onlyMissingMarker = vr.issues.length === 1 && vr.issues[0].code === 'MISSING_COMPLETION_MARKER';

              if (onlyMissingMarker) {
                retryPrompt = CLOSE_OUT_PROMPT;
              }
            } catch {
              /* fall through with CONTINUE_PROMPT */
            }

            dataStream.writeData({
              type: 'progress',
              label: 'response',
              status: 'in-progress',
              order: progressCounter++,
              message: `Continuing… (segment ${continueSegmentCount + 2}/${MAX_RESPONSE_SEGMENTS + 1})`,
            } satisfies ProgressAnnotation);

            logger.info(
              `Token limit hit, auto-continuing segment ${continueSegmentCount + 1}/${MAX_RESPONSE_SEGMENTS}`,
            );

            currentMessages.push({ id: generateId(), role: 'assistant', content: turnText });
            currentMessages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${retryPrompt}`,
            });

            continueSegmentCount++;
            continue;
          }

          /*
           * Normal completion — finishReason is 'stop', 'content-filter',
           * 'silent_cutoff' (with salvaged text), 'error', or we've
           * exhausted segments. Emit final progress and break.
           */
          streamRecovery?.stop();

          const finalStatus: 'complete' | 'error' =
            finishReason === 'error' || finishReason === 'silent_cutoff' ? 'error' : 'complete';
          const finalMessage =
            finalStatus === 'complete'
              ? 'Response complete'
              : finishReason === 'silent_cutoff'
                ? 'Response incomplete — stream was interrupted. Try again.'
                : `Response error: ${finishReason}`;

          try {
            dataStream.writeData({
              type: 'progress',
              label: 'response',
              status: finalStatus,
              order: progressCounter++,
              message: finalMessage,
            } satisfies ProgressAnnotation);
          } catch {
            /* dataStream may already be closed */
          }

          break;
        }

        /*
         * Write cumulative usage as a final annotation (best-effort).
         */
        try {
          dataStream.writeMessageAnnotation({
            type: 'usage',
            value: { ...cumulativeUsage },
          } as any);
        } catch {
          /* ignore */
        }
      },
      onError: (error: any) => {
        streamRecovery?.stop();

        const errorMessage = error.message || 'Unknown error';
        const lowerMessage = errorMessage.toLowerCase();

        logger.error('chat stream onError:', errorMessage, error?.cause || '');

        if (errorMessage.includes('model') && errorMessage.includes('not found')) {
          return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
        }

        if (errorMessage.includes('Invalid JSON response')) {
          return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues. Try selecting a different model or check your API key.';
        }

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
    });

    /*
     * ════════════════════════════════════════════════════════════════════════
     * NO TRANSFORM STREAM — pass the AI SDK's native protocol through
     * untouched. This is the #1 fix:
     *
     *   - `0:` text-delta → frontend renders text token-by-token
     *   - `g:` reasoning-delta → frontend renders Reasoning component
     *   - `b:` tool-call → frontend renders Tool component
     *   - `c:` tool-result → frontend updates Tool with result
     *   - `h:` source → frontend renders Sources
     *   - `2:` data → frontend processes progress/annotations
     *
     * The OLD TransformStream converted `g:` → `0:` and wrapped in
     * <div class="__palmkitThought__">, which destroyed the reasoning
     * protocol and made the Reasoning component never render.
     * ════════════════════════════════════════════════════════════════════════
     *
     * We use pipeThrough with an IDENTITY-like transform ONLY to keep
     * the streamRecovery heartbeat alive — we do NOT mutate the chunks.
     */
    const cleanStream = dataStream.pipeThrough(
      new TransformStream({
        transform: (chunk, controller) => {
          // Keep the recovery timer alive — data is flowing.
          streamRecovery?.updateActivity();

          /*
           * Pass through UNTOUCHED. No g:→0: conversion. No <div> wrapping.
           * The chunk is already a Uint8Array of the AI SDK protocol.
           */
          controller.enqueue(chunk);
        },
      }),
    );

    return new Response(cleanStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    logger.error(error);

    const errorResponse = {
      error: true,
      message: error.message || 'An unexpected error occurred',
      statusCode: error.statusCode || 500,
      isRetryable: error.isRetryable !== false,
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
