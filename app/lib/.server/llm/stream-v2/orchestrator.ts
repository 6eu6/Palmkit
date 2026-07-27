/**
 * Stream v2 — Orchestrator
 * ========================
 *
 * Replaces the 300-line while(true) loop in api.chat.ts with a clean,
 * mode-aware orchestration function.
 *
 * Architecture:
 *   1. resolveStreamModeConfig() → determines behavior
 *   2. Mode-specific dispatch:
 *      - chat: single streamText call, no validation, no tools beyond web_search
 *      - work: streamText with tools, no validation, discussPrompt
 *      - code: streamText with tools + validation + orchestrator + continue loop
 *   3. All events go through the same dataStream (AI SDK protocol)
 *
 * The orchestrator is PURE — it doesn't import React, doesn't touch
 * the DOM, and can be unit-tested in isolation.
 */

import { createDataStreamResponse, generateId, formatDataStreamPart } from 'ai';
import { streamText as llmStreamText } from '~/lib/.server/llm/stream-text';
import { shouldDecompose, orchestrateBuild } from '~/lib/.server/llm/build-orchestrator';
import { validateBuildOutput, completenessToJobStatus } from '~/lib/runtime/output-validator';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';
import { CONTINUE_PROMPT, CLOSE_OUT_PROMPT } from '~/lib/common/prompts/prompts';
import { isReasoningModel, MAX_RESPONSE_SEGMENTS, type FileMap } from '~/lib/common/llm/constants';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';
import { toolRegistry, type ToolContext } from '~/lib/.server/tools/registry';
import { MCPService } from '~/lib/services/mcpService';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { WORK_DIR } from '~/utils/constants';
import type { Messages } from '~/lib/.server/llm/stream-text';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import type { DesignScheme } from '~/types/design-scheme';
import type { IProviderSetting } from '~/types/model';
import { type StreamModeConfig, resolveStreamModeConfig } from './types';

const logger = createScopedLogger('stream-v2:orchestrator');

export interface StreamOrchestratorParams {
  messages: Messages;
  files?: any;
  chatMode: 'discuss' | 'build';
  sidebarMode?: 'chat' | 'work' | 'code';
  apiKeys: Record<string, string>;
  providerSettings: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization: boolean;
  supabase?: {
    isConnected: boolean;
    hasSelectedProject: boolean;
    credentials?: { anonKey?: string; supabaseUrl?: string };
  };
  maxLLMSteps: number;
  memoryBlock?: string;
  designScheme?: DesignScheme;
  sandboxId?: string;
  env?: Env;
  requestId: string;
}

export interface StreamOrchestratorResult {
  response: Response;
}

/**
 * Main entry point — called by api.chat.ts action().
 *
 * Returns a Response with the stream. The caller just returns this
 * response — no post-processing needed.
 *
 * This function replaces the entire createDataStream({ execute }) block
 * in the old api.chat.ts.
 */
export async function orchestrateStream(params: StreamOrchestratorParams): Promise<StreamOrchestratorResult> {
  const config = resolveStreamModeConfig(params.chatMode, params.sidebarMode);

  logger.info(`[stream-v2] Starting stream: mode=${config.mode}, requestId=${params.requestId}`);

  const response = createDataStreamResponse({
    execute: async (dataStream) => {
      await runStreamLoop(dataStream, params, config);
    },
    onError: (error: any) => handleError(error, config),
  });

  return { response };
}

/**
 * The main stream loop — mode-aware.
 *
 * chat/work: single call (no while loop)
 * code: while loop with validation + continue
 */
