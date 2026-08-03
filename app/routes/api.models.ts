import { json } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { ProviderInfo } from '~/types/model';
import { getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { readAllProviderKeys } from '~/lib/.server/llm/user-keys';

interface ModelsResponse {
  modelList: ModelInfo[];
  providers: ProviderInfo[];
  defaultProvider: ProviderInfo;
}

let cachedProviders: ProviderInfo[] | null = null;
let cachedDefaultProvider: ProviderInfo | null = null;

function getProviderInfo(llmManager: LLMManager) {
  if (!cachedProviders) {
    cachedProviders = llmManager.getAllProviders().map((provider) => ({
      name: provider.name,
      staticModels: provider.staticModels,
      getApiKeyLink: provider.getApiKeyLink,
      labelForGetApiKey: provider.labelForGetApiKey,
      icon: provider.icon,
    }));
  }

  if (!cachedDefaultProvider) {
    const defaultProvider = llmManager.getDefaultProvider();
    cachedDefaultProvider = {
      name: defaultProvider.name,
      staticModels: defaultProvider.staticModels,
      getApiKeyLink: defaultProvider.getApiKeyLink,
      labelForGetApiKey: defaultProvider.labelForGetApiKey,
      icon: defaultProvider.icon,
    };
  }

  return { providers: cachedProviders, defaultProvider: cachedDefaultProvider };
}

export async function loader({
  request,
  params,
  context,
}: {
  request: Request;
  params: { provider?: string };
  context: {
    cloudflare?: {
      env: Record<string, string>;
    };
  };
}): Promise<Response> {
  const llmManager = LLMManager.getInstance(context.cloudflare?.env);

  /*
   * Keys come from the account, not from the browser.
   *
   * This used to read them out of an `apiKeys` cookie the client had written,
   * which is why a decrypted key had to be sent to the browser in the first
   * place. The key was only ever used here, on the server — the browser was
   * carrying it purely to hand it back. Reading it from the database directly
   * removes the round trip and the exposure with it.
   *
   * Provider settings still come from the cookie: those are preferences
   * (enabled, base URL), not secrets.
   */
  const cookieHeader = request.headers.get('Cookie');
  const providerSettings = getProviderSettingsFromCookie(cookieHeader);

  let apiKeys: Record<string, string> = {};

  try {
    const { user, supabase } = await getAuthedUser(request, context as never);

    if (user && supabase) {
      apiKeys = await readAllProviderKeys(supabase, user.id, getEnv(context as never).API_KEY_ENCRYPTION_KEY);
    }
  } catch {
    /*
     * Signed out, or Supabase unset in a self-hosted deployment. Providers
     * still resolve keys from the server environment, so the static model
     * lists — and any env-configured provider — keep working.
     */
  }

  const { providers, defaultProvider } = getProviderInfo(llmManager);

  let modelList: ModelInfo[] = [];

  if (params.provider) {
    // Only update models for the specific provider
    const provider = llmManager.getProvider(params.provider);

    if (provider) {
      modelList = await llmManager.getModelListFromProvider(provider, {
        apiKeys,
        providerSettings,
        serverEnv: context.cloudflare?.env,
      });
    }
  } else {
    // Update all models
    modelList = await llmManager.updateModelList({
      apiKeys,
      providerSettings,
      serverEnv: context.cloudflare?.env,
    });
  }

  return json<ModelsResponse>({
    modelList,
    providers,
    defaultProvider,
  });
}
