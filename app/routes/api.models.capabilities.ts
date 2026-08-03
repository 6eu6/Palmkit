import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { readProviderKey } from '~/lib/.server/llm/user-keys';
import { readCatalog, resolveDescriptors } from '~/lib/.server/llm/capability-registry';
import { LLMManager } from '~/lib/modules/llm/manager';

/**
 * What each model can do.
 *
 *  - GET  ?provider=X       → descriptors for that provider, catalog only.
 *  - POST { provider }      → resolve and, where nothing else knows, PROBE.
 *
 * The split is deliberate: reading is free and happens on every page that
 * lists models, while probing spends money and takes seconds, so it only runs
 * when a user explicitly connects or refreshes a provider.
 */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  }

  const provider = new URL(request.url).searchParams.get('provider') ?? undefined;
  const catalog = await readCatalog(supabase, provider);

  return Response.json({ descriptors: [...catalog.values()] }, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  }

  const body = (await request.json().catch(() => ({}))) as {
    provider?: string;
    models?: string[];
    probe?: boolean;
    force?: boolean;
  };

  const provider = (body.provider ?? '').trim();

  if (!provider) {
    return Response.json({ error: 'provider is required' }, { status: 400, headers });
  }

  const env = getEnv(context);

  /*
   * The key for THIS provider, not merely the active one — resolving
   * Anthropic's models with an OpenRouter key would fail confusingly.
   */
  const stored = await readProviderKey(supabase, user.id, env.API_KEY_ENCRYPTION_KEY, provider);

  /*
   * Probing needs the user's own key — we are calling the provider as them.
   * Without one we still resolve from metadata and the catalog, which covers
   * OpenRouter entirely and most well-known models everywhere else.
   */
  const apiKey = stored?.key;

  let models = body.models ?? [];

  if (!models.length) {
    try {
      const manager = LLMManager.getInstance(env as unknown as Record<string, string>);
      const found = manager.getModelListFromProvider
        ? await manager.getModelListFromProvider(manager.getProvider(provider)!, {
            apiKeys: apiKey ? { [provider]: apiKey } : {},
            providerSettings: {},
            serverEnv: env as never,
          })
        : [];
      models = found.map((m) => m.name);
    } catch {
      models = [];
    }
  }

  if (!models.length) {
    return Response.json({ descriptors: [], note: 'no models to resolve' }, { headers });
  }

  const { descriptors, cacheError } = await resolveDescriptors({
    supabase,
    provider,
    models,
    apiKey,
    baseUrl: PROBE_BASE_URLS[provider],
    allowProbe: Boolean(body.probe && apiKey),
    force: Boolean(body.force),
  });

  return Response.json(
    {
      descriptors,
      cached: !cacheError,

      /*
       * Surfaced, not swallowed: resolving works without the shared catalog,
       * but every user then pays the round trip that one of them should have
       * paid once. The caller needs to know it is running degraded.
       */
      ...(cacheError ? { cacheError } : {}),
    },
    { headers },
  );
}

/**
 * OpenAI-compatible endpoints, for the probe.
 *
 * A provider absent from this map is simply never probed — it falls back to
 * the catalog and the heuristic rather than being called in a shape it does
 * not speak.
 */
const PROBE_BASE_URLS: Record<string, string> = {
  OpenAI: 'https://api.openai.com/v1',
  OpenRouter: 'https://openrouter.ai/api/v1',
  Groq: 'https://api.groq.com/openai/v1',
  Together: 'https://api.together.xyz/v1',
  Deepseek: 'https://api.deepseek.com/v1',
  Mistral: 'https://api.mistral.ai/v1',
  xAI: 'https://api.x.ai/v1',
  Perplexity: 'https://api.perplexity.ai',
  Cerebras: 'https://api.cerebras.ai/v1',
  Moonshot: 'https://api.moonshot.ai/v1',
  Hyperbolic: 'https://api.hyperbolic.xyz/v1',
  Fireworks: 'https://api.fireworks.ai/inference/v1',
  ZAI: 'https://api.z.ai/api/paas/v4',
};