async function runStreamLoop(
  dataStream: any,
  params: StreamOrchestratorParams,
  config: StreamModeConfig,
): Promise<void> {
  let progressCounter = 0;

  const emitProgress = (label: string, status: ProgressAnnotation['status'], message: string) => {
    dataStream.writeData({
      type: 'progress',
      label,
      status,
      order: progressCounter++,
      message,
    } satisfies ProgressAnnotation);
  };

  // ── Phase 0: MCP message processing + context optimization ────
  const mcpService = MCPService.getInstance();
  const processedMessages = await mcpService.processToolInvocations(params.messages, dataStream);

  // Context optimization (only for code mode with existing files)
  let filteredFiles: FileMap | undefined = undefined;
  let summary: string | undefined = undefined;
  let messageSliceId = 0;

  const filePaths = getFilePaths(params.files || {});

  if (filePaths.length > 0 && params.contextOptimization) {
    if (processedMessages.length > 3) {
      messageSliceId = processedMessages.length - 3;
    }

    try {
      emitProgress('summary', 'in-progress', 'Analysing Request');

      summary = await createSummary({
        messages: [...processedMessages],
        env: params.env,
        apiKeys: params.apiKeys,
        providerSettings: params.providerSettings,
        promptId: params.promptId,
        contextOptimization: params.contextOptimization,
        onFinish(_resp: any) {
          // usage tracking
        },
      });

      emitProgress('summary', 'complete', 'Analysis Complete');

      dataStream.writeMessageAnnotation({
        type: 'chatSummary',
        summary,
        chatId: processedMessages.slice(-1)?.[0]?.id,
      } as ContextAnnotation);
    } catch (summaryError: any) {
      logger.warn(`Context optimization: createSummary failed (${summaryError.message})`);
      emitProgress('summary', 'complete', 'Skipped');
    }

    try {
      emitProgress('context', 'in-progress', 'Determining Files to Read');

      filteredFiles = await selectContext({
        messages: [...processedMessages],
        env: params.env,
        apiKeys: params.apiKeys,
        files: params.files,
        providerSettings: params.providerSettings,
        promptId: params.promptId,
        contextOptimization: params.contextOptimization,
        summary: summary || '(no summary available)',
        onFinish(_resp: any) {
          // usage tracking
        },
      });

      if (filteredFiles) {
        dataStream.writeMessageAnnotation({
          type: 'codeContext',
          files: Object.keys(filteredFiles).map((key) => {
            let path = key;

            if (path.startsWith(WORK_DIR)) {
              path = path.replace(WORK_DIR, '');
            }

            return path;
          }),
        } as ContextAnnotation);
      }

      emitProgress('context', 'complete', 'Code Files Selected');
    } catch (contextError: any) {
      logger.warn(`Context optimization: selectContext failed (${contextError.message})`);
      filteredFiles = undefined;
      emitProgress('context', 'complete', 'Skipped');
    }
  }

  // ── Phase 1: Build tools ──────────────────────────────────────
  emitProgress('response', 'in-progress', config.discussMode ? 'Thinking…' : 'Building…');

  const toolsForRequest = buildTools(params, config, mcpService);

  // ── Phase 2: Stream recovery ──────────────────────────────────
  const lastUserMessage = processedMessages.filter((x) => x.role === 'user').slice(-1)[0];
  const { model: selectedModel } = extractPropertiesFromMessage(lastUserMessage as any);
  const isReasoning = isReasoningModel(selectedModel);
  const streamTimeoutMs = isReasoning ? 300_000 : 120_000;

  const streamRecovery = new StreamRecoveryManager({
    timeout: streamTimeoutMs,
    maxRetries: 2,
    onTimeout: () => {
      emitProgress(
        'response',
        'error',
        isReasoning
          ? `The AI service timed out after ${streamTimeoutMs / 1000}s. ${selectedModel} is a reasoning model — try again or use a faster model.`
          : `The AI service timed out after ${streamTimeoutMs / 1000}s. Try again or select a faster model.`,
      );
      streamRecovery.stop();
    },
  });

  streamRecovery.startMonitoring();

  // ── Phase 3: Mode-specific dispatch ───────────────────────────

  if (config.mode === 'code' && config.orchestrate) {
    // Code mode: try orchestrator for complex prompts
    const userPromptText = extractUserPromptText(processedMessages);
    const hasExistingFiles = params.files && Object.keys(params.files).length > 0;
    const isFreshBuild = !hasExistingFiles;
    const isComplexPrompt = shouldDecompose(userPromptText);

    if (isFreshBuild && isComplexPrompt) {
      logger.info(`[stream-v2] Orchestrator path: complex prompt (${userPromptText.length} chars)`);

      const orchestratorHandled = await tryOrchestrator(dataStream, params, emitProgress);

      if (orchestratorHandled) {
        streamRecovery.stop();
        return; // Orchestrator handled everything
      }

      // Orchestrator failed — fall through to normal generation
      emitProgress('orchestrator', 'error', 'Orchestrator failed, falling back to direct generation...');
    }
  }

  // ── Phase 4: Main generation loop ─────────────────────────────

  const currentMessages = [...processedMessages];
  let continueSegmentCount = 0;
  const MAX_VALIDATION_RETRIES = 2;

  const streamOptions = {
    supabaseConnection: params.supabase,
    toolChoice: 'auto' as const,
    tools: toolsForRequest,
    maxSteps: params.maxLLMSteps,
    onStepFinish: ({ toolCalls }: any) => {
      toolCalls.forEach((toolCall: any) => {
        mcpService.processToolCall(toolCall, dataStream);
      });
    },
  };

  while (true) {
    const result = await llmStreamText({
      messages: [...currentMessages],
      env: params.env,
      options: streamOptions,
      apiKeys: params.apiKeys,
      files: params.files,
      providerSettings: params.providerSettings,
      promptId: params.promptId,
      contextOptimization: params.contextOptimization,
      contextFiles: filteredFiles,
      summary,
      messageSliceId,
      chatMode: params.chatMode,
      designScheme: params.designScheme,
      memoryBlock: params.memoryBlock,
      customSystemPrompt: config.discussMode ? discussPrompt() : undefined,
    });

    result.mergeIntoDataStream(dataStream);

    let finishReason: string;
    let text: string;
    let usage: any;

    try {
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
      logger.error(`[stream-v2] Stream ${isTimeout ? 'timeout' : 'error'} in segment ${continueSegmentCount + 1}`);

      let salvagedText = '';

      try {
        salvagedText = await Promise.race([
          result.text as Promise<string>,
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 1000)),
        ]);
      } catch {
        /* ignore */
      }

      text = salvagedText;
      finishReason = isTimeout ? 'silent_cutoff' : 'error';
      usage = null;

      if (!text) {
        emitProgress(
          'response',
          'error',
          isTimeout
            ? 'Build incomplete — stream was interrupted. Please try again.'
            : `Stream error: ${resultError.message || 'Unknown error'}`,
        );
        streamRecovery.stop();
        break;
      }

      logger.info(`[stream-v2] Salvaged ${text.length} chars after ${finishReason}`);
    }

    streamRecovery.updateActivity();

    // ── Tool-call handling ────────────────────────────────────
    if (finishReason === 'tool-calls' || finishReason === 'tool_calls') {
      logger.info(`[stream-v2] Step ${continueSegmentCount + 1}: LLM called tools, continuing`);

      if (text && text.trim().length > 0) {
        currentMessages.push({ id: generateId(), role: 'assistant', content: text });
      }

      continueSegmentCount++;

      if (continueSegmentCount > MAX_RESPONSE_SEGMENTS) {
        logger.warn(`[stream-v2] Auto-continue limit reached after tool calls`);
        break;
      }

      continue;
    }

    // ── Mode-specific completion ──────────────────────────────

    if (config.discussMode) {
      streamRecovery.stop();
      emitProgress('response', 'complete', 'Response complete');

      if (usage) {
        dataStream.writeMessageAnnotation({
          type: 'usage',
          value: {
            completionTokens: usage.completionTokens || 0,
            promptTokens: usage.promptTokens || 0,
            totalTokens: usage.totalTokens || 0,
          },
        } as any);
      }

      break;
    }

    // ── Code mode: validation ─────────────────────────────────
    const fullAssistantText =
      currentMessages
        .filter((m) => m.role === 'assistant')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n') +
      '\n' +
      text;

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

    if (validationResult.completeness === 'complete') {
      streamRecovery.stop();
      emitProgress('response', 'complete', 'Build complete — ready for preview');
      break;
    }

    if (!validationResult.retryable || continueSegmentCount >= MAX_VALIDATION_RETRIES) {
      streamRecovery.stop();

      const failMessage =
        validationResult.completeness === 'garbage'
          ? 'Build failed: model did not produce valid project structure. Try rephrasing your request.'
          : validationResult.completeness === 'invalid'
            ? `Build failed: ${validationResult.issues[0]?.message || 'placeholder/empty file detected'}`
            : `Build incomplete after ${continueSegmentCount} attempts. Stream was interrupted. Please try again.`;

      emitProgress('response', 'error', failMessage);
      logger.warn(
        `[stream-v2] Build failed: completeness=${validationResult.completeness}, retries=${continueSegmentCount}`,
      );
      break;
    }

    emitProgress(
      'response',
      'in-progress',
      `Still building… (attempt ${continueSegmentCount + 1}/${MAX_VALIDATION_RETRIES + 1})`,
    );

    continueSegmentCount++;

    if (continueSegmentCount > MAX_RESPONSE_SEGMENTS) {
      logger.warn(`[stream-v2] Auto-continue limit reached (${MAX_RESPONSE_SEGMENTS} segments)`);
      emitProgress(
        'response',
        'error',
        `Response was truncated after ${MAX_RESPONSE_SEGMENTS} segments. The project may be incomplete.`,
      );
      streamRecovery.stop();
      break;
    }

    const onlyMissingMarker =
      validationResult.issues.length === 1 && validationResult.issues[0].code === 'MISSING_COMPLETION_MARKER';
    const retryPrompt = onlyMissingMarker ? CLOSE_OUT_PROMPT : CONTINUE_PROMPT;

    const { model, provider } = extractPropertiesFromMessage(lastUserMessage as any);

    currentMessages.push({ id: generateId(), role: 'assistant', content: text });
    currentMessages.push({
      id: generateId(),
      role: 'user',
      content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${retryPrompt}`,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function buildTools(
  params: StreamOrchestratorParams,
  config: StreamModeConfig,
  mcpService: MCPService,
): Record<string, any> {
  const hasExistingFiles = params.files && Object.keys(params.files).length > 0;

  const toolContext: ToolContext = {
    files: hasExistingFiles ? params.files : undefined,
    sandboxId: params.sandboxId,
    openRouterApiKey: (process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_API_KEY) as string | undefined,
    searchApiKey: (process.env.TAVILY_API_KEY ?? process.env.SERPAPI_KEY) as string | undefined,
    mode: config.mode,
    requestId: params.requestId,
  };

  // Get tools from the registry (mode-aware)
  const registryTools = toolRegistry.getToolsForMode(config.mode, toolContext);

  // Start with MCP tools (external connectors)
  const toolsForRequest: Record<string, any> = {
    ...mcpService.toolsWithoutExecute,
  };

  // Add registry tools, with conditional filtering for code-mode tools
  for (const [name, toolObj] of Object.entries(registryTools)) {
    // Skip file tools when there are no files (code mode, fresh build)
    if (!hasExistingFiles && (name === 'read_file' || name === 'list_files')) {
      continue;
    }

    // Skip sandbox tools when there's no sandbox (code mode, before build)
    if (!params.sandboxId && (name === 'run_shell' || name === 'screenshot' || name === 'read_sandbox_file')) {
      continue;
    }

    toolsForRequest[name] = toolObj;
  }

  return toolsForRequest;
}

function extractUserPromptText(messages: Messages): string {
  const lastUserMessage = messages.filter((x) => x.role === 'user').slice(-1)[0];

  if (typeof lastUserMessage?.content === 'string') {
    return lastUserMessage.content;
  }

  if (Array.isArray((lastUserMessage as any)?.content)) {
    return (lastUserMessage as any).content.map((p: any) => (p.type === 'text' ? p.text : '')).join(' ');
  }

  return '';
}

async function tryOrchestrator(
  dataStream: any,
  params: StreamOrchestratorParams,
  emitProgress: (label: string, status: ProgressAnnotation['status'], message: string) => void,
): Promise<boolean> {
  const userPromptText = extractUserPromptText(params.messages);

  try {
    const { PROVIDER_LIST } = await import('~/utils/constants');
    const lastUserMessage = params.messages.filter((x) => x.role === 'user').slice(-1)[0];
    const { model: orchestratorModel, provider: orchestratorProvider } = extractPropertiesFromMessage(
      lastUserMessage as any,
    );
    const providerObj = PROVIDER_LIST.find((p) => p.name === orchestratorProvider) || PROVIDER_LIST[0];

    if (!providerObj) {
      return false;
    }

    const modelInstance = providerObj.getModelInstance({
      model: orchestratorModel,
      serverEnv: params.env as any,
      apiKeys: params.apiKeys,
      providerSettings: params.providerSettings,
    });

    const orchestratorResult = await orchestrateBuild(userPromptText, modelInstance, (update) => {
      emitProgress(
        'orchestrator',
        update.type === 'error' ? 'error' : update.type === 'complete' ? 'complete' : 'in-progress',
        update.message,
      );
    });

    if (orchestratorResult.artifactText && orchestratorResult.artifactText.length > 50) {
      // Write artifact as text stream (type 0: protocol)
      const encoder = new TextEncoder();
      const textStream = new ReadableStream<Uint8Array>({
        start(controller) {
          const chunkSize = 4000;

          for (let i = 0; i < orchestratorResult.artifactText.length; i += chunkSize) {
            const chunk = orchestratorResult.artifactText.slice(i, i + chunkSize);
            const formatted = formatDataStreamPart('text', chunk);
            controller.enqueue(encoder.encode(formatted));
          }

          controller.close();
        },
      });

      dataStream.merge(textStream as any);

      emitProgress(
        'response',
        'complete',
        `Build complete — ${orchestratorResult.taskResults.filter((r) => r.success).length}/${orchestratorResult.taskResults.length} tasks succeeded`,
      );

      return true;
    }
  } catch (orchestratorErr) {
    logger.warn(
      `[stream-v2] Orchestrator failed: ${orchestratorErr instanceof Error ? orchestratorErr.message : String(orchestratorErr)}`,
    );
  }

  return false;
}

function handleError(error: any, config: StreamModeConfig): string {
  const errorMessage = error.message || 'Unknown error';
  const lowerMessage = errorMessage.toLowerCase();

  logger.error(`[stream-v2] Stream error (mode=${config.mode}):`, errorMessage, error?.cause || '');

  if (errorMessage.includes('model') && errorMessage.includes('not found')) {
    return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
  }

  if (errorMessage.includes('Invalid JSON response')) {
    return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues. Try selecting a different model or check your API key.';
  }

  if (lowerMessage.includes('forbidden') || lowerMessage.includes('403') || lowerMessage.includes('access denied')) {
    return 'Custom error: The AI provider rejected the request (Forbidden). The selected model may not be enabled for your API key, or your account has insufficient credits. Try selecting a different model.';
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
    return 'Custom error: Network error. Please check your connection and try again.';
  }

  return `Custom error: ${errorMessage}`;
}
