import { convertToCoreMessages, streamText as _streamText, type Message } from 'ai';
import { MAX_TOKENS, PROVIDER_COMPLETION_LIMITS, isReasoningModel, type FileMap } from '~/lib/common/llm/constants';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, MODIFICATIONS_TAG_NAME, PROVIDER_LIST, WORK_DIR } from '~/utils/constants';
import type { IProviderSetting } from '~/types/model';
import { PromptLibrary } from '~/lib/common/prompt-library';
import { allowedHTMLElements } from '~/utils/markdown';
import { LLMManager } from '~/lib/modules/llm/manager';
import { createScopedLogger } from '~/utils/logger';
import { createFilesContext, extractPropertiesFromMessage } from './utils';
import type { DesignScheme } from '~/types/design-scheme';
import { DEFAULT_EFFORT, effortProviderOptions, type Effort } from '~/lib/modules/llm/effort';
import type { ModelDescriptor } from '~/lib/modules/llm/model-descriptor';

export type Messages = Message[];

export interface StreamingOptions extends Omit<Parameters<typeof _streamText>[0], 'model'> {
  supabaseConnection?: {
    isConnected: boolean;
    hasSelectedProject: boolean;
    credentials?: {
      anonKey?: string;
      supabaseUrl?: string;
    };
  };
}

const logger = createScopedLogger('stream-text');

function getCompletionTokenLimit(modelDetails: any): number {
  // 1. If model specifies completion tokens, use that
  if (modelDetails.maxCompletionTokens && modelDetails.maxCompletionTokens > 0) {
    return modelDetails.maxCompletionTokens;
  }

  // 2. Use provider-specific default
  const providerDefault = PROVIDER_COMPLETION_LIMITS[modelDetails.provider];

  if (providerDefault) {
    return providerDefault;
  }

  // 3. Final fallback to MAX_TOKENS, but cap at reasonable limit for safety
  return Math.min(MAX_TOKENS, 16384);
}

function sanitizeText(text: string): string {
  let sanitized = text.replace(/<div class=\\"__boltThought__\\">.*?<\/div>/s, '');
  sanitized = sanitized.replace(/<think>.*?<\/think>/s, '');
  sanitized = sanitized.replace(/<boltAction type="file" filePath="package-lock\.json">[\s\S]*?<\/boltAction>/g, '');

  return sanitized.trim();
}

