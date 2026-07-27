import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export default class XAIProvider extends BaseProvider {
  name = 'xAI';
  getApiKeyLink = 'https://docs.x.ai/docs/quickstart#creating-an-api-key';

  config = {
    apiTokenKey: 'XAI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    { name: 'grok-4', label: 'xAI Grok 4', provider: 'xAI', maxTokenAllowed: 256000 },
    { name: 'grok-4-07-09', label: 'xAI Grok 4 (07-09)', provider: 'xAI', maxTokenAllowed: 256000 },
    { name: 'grok-3-mini', label: 'xAI Grok 3 Mini', provider: 'xAI', maxTokenAllowed: 131000 },
    { name: 'grok-3-mini-fast', label: 'xAI Grok 3 Mini Fast', provider: 'xAI', maxTokenAllowed: 131000 },
    { name: 'grok-code-fast-1', label: 'xAI Grok Code Fast 1', provider: 'xAI', maxTokenAllowed: 131000 },
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
      defaultApiTokenKey: 'XAI_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    const response = await fetch('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { data: Array<{ id: string; context_length?: number }> };
    const staticIds = this.staticModels.map((m) => m.name);

    return data.data
      .filter((m) => !staticIds.includes(m.id))
      .map((m) => ({
        name: m.id,
        label: m.id,
        provider: this.name,
        maxTokenAllowed: m.context_length ?? 131072,
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
      defaultApiTokenKey: 'XAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      baseURL: 'https://api.x.ai/v1',
      apiKey,
    });

    return openai(model);
  }
}
