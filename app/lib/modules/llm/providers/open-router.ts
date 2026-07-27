import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

interface OpenRouterModel {
  name: string;
  id: string;
  context_length: number;
  pricing: {
    prompt: number;
    completion: number;
  };

  /*
   * OpenRouter's /models API also returns top_provider.max_completion_tokens
   * for models that publish it. We use it to set maxCompletionTokens on the
   * ModelInfo so stream-text.ts doesn't fall back to the conservative
   * PROVIDER_COMPLETION_LIMITS (16K for OpenRouter) — which truncates
   * large code-generation responses mid-file.
   */
  top_provider?: {
    max_completion_tokens?: number;
  };

  /*
   * Some models also expose a top-level max_completion_tokens field.
   */
  max_completion_tokens?: number;
}

interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export default class OpenRouterProvider extends BaseProvider {
  name = 'OpenRouter';
  getApiKeyLink = 'https://openrouter.ai/settings/keys';

  config = {
    apiTokenKey: 'OPEN_ROUTER_API_KEY',
  };

  staticModels: ModelInfo[] = [
    {
      name: '~anthropic/claude-sonnet-latest',
      label: 'Claude Sonnet (Latest)',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },
    {
      name: '~anthropic/claude-haiku-latest',
      label: 'Claude Haiku (Latest)',
      provider: 'OpenRouter',
      maxTokenAllowed: 200000,
    },
    {
      name: '~anthropic/claude-fable-latest',
      label: 'Claude Fable (Latest)',
      provider: 'OpenRouter',
      maxTokenAllowed: 1000000,
    },
    {
      name: 'openai/gpt-4o',
      label: 'GPT-4o',
      provider: 'OpenRouter',
      maxTokenAllowed: 128000,
    },
  ];

  async getDynamicModels(
    _apiKeys?: Record<string, string>,
    _settings?: IProviderSetting,
    _serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = (await response.json()) as OpenRouterModelsResponse;

      return data.data
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => {
          // Get accurate context window from OpenRouter API
          const contextWindow = m.context_length || 32000;

          // Cap at reasonable limits to prevent issues (OpenRouter has some very large models)
          const maxAllowed = 1000000; // 1M tokens max for safety
          const finalContext = Math.min(contextWindow, maxAllowed);

          /*
           * Extract max_completion_tokens from the OpenRouter API response.
           * OpenRouter returns it in either:
           *   - m.top_provider.max_completion_tokens (preferred, per-provider)
           *   - m.max_completion_tokens (top-level fallback)
           *
           * This is CRITICAL: without it, stream-text.ts falls back to
           * PROVIDER_COMPLETION_LIMITS['OpenRouter'] = 16384, which truncates
           * large code-generation responses mid-file. With it, models like
           * GLM-5.2 (65536), Claude Sonnet (8192+), GPT-4o (16384+) all
           * get their full output capacity.
           */
          const rawMaxCompletion = m.top_provider?.max_completion_tokens ?? m.max_completion_tokens ?? 0;
          const maxCompletionTokens = rawMaxCompletion > 0 ? rawMaxCompletion : undefined;

          return {
            name: m.id,
            label: `${m.name} - in:$${(m.pricing.prompt * 1_000_000).toFixed(2)} out:$${(m.pricing.completion * 1_000_000).toFixed(2)} - context ${finalContext >= 1000000 ? Math.floor(finalContext / 1000000) + 'M' : Math.floor(finalContext / 1000) + 'k'}`,
            provider: this.name,
            maxTokenAllowed: finalContext,
            maxCompletionTokens,
          };
        });
    } catch (error) {
      console.error('Error getting OpenRouter models:', error);
      return [];
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'OPEN_ROUTER_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    /*
     * OpenRouter requires HTTP-Referer and X-Title headers for production
     * applications. Without them, requests from server-side runtimes
     * (Cloudflare Workers) can be rejected with a 403 Forbidden even when
     * the API key is valid and has credits — the request looks like an
     * unattributed bot. See:
     *   https://openrouter.ai/docs/api-reference/overview#headers
     *
     * The app URL/name are resolved at runtime so they work in both
     * production (palmkit.app) and preview deployments.
     */
    const appUrl = (typeof process !== 'undefined' && (process as any).env?.VITE_APP_URL) || 'https://palmkit.app';
    const appName = 'Palmkit';

    const openRouter = createOpenRouter({
      apiKey,
      headers: {
        'HTTP-Referer': appUrl,
        'X-Title': appName,
      },
    });
    const instance = openRouter.chat(model) as LanguageModelV1;

    return instance;
  }
}
