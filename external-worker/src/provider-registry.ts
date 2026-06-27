/**
 * Provider Registry — maps provider names to Vercel AI SDK model instances.
 *
 * Mirrors the 22 providers in app/lib/modules/llm/providers/ so the worker
 * can call ANY provider the user has configured, not just OpenRouter.
 *
 * Each provider returns a LanguageModelV1 instance given (modelName, apiKey).
 * The worker's generator.ts uses this to make the LLM call.
 *
 * SUPPORTED PROVIDERS (matching app/lib/modules/llm/providers/):
 *   - OpenAI, Anthropic, Google, DeepSeek, Groq, xAI, Mistral, Cohere,
 *     Together, Perplexity, HuggingFace, Moonshot, Hyperbolic, GitHub,
 *     Cerebras, Fireworks, OpenRouter, Z.ai, Amazon Bedrock
 *   - Ollama, LM Studio (local — need user-supplied baseURL)
 *   - OpenAI-like (custom baseURL)
 *
 * Most providers use createOpenAI() with a custom baseURL (OpenAI-compatible API).
 * Anthropic, Google, Cohere, Mistral, Amazon Bedrock have dedicated SDK packages.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { LanguageModelV1 } from 'ai';
import { logger } from './logger';

interface ProviderConfig {
  /** The env var name the CF Pages app uses for this provider's key. */
  apiTokenKey: string;
  /** Factory that returns a LanguageModelV1 given the user's decrypted API key. */
  createModel: (modelName: string, apiKey: string, options?: Record<string, unknown>) => LanguageModelV1;
}

/**
 * Provider registry. Key = provider name as shown in the UI
 * (must match PROVIDER_LIST in the CF Pages app).
 */
