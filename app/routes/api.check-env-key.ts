import type { LoaderFunction } from '@remix-run/cloudflare';
import { LLMManager } from '~/lib/modules/llm/manager';
import { apiKeysForRequest } from '~/lib/.server/llm/user-keys';

export const loader: LoaderFunction = async ({ context, request }) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');

  if (!provider) {
    return Response.json({ isSet: false });
  }

  const llmManager = LLMManager.getInstance(context?.cloudflare?.env as any);
  const providerInstance = llmManager.getProvider(provider);

  if (!providerInstance || !providerInstance.config.apiTokenKey) {
    return Response.json({ isSet: false });
  }

  const envVarName = providerInstance.config.apiTokenKey;

  const apiKeys = await apiKeysForRequest(request, context);

  /*
   * Whether a key exists, in order of precedence:
   *   1. The signed-in user's own key, from their account
   *   2. Server environment (Cloudflare env)
   *   3. Process environment (.env.local)
   *   4. LLMManager environment
   *
   * Only ever a boolean leaves here — the key itself does not.
   */
  const isSet = !!(
    apiKeys?.[provider] ||
    (context?.cloudflare?.env as Record<string, any>)?.[envVarName] ||
    process.env[envVarName] ||
    llmManager.env[envVarName]
  );

  return Response.json({ isSet });
};
