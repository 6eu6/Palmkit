/**
 * /api/stream — new stream API using StreamEventBus + Intent Classifier.
 *
 * This route handles BOTH discuss and build modes through a unified
 * pipeline. The Intent Classifier decides the mode, then the appropriate
 * branch runs:
 *
 *   discuss → streamText with discussPrompt, no validator, no retries
 *   build   → orchestrator (if complex) OR streamText + validator + ≤2 retries
 *
 * The route emits typed StreamEvents via StreamEventBus. The client
 * (StreamEventRouter + StreamContainer) renders them in the proper layer.
 *
 * Migration strategy: this route runs in parallel with /api/chat. The
 * client can be feature-flagged to use either. Once stable, /api/chat
 * is removed.
 */

import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateId } from 'ai';
import { StreamEventBus } from '~/lib/stream/event-bus';
import { classifyIntent } from '~/lib/.server/llm/intent-classifier';
import { streamText, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import { createScopedLogger } from '~/utils/logger';
import { validateBuildOutput } from '~/lib/runtime/output-validator';
import { CLOSE_OUT_PROMPT, CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { shouldDecompose, orchestrateBuild } from '~/lib/.server/llm/build-orchestrator';
import { PROVIDER_LIST } from '~/utils/constants';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import { MAX_RESPONSE_SEGMENTS } from '~/lib/common/llm/constants';
import type { IProviderSetting } from '~/types/model';
import type { Messages } from '~/lib/.server/llm/stream-text';
import type { StreamMode } from '~/lib/stream/types';

export async function action(args: ActionFunctionArgs) {
  return streamAction(args);
}

const logger = createScopedLogger('api.stream');

const MAX_VALIDATION_RETRIES = 2;

interface StreamRequestBody {
  messages: Messages;
  files?: Record<string, unknown>;
  promptId?: string;
  contextOptimization?: boolean;
  chatMode?: 'discuss' | 'build';
  designScheme?: unknown;
  supabase?: unknown;
  maxLLMSteps?: number;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  cookieHeader
    .split(';')
    .map((c) => c.trim())
    .forEach((item) => {
      const [name, ...rest] = item.split('=');

      if (name && rest) {
        cookies[decodeURIComponent(name.trim())] = decodeURIComponent(rest.join('=').trim());
      }
    });

  return cookies;
}

async function streamAction({ context, request }: ActionFunctionArgs) {
  const body = await request.json<StreamRequestBody>();

  const cookieHeader = request.headers.get('Cookie') || '';
  let apiKeys: Record<string, string> = {};
  let providerSettings: Record<string, IProviderSetting> = {};

  try {
    apiKeys = JSON.parse(parseCookies(cookieHeader).apiKeys || '{}');
  } catch {
    logger.warn('Malformed apiKeys cookie — treating as empty');
  }

  try {
    providerSettings = JSON.parse(parseCookies(cookieHeader).providers || '{}');
  } catch {
    logger.warn('Malformed providers cookie — treating as empty');
  }

  // Extract last user message for intent classification
  const lastUserMessage = body.messages.filter((m) => m.role === 'user').slice(-1)[0];
  const userPromptText = extractPropertiesFromMessage(lastUserMessage).content;

  // === Intent Classification ===
  const intent = await classifyIntent(userPromptText, context.cloudflare?.env, apiKeys);
  logger.info(
    `[intent] mode=${intent.mode} confidence=${intent.confidence} stage=${intent.stage} reason="${intent.reason}" (${intent.durationMs}ms)`,
  );

  /*
   * Determine final mode:
   *   - If user explicitly set chatMode AND classifier confidence is low,
   *     respect the user's manual choice.
   *   - Otherwise trust the classifier.
   */
  const finalMode: StreamMode = body.chatMode && intent.confidence < 0.8 ? body.chatMode : intent.mode;

  // === Create event bus ===
  const messageId = generateId();
  const bus = new StreamEventBus({
    onCancel: () => {
      logger.info(`[stream] client disconnected (messageId=${messageId})`);
    },
  });

  const startTime = Date.now();

  /*
   * Set up abort handling. The request.signal fires when the client
   * closes the connection (Stop button or page navigation). We forward
   * it to the LLM provider via streamText's abortSignal option.
   */
  const abortController = new AbortController();

  request.signal.addEventListener('abort', () => {
    logger.info('[stream] request signal aborted');
    abortController.abort();
  });

  // Emit stream:start
  bus.emitStreamStart({
    mode: finalMode,
    intent: intent.reason,
    confidence: intent.confidence,
    messageId,
  });

  try {
    if (finalMode === 'discuss') {
      await runDiscuss(bus, body, apiKeys, providerSettings, messageId, abortController.signal, context);
    } else {
      await runBuild(bus, body, apiKeys, providerSettings, messageId, abortController.signal, context, userPromptText);
    }

    bus.emitStreamEnd({
      reason: 'complete',
      messageId,
      stats: {
        durationMs: Date.now() - startTime,
        segments: 1,
      },
    });
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };

    if (error?.name === 'AbortError' || abortController.signal.aborted) {
      bus.emitStreamEnd({
        reason: 'cancelled',
        messageId,
        stats: { durationMs: Date.now() - startTime },
      });
    } else {
      const message = error?.message || 'Unknown error';
      logger.error(`[stream] error: ${message}`, err);
      bus.emitStreamEnd({
        reason: 'error',
        messageId,
        error: message,
        stats: { durationMs: Date.now() - startTime },
      });
    }
  }

  return bus.response;
}

/* ────────────────────────────────────────────────────────────── */
/*  Discuss mode — no validator, no retries, just stream          */
/* ────────────────────────────────────────────────────────────── */

async function runDiscuss(
  bus: StreamEventBus,
  body: StreamRequestBody,
  apiKeys: Record<string, string>,
  providerSettings: Record<string, IProviderSetting>,
  messageId: string,
  signal: AbortSignal,
  context: ActionFunctionArgs['context'],
) {
  bus.emitStatusUpdate({
    text: 'Analyzing your request...',
    icon: 'ph:brain-duotone',
  });

  bus.emitMessageStart({ role: 'assistant', messageId });

  let fullText = '';

  const options: StreamingOptions = {
    abortSignal: signal,
    toolChoice: 'auto',
    tools: {},
    maxSteps: body.maxLLMSteps ?? 1,
    onStepFinish: () => undefined,
  };

  const result = await streamText({
    messages: body.messages,
    env: context.cloudflare?.env,
    options,
    apiKeys,
    providerSettings,
    promptId: 'discuss',
    contextOptimization: false,
    chatMode: 'discuss',
    customSystemPrompt: discussPrompt(),
  });

  // Stream text deltas
  for await (const part of result.fullStream) {
    if (signal.aborted) {
      break;
    }

    if (part.type === 'text-delta') {
      fullText += part.textDelta;
      bus.emitMessageDelta({ messageId, text: part.textDelta });
    } else if (part.type === 'reasoning') {
      const reasoningText = 'textDelta' in part ? (part.textDelta as string) : '';
      bus.emitReasoningDelta({ messageId, text: reasoningText });
    }
  }

  bus.emitMessageEnd({ messageId });

  logger.info(`[discuss] completed (${fullText.length} chars)`);
}

/* ────────────────────────────────────────────────────────────── */
/*  Build mode — orchestrator OR streamText + validator + retries */
/* ────────────────────────────────────────────────────────────── */

async function runBuild(
  bus: StreamEventBus,
  body: StreamRequestBody,
  apiKeys: Record<string, string>,
  providerSettings: Record<string, IProviderSetting>,
  messageId: string,
  signal: AbortSignal,
  context: ActionFunctionArgs['context'],
  userPromptText: string,
) {
  const hasExistingFiles = body.files && Object.keys(body.files).length > 0;
  const isFreshBuild = !hasExistingFiles;
  const isComplexPrompt = shouldDecompose(userPromptText);

  bus.emitBuildStatus({
    status: 'planning',
    message: 'Planning build approach',
    icon: 'ph:hammer-duotone',
    severity: 'info',
  });

  // === Phase 1: Orchestrator for complex fresh builds ===
  if (isFreshBuild && isComplexPrompt) {
    const lastUserMsg = body.messages.filter((m) => m.role === 'user').slice(-1)[0];
    const { model, provider } = extractPropertiesFromMessage(lastUserMsg);
    const providerObj = PROVIDER_LIST.find((p) => p.name === provider) || PROVIDER_LIST[0];

    if (providerObj) {
      try {
        bus.emitBuildStatus({
          status: 'analyzing',
          message: 'Decomposing complex build into tasks',
          icon: 'ph:brain-duotone',
          severity: 'info',
        });

        const modelInstance = providerObj.getModelInstance({
          model,
          serverEnv: context.cloudflare?.env,
          apiKeys,
          providerSettings,
        });

        const orchestratorResult = await orchestrateBuild(userPromptText, modelInstance, (update) => {
          if (signal.aborted) {
            return;
          }

          bus.emitBuildStatus({
            status: update.type === 'error' ? 'failed' : update.type === 'complete' ? 'complete' : 'building',
            message: update.message,
            icon: update.type === 'error' ? 'ph:x-circle-duotone' : 'ph:hammer-duotone',
            severity: update.type === 'error' ? 'error' : 'info',
          });
        });

        if (orchestratorResult.artifactText && orchestratorResult.artifactText.length > 50) {
          bus.emitMessageStart({ role: 'assistant', messageId });

          // Stream the artifact text in chunks
          const chunkSize = 200;

          for (let i = 0; i < orchestratorResult.artifactText.length; i += chunkSize) {
            if (signal.aborted) {
              break;
            }

            const chunk = orchestratorResult.artifactText.slice(i, i + chunkSize);
            bus.emitMessageDelta({ messageId, text: chunk });
          }

          bus.emitMessageEnd({ messageId });

          bus.emitBuildStatus({
            status: 'complete',
            message: `Build complete — ${orchestratorResult.taskResults.filter((r) => r.success).length}/${orchestratorResult.taskResults.length} tasks succeeded`,
            icon: 'ph:check-circle-duotone',
            severity: 'success',
          });

          return;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[build] orchestrator failed: ${message}, falling back to direct generation`);
        bus.emitBuildStatus({
          status: 'building',
          message: 'Falling back to direct generation',
          icon: 'ph:warning-circle-duotone',
          severity: 'warning',
        });
      }
    }
  }

  // === Phase 2: Direct streamText + validation loop ===
  await runBuildWithRetries(bus, body, apiKeys, providerSettings, messageId, signal, context);
}

async function runBuildWithRetries(
  bus: StreamEventBus,
  body: StreamRequestBody,
  apiKeys: Record<string, string>,
  providerSettings: Record<string, IProviderSetting>,
  messageId: string,
  signal: AbortSignal,
  context: ActionFunctionArgs['context'],
) {
  const currentMessages = [...body.messages];
  let continueSegmentCount = 0;
  let fullAssistantText = '';

  bus.emitBuildStatus({
    status: 'building',
    message: 'Generating build',
    icon: 'ph:hammer-duotone',
    severity: 'info',
  });

  while (continueSegmentCount <= MAX_VALIDATION_RETRIES) {
    if (signal.aborted) {
      logger.info('[build] aborted by client');

      return;
    }

    if (continueSegmentCount > MAX_RESPONSE_SEGMENTS) {
      logger.warn(`[build] exceeded MAX_RESPONSE_SEGMENTS (${MAX_RESPONSE_SEGMENTS})`);
      bus.emitBuildStatus({
        status: 'failed',
        message: `Build truncated after ${MAX_RESPONSE_SEGMENTS} segments`,
        icon: 'ph:x-circle-duotone',
        severity: 'error',
      });

      return;
    }

    // Emit message start (only on first segment)
    if (continueSegmentCount === 0) {
      bus.emitMessageStart({ role: 'assistant', messageId });
    }

    const options: StreamingOptions = {
      abortSignal: signal,
      toolChoice: 'auto',
      tools: {},
      maxSteps: body.maxLLMSteps ?? 1,
      onStepFinish: () => undefined,
    };

    const result = await streamText({
      messages: [...currentMessages],
      env: context.cloudflare?.env,
      options,
      apiKeys,
      providerSettings,
      promptId: body.promptId,
      contextOptimization: body.contextOptimization ?? false,
      chatMode: 'build',
      files: body.files as never,
      designScheme: body.designScheme as never,
    });

    let segmentText = '';

    for await (const part of result.fullStream) {
      if (signal.aborted) {
        break;
      }

      if (part.type === 'text-delta') {
        segmentText += part.textDelta;
        fullAssistantText += part.textDelta;
        bus.emitMessageDelta({ messageId, text: part.textDelta });
      } else if (part.type === 'reasoning') {
        const reasoningText = 'textDelta' in part ? (part.textDelta as string) : '';
        bus.emitReasoningDelta({ messageId, text: reasoningText });
      }
    }

    if (signal.aborted) {
      bus.emitMessageEnd({ messageId });

      return;
    }

    // === Validate ===
    const validationResult = validateBuildOutput(fullAssistantText);

    if (validationResult.completeness === 'complete') {
      bus.emitMessageEnd({ messageId });
      bus.emitBuildStatus({
        status: 'complete',
        message: 'Build complete — ready for preview',
        icon: 'ph:check-circle-duotone',
        severity: 'success',
      });

      return;
    }

    // === Retry or fail ===
    if (!validationResult.retryable || continueSegmentCount >= MAX_VALIDATION_RETRIES) {
      bus.emitMessageEnd({ messageId });

      const failMessage =
        validationResult.completeness === 'garbage'
          ? 'Build failed: model did not produce valid project structure. Try rephrasing your request.'
          : validationResult.completeness === 'invalid'
            ? `Build failed: ${validationResult.issues[0]?.message || 'placeholder/empty file detected'}`
            : `Build incomplete after ${continueSegmentCount + 1} attempts. Please try again.`;

      bus.emitBuildStatus({
        status: 'failed',
        message: failMessage,
        icon: 'ph:x-circle-duotone',
        severity: 'error',
      });

      return;
    }

    // Retry
    continueSegmentCount++;

    bus.emitBuildRetry({
      attempt: continueSegmentCount,
      maxAttempts: MAX_VALIDATION_RETRIES,
      reason: validationResult.issues[0]?.message || 'incomplete output',
      icon: 'ph:spinner-duotone',
    });

    // Inject retry prompt
    const onlyMissingMarker =
      validationResult.issues.length === 1 && validationResult.issues[0].code === 'MISSING_COMPLETION_MARKER';
    const retryPrompt = onlyMissingMarker ? CLOSE_OUT_PROMPT : CONTINUE_PROMPT;

    currentMessages.push({ id: generateId(), role: 'assistant', content: segmentText });
    currentMessages.push({
      id: generateId(),
      role: 'user',
      content: retryPrompt,
    });

    logger.info(`[build] retrying (attempt ${continueSegmentCount}/${MAX_VALIDATION_RETRIES})`);
  }
}