const REGISTRY: Record<string, ProviderConfig> = {
  // ─── Dedicated SDK providers ────────────────────────────────────────────
  OpenAI: {
    apiTokenKey: 'OPENAI_API_KEY',
    createModel: (model, apiKey) => createOpenAI({ apiKey })(model),
  },
  Anthropic: {
    apiTokenKey: 'ANTHROPIC_API_KEY',
    createModel: (model, apiKey) => createAnthropic({ apiKey })(model),
  },
  Google: {
    apiTokenKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
    createModel: (model, apiKey) => createGoogleGenerativeAI({ apiKey })(model),
  },
  Cohere: {
    apiTokenKey: 'COHERE_API_KEY',
    createModel: (model, apiKey) => createCohere({ apiKey })(model),
  },
  Mistral: {
    apiTokenKey: 'MISTRAL_API_KEY',
    createModel: (model, apiKey) => createMistral({ apiKey })(model),
  },

  // ─── OpenAI-compatible providers (custom baseURL) ────────────────────────
  Deepseek: {
    apiTokenKey: 'DEEPSEEK_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1', name: 'deepseek' })(model),
  },
  Groq: {
    apiTokenKey: 'GROQ_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1', name: 'groq' })(model),
  },
  xAI: {
    apiTokenKey: 'XAI_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.x.ai/v1', name: 'xai' })(model),
  },
  Together: {
    apiTokenKey: 'TOGETHER_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1', name: 'together' })(model),
  },
  Perplexity: {
    apiTokenKey: 'PERPLEXITY_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.perplexity.ai/', name: 'perplexity' })(model),
  },
  HuggingFace: {
    apiTokenKey: 'HuggingFace_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api-inference.huggingface.co/v1/', name: 'huggingface' })(model),
  },
  Moonshot: {
    apiTokenKey: 'MOONSHOT_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.moonshot.ai/v1', name: 'moonshot' })(model),
  },
  Hyperbolic: {
    apiTokenKey: 'HYPERBOLIC_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.hyperbolic.xyz/v1/', name: 'hyperbolic' })(model),
  },
  GitHub: {
    apiTokenKey: 'GITHUB_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://models.github.ai/inference', name: 'github' })(model),
  },
  Cerebras: {
    apiTokenKey: 'CEREBRAS_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.cerebras.ai/v1', name: 'cerebras' })(model),
  },
  Fireworks: {
    apiTokenKey: 'FIREWORKS_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.fireworks.ai/inference/v1', name: 'fireworks' })(model),
  },

  // ─── Aggregator ──────────────────────────────────────────────────────────
  // Use createOpenAI with OpenRouter's OpenAI-compatible endpoint instead of
  // @openrouter/ai-sdk-provider which now requires ai ^5 (incompatible with
  // our ai ^4 SDK). OpenRouter's API accepts the ~ tilde prefix natively
  // (e.g. ~anthropic/claude-sonnet-latest resolves to the latest Claude Sonnet).
  OpenRouter: {
    apiTokenKey: 'OPENROUTER_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        headers: {
          'HTTP-Referer': 'https://palmkit.app',
          'X-Title': 'Palmkit Build Worker',
        },
      })(model),
  },

  // ─── Z.ai ─────────────────────────────────────────────────────────────
  'Z.ai': {
    apiTokenKey: 'ZAI_API_KEY',
    createModel: (model, apiKey) =>
      createOpenAI({ apiKey, baseURL: 'https://api.z.ai/api/paas/v4', name: 'zai' })(model),
  },

  // ─── Amazon Bedrock (needs AWS config) ────────────────────────────────────
  Amazon: {
    apiTokenKey: 'AWS_BEDROCK_API_KEY',
    createModel: (model, apiKey, options) => {
      const region = (options?.region as string) ?? process.env.AWS_BEDROCK_REGION ?? 'us-east-1';
      return createAmazonBedrock({
        region,
        accessKeyId: apiKey,
        secretAccessKey: (options?.secretAccessKey as string) ?? process.env.AWS_BEDROCK_SECRET ?? '',
      })(model);
    },
  },

  // ─── Local providers (need user-supplied baseURL) ───────────────────────────
  Ollama: {
    apiTokenKey: 'OLLAMA_API_KEY',
    createModel: (model, _apiKey, options) => {
      const baseUrl = (options?.baseURL as string) ?? 'http://localhost:11434';
      return createOpenAI({ baseURL: `${baseUrl}/v1`, name: 'ollama', apiKey: 'ollama' })(model);
    },
  },
  LMStudio: {
    apiTokenKey: 'LMSTUDIO_API_KEY',
    createModel: (model, _apiKey, options) => {
      const baseUrl = (options?.baseURL as string) ?? 'http://localhost:1234';
      return createOpenAI({ baseURL: `${baseUrl}/v1`, name: 'lmstudio', apiKey: 'lm-studio' })(model);
    },
  },

  // ─── OpenAI-compatible (user-supplied baseURL) ───────────────────────────────
  OpenAILike: {
    apiTokenKey: 'OPENAI_LIKE_API_KEY',
    createModel: (model, apiKey, options) => {
      const baseUrl = (options?.baseURL as string) ?? process.env.OPENAI_LIKE_BASE_URL;
      if (!baseUrl) throw new Error('OpenAILike provider requires a baseURL option.');
      return createOpenAI({ apiKey, baseURL: baseUrl, name: 'openailike' })(model);
    },
  },
};

/**
 * Get a model instance for the given provider + model + decrypted API key.
 *
 * @param providerName  e.g. 'OpenRouter', 'Anthropic', 'Deepseek'
 * @param modelName     e.g. '~anthropic/claude-sonnet-latest', 'claude-3-5-sonnet-20241022'
 * @param apiKey        The user's decrypted API key (from user_api_keys table)
 * @param options       Optional provider-specific settings (baseURL, region, etc.)
 */
export function getModelInstance(
  providerName: string,
  modelName: string,
  apiKey: string,
  options?: Record<string, unknown>,
): LanguageModelV1 {
  const config = REGISTRY[providerName];

  if (!config) {
    const supported = Object.keys(REGISTRY).join(', ');
    throw new Error(
      `Unknown provider: "${providerName}". Supported: ${supported}. ` +
        'Add new providers to external-worker/src/provider-registry.ts.',
    );
  }

  logger.info(`Creating model instance: provider=${providerName}, model=${modelName}`);
  return config.createModel(modelName, apiKey, options);
}

/**
 * List all supported provider names (for debugging / health checks).
 */
export function listSupportedProviders(): string[] {
  return Object.keys(REGISTRY);
}