export async function streamText(props: {
  messages: Omit<Message, 'id'>[];
  env?: Env;
  options?: StreamingOptions;
  apiKeys?: Record<string, string>;
  files?: FileMap;
  providerSettings?: Record<string, IProviderSetting>;
  promptId?: string;
  contextOptimization?: boolean;
  contextFiles?: FileMap;
  summary?: string;
  messageSliceId?: number;
  chatMode?: 'discuss' | 'build';
  designScheme?: DesignScheme;

  /** Memory block injected after system prompt (user profile + relevant facts). */
  memoryBlock?: string;

  /**
   * Override the system prompt entirely (skips PromptLibrary lookup).
   *
   * NOTE: This is now KEPT for backwards-compat but the chat API no
   * longer passes a discuss-specific prompt. The unified prompt in
   * prompts.ts lets the MODEL decide whether to answer, build, create
   * a file, or search — no hardcoded "discuss never builds" rule.
   */
  customSystemPrompt?: string;

  /**
   * How hard to think. Resolved into provider options against the model's
   * descriptor, so it is a no-op on a model that cannot be steered rather
   * than a parameter the provider will reject.
   */
  effort?: Effort;

  /** What the model can do, from the capability registry. */
  descriptor?: ModelDescriptor;
}) {
  const {
    messages,
    env: serverEnv,
    options,
    apiKeys,
    files,
    providerSettings,
    promptId,
    contextOptimization,
    contextFiles,
    summary,
    chatMode,
    designScheme,
    memoryBlock,
    customSystemPrompt,
  } = props;
  let currentModel = DEFAULT_MODEL;
  let currentProvider = DEFAULT_PROVIDER.name;
  let processedMessages = messages.map((message) => {
    const newMessage = { ...message };

    if (message.role === 'user') {
      const { model, provider, content } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;
      newMessage.content = sanitizeText(content);
    } else if (message.role === 'assistant') {
      newMessage.content = sanitizeText(message.content);
    }

    // Sanitize all text parts in parts array, if present
    if (Array.isArray(message.parts)) {
      newMessage.parts = message.parts.map((part) =>
        part.type === 'text' ? { ...part, text: sanitizeText(part.text) } : part,
      );
    }

    return newMessage;
  });

  const provider = PROVIDER_LIST.find((p) => p.name === currentProvider) || DEFAULT_PROVIDER;
  const staticModels = LLMManager.getInstance().getStaticModelListFromProvider(provider);
  let modelDetails = staticModels.find((m) => m.name === currentModel);

  if (!modelDetails) {
    const modelsList = [
      ...(provider.staticModels || []),
      ...(await LLMManager.getInstance().getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: serverEnv as any,
      })),
    ];

    if (!modelsList.length) {
      throw new Error(`No models found for provider ${provider.name}`);
    }

    modelDetails = modelsList.find((m) => m.name === currentModel);

    if (!modelDetails) {
      // Fallback to first model with warning
      logger.warn(
        `MODEL [${currentModel}] not found in provider [${provider.name}]. Falling back to first model. ${modelsList[0].name}`,
      );
      modelDetails = modelsList[0];
    }
  }

  const dynamicMaxTokens = modelDetails ? getCompletionTokenLimit(modelDetails) : Math.min(MAX_TOKENS, 16384);

  // Use model-specific limits directly - no artificial cap needed
  const safeMaxTokens = dynamicMaxTokens;

  logger.info(
    `Token limits for model ${modelDetails.name}: maxTokens=${safeMaxTokens}, maxTokenAllowed=${modelDetails.maxTokenAllowed}, maxCompletionTokens=${modelDetails.maxCompletionTokens}`,
  );

  let systemPrompt =
    customSystemPrompt ??
    PromptLibrary.getPropmtFromLibrary(promptId || 'default', {
      cwd: WORK_DIR,
      allowedHtmlElements: allowedHTMLElements,
      modificationTagName: MODIFICATIONS_TAG_NAME,
      designScheme,
      supabase: {
        isConnected: options?.supabaseConnection?.isConnected || false,
        hasSelectedProject: options?.supabaseConnection?.hasSelectedProject || false,
        credentials: options?.supabaseConnection?.credentials || undefined,
      },
    }) ??
    getSystemPrompt();

  // Skip context injection when using customSystemPrompt (discuss mode)
  if (!customSystemPrompt && chatMode === 'build' && contextFiles && contextOptimization) {
    const codeContext = createFilesContext(contextFiles, true);

    systemPrompt = `${systemPrompt}

    Below is the artifact containing the context loaded into context buffer for you to have knowledge of and might need changes to fullfill current user request.
    CONTEXT BUFFER:
    ---
    ${codeContext}
    ---
    `;

    if (summary) {
      systemPrompt = `${systemPrompt}
      below is the chat history till now
      CHAT SUMMARY:
      ---
      ${props.summary}
      ---
      `;

      if (props.messageSliceId) {
        processedMessages = processedMessages.slice(props.messageSliceId);
      } else {
        const lastMessage = processedMessages.pop();

        if (lastMessage) {
          processedMessages = [lastMessage];
        }
      }
    }
  }

  const effectiveLockedFilePaths = new Set<string>();

  if (files) {
    for (const [filePath, fileDetails] of Object.entries(files)) {
      if (fileDetails?.isLocked) {
        effectiveLockedFilePaths.add(filePath);
      }
    }
  }

  if (effectiveLockedFilePaths.size > 0) {
    const lockedFilesListString = Array.from(effectiveLockedFilePaths)
      .map((filePath) => `- ${filePath}`)
      .join('\n');
    systemPrompt = `${systemPrompt}

    IMPORTANT: The following files are locked and MUST NOT be modified in any way. Do not suggest or make any changes to these files. You can proceed with the request but DO NOT make any changes to these files specifically:
    ${lockedFilesListString}
    ---
    `;
  } else {
    logger.debug('No locked files in prompt.');
  }

  /*
   * Inject memory block (user profile + relevant facts) after all other context.
   * This is placed LAST in the system prompt so it's closest to the conversation
   * (better attention from the model) but still cache-friendly (changes rarely).
   */
  if (memoryBlock) {
    systemPrompt = `${systemPrompt}

    ## Memory

    You have persistent memory about this user, injected below. Treat it as
    background knowledge you already have. Never say "according to my memory"
    or mention the memory system unless the user asks about it directly.

    ${memoryBlock}
    `;
  }

  logger.info(`Sending llm call to ${provider.name} with model ${modelDetails.name}`);

  // Log reasoning model detection and token parameters
  const isReasoning = isReasoningModel(modelDetails.name);
  logger.info(
    `Model "${modelDetails.name}" is reasoning model: ${isReasoning}, using ${isReasoning ? 'maxCompletionTokens' : 'maxTokens'}: ${safeMaxTokens}`,
  );

  // Validate token limits before API call
  if (safeMaxTokens > (modelDetails.maxTokenAllowed || 128000)) {
    logger.warn(
      `Token limit warning: requesting ${safeMaxTokens} tokens but model supports max ${modelDetails.maxTokenAllowed || 128000}`,
    );
  }

  // Use maxCompletionTokens for reasoning models (o1, GPT-5), maxTokens for traditional models
  const tokenParams = isReasoning ? { maxCompletionTokens: safeMaxTokens } : { maxTokens: safeMaxTokens };

  // Filter out unsupported parameters for reasoning models
  const filteredOptions =
    isReasoning && options
      ? Object.fromEntries(
          Object.entries(options).filter(
            ([key]) =>
              ![
                'temperature',
                'topP',
                'presencePenalty',
                'frequencyPenalty',
                'logprobs',
                'topLogprobs',
                'logitBias',
              ].includes(key),
          ),
        )
      : options || {};

  logger.debug(
    `Options for "${modelDetails.name}": isReasoning=${isReasoning}, keys=[${Object.keys(filteredOptions).join(',')}]`,
  );

  /*
   * Unified prompt: the same smart prompt handles both discussion and building.
   * The AI intelligently decides when to discuss vs. when to produce artifacts
   * based on the user's message — no mode switching needed.
   *
   * providerOptions: pass reasoning config to OpenRouter for reasoning-capable
   * models (DeepSeek-R1, Anthropic thinking, GLM-5.2 reasoning, etc.). Without
   * this, OpenRouter returns reasoning content interleaved but the AI SDK
   * discards it because no providerOptions were set.
   */
  const isReasoningCapable =
    props.descriptor?.reasoning.supported ??
    (isReasoning || /\b(r1|reasoning|thinking|o1|o3|o4)\b/i.test(modelDetails.name));

  /*
   * Two separate things, deliberately merged here:
   *
   *   - reasoning must be ENABLED on OpenRouter or the AI SDK discards the
   *     reasoning content the model streams back;
   *   - the user's effort choice, which only says anything when the model can
   *     actually be steered. Balanced contributes nothing at all.
   *
   * Until now the effort the user picked never reached this call — it was
   * passed to the external build worker and nowhere else, so the control did
   * nothing in chat.
   */
  const effortOptions = effortProviderOptions(currentProvider, props.descriptor, props.effort ?? DEFAULT_EFFORT);

  const merged: Record<string, Record<string, unknown>> = {};

  if (currentProvider === 'OpenRouter' && isReasoningCapable) {
    merged.openrouter = { reasoning: { enabled: true } };
  }

  for (const [key, value] of Object.entries(effortOptions ?? {})) {
    merged[key] = { ...(merged[key] ?? {}), ...value };
  }

  const providerOptions = Object.keys(merged).length ? (merged as Record<string, Record<string, never>>) : undefined;

  const streamParams = {
    model: provider.getModelInstance({
      model: modelDetails.name,
      serverEnv,
      apiKeys,
      providerSettings,
    }),
    system: systemPrompt,
    ...tokenParams,
    messages: convertToCoreMessages(processedMessages as any),
    ...filteredOptions,
    ...(providerOptions ? { providerOptions } : {}),

    // Set temperature to 1 for reasoning models (required by OpenAI API)
    ...(isReasoning ? { temperature: 1 } : {}),
  };

  logger.debug(`Streaming "${modelDetails.name}": maxTokens=${safeMaxTokens}, isReasoning=${isReasoning}`);

  return await _streamText(streamParams);
}
