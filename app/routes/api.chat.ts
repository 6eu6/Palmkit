import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { isReasoningModel, MAX_RESPONSE_SEGMENTS, type FileMap } from '~/lib/common/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
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
        const streamOptions: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: mcpService.toolsWithoutExecute,
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
            [finishReason, text, usage] = await Promise.all([
              result.finishReason as Promise<string>,
              result.text as Promise<string>,
              result.usage as Promise<any>,
            ]);
          } catch (resultError: any) {
            logger.error(`Stream result error in segment ${continueSegmentCount + 1}: ${resultError.message}`);

            try {
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'error',
                order: progressCounter++,
                message: `Stream error: ${resultError.message || 'Unknown error'}`,
              } satisfies ProgressAnnotation);
            } catch {
              /* dataStream may already be closed */
            }
            streamRecovery?.stop();
            break;
          }

          logger.debug(`Segment ${continueSegmentCount + 1} finished: reason=${finishReason}, textLen=${text.length}`);

          if (usage) {
            cumulativeUsage.completionTokens += usage.completionTokens || 0;
            cumulativeUsage.promptTokens += usage.promptTokens || 0;
            cumulativeUsage.totalTokens += usage.totalTokens || 0;
          }

          /* Normal completion — no token limit hit */
          if (finishReason !== 'length') {
            streamRecovery?.stop();
            dataStream.writeMessageAnnotation({
              type: 'usage',
              value: {
                completionTokens: cumulativeUsage.completionTokens,
                promptTokens: cumulativeUsage.promptTokens,
                totalTokens: cumulativeUsage.totalTokens,
              },
            });
            dataStream.writeData({
              type: 'progress',
              label: 'response',
              status: 'complete',
              order: progressCounter++,
              message: 'Response Generated',
            } satisfies ProgressAnnotation);
            break;
          }

          /* Token limit hit — auto-continue */
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
          currentMessages.push({ id: generateId(), role: 'assistant', content: text });
          currentMessages.push({
            id: generateId(),
            role: 'user',
            content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
          });
        }
      },
      onError: (error: any) => {
        streamRecovery?.stop();

        // Provide more specific error messages for common issues
        const errorMessage = error.message || 'Unknown error';
        const lowerMessage = errorMessage.toLowerCase();

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
