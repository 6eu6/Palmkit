import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createMistral } from '@ai-sdk/mistral';

export default class MistralProvider extends BaseProvider {
  name = 'Mistral';
  getApiKeyLink = 'https://console.mistral.ai/api-keys/';

  config = {
    apiTokenKey: 'MISTRAL_API_KEY',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'open-mistral-7b',
      label: 'Mistral 7B',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-mixtral-8x7b',
      label: 'Mistral 8x7B',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-mixtral-8x22b',
      label: 'Mistral 8x22B',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-codestral-mamba',
      label: 'Codestral Mamba',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'open-mistral-nemo',
      label: 'Mistral Nemo',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'ministral-8b-latest',
      label: 'Mistral 8B',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'mistral-small-latest',
      label: 'Mistral Small',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'codestral-latest',
      label: 'Codestral',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
    {
      name: 'mistral-large-latest',
      label: 'Mistral Large Latest',
      provider: 'Mistral',
      maxTokenAllowed: 8000,
      maxCompletionTokens: 8192,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'MISTRAL_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    const response = await fetch('https://api.mistral.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { data: Array<{ id: string; max_context_length?: number }> };
    const staticIds = this.staticModels.map((m) => m.name);

    return data.data
      .filter(
        (m) =>
          m.id.startsWith('mistral') ||
          m.id.startsWith('codestral') ||
          m.id.startsWith('open-') ||
          m.id.startsWith('ministral'),
      )
      .filter((m) => !staticIds.includes(m.id))
      .map((m) => ({
        name: m.id,
        label: m.id,
        provider: this.name,
        maxTokenAllowed: m.max_context_length ?? 32768,
        maxCompletionTokens: 8192,
      }));
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
      defaultApiTokenKey: 'MISTRAL_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const mistral = createMistral({
      apiKey,
    });

    return mistral(model);
  }
}
