import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { readCatalog } from '~/lib/.server/llm/capability-registry';
import { candidatesFor, chooseModel, type Capability } from '~/lib/.server/llm/model-router';
import { readProviderKey } from '~/lib/.server/llm/user-keys';

/**
 * Which model handles which kind of work.
 *
 * GET returns, for every capability the router can answer, what is currently
 * assigned, what automatic would pick, and every model that qualifies — so
 * the settings screen never has to know what a capability means or how the
 * catalog is shaped.
 *
 *   POST   {capability, model}  → pin a model
 *   DELETE ?capability=image    → back to automatic
 *
 * Nothing here lists model names. The candidates come from the catalog, so a
 * model released tomorrow appears the moment the catalog refreshes.
 */

const CAPABILITIES: Capability[] = ['image', 'video', 'vision', 'reasoning', 'text'];

interface AssignmentRow {
  capability: string;
  provider: string;
  model: string;
}

async function readAssignments(
  supabase: NonNullable<Awaited<ReturnType<typeof getAuthedUser>>['supabase']>,
  userId: string,
): Promise<Map<string, AssignmentRow>> {
  const { data, error } = await supabase
    .from('model_assignments')
    .select('capability, provider, model')
    .eq('user_id', userId);

  if (error) {
    // Migration 0021 not applied yet — everything is automatic, which works.
    return new Map();
  }

  return new Map((data ?? []).map((r) => [(r as AssignmentRow).capability, r as AssignmentRow]));
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  }

  const env = getEnv(context);
  const active = await readProviderKey(supabase, user.id, env.API_KEY_ENCRYPTION_KEY);
  const provider = active?.provider;

  const catalog = provider ? await readCatalog(supabase, provider) : new Map();
  const assigned = await readAssignments(supabase, user.id);

  const capabilities = CAPABILITIES.map((capability) => {
    const candidates = candidatesFor(catalog, capability, provider);
    const auto = chooseModel(catalog, { capability, provider });
    const pinned = assigned.get(capability);

    /*
     * A pinned model that is no longer in the catalog is reported as such
     * rather than silently ignored. The provider retired it, or the user
     * switched keys — either way they should be told, not left believing a
     * setting is in force when the router has quietly fallen back.
     */
    const pinnedStillValid = pinned ? candidates.some((d) => d.model === pinned.model) : false;

    return {
      capability,
      assigned: pinned?.model ?? null,
      assignedIsStale: Boolean(pinned) && !pinnedStillValid,
      autoModel: auto?.model ?? null,
      autoReason: auto?.reason ?? null,
      candidates: candidates.slice(0, 40).map((d) => ({
        model: d.model,
        displayName: d.displayName,
        promptPerM: d.cost.promptPerM ?? null,
        completionPerM: d.cost.completionPerM ?? null,
        perSecond: d.cost.perSecond ?? null,
        contextTokens: d.limits.contextTokens ?? null,
        source: d.source,
        media: d.media ?? null,
      })),
      total: candidates.length,
    };
  });

  return Response.json({ provider: provider ?? null, capabilities }, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }

  if (request.method === 'DELETE') {
    const capability = new URL(request.url).searchParams.get('capability');

    if (!capability) {
      return Response.json({ ok: false, error: 'capability is required.' }, { status: 400, headers });
    }

    const { error } = await supabase
      .from('model_assignments')
      .delete()
      .eq('user_id', user.id)
      .eq('capability', capability);

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    return Response.json({ ok: true }, { headers });
  }

  const body = (await request.json().catch(() => ({}))) as { capability?: string; model?: string };
  const capability = body.capability as Capability | undefined;
  const model = body.model?.trim();

  if (!capability || !CAPABILITIES.includes(capability)) {
    return Response.json({ ok: false, error: 'Unknown capability.' }, { status: 400, headers });
  }

  if (!model) {
    return Response.json({ ok: false, error: 'model is required.' }, { status: 400, headers });
  }

  const env = getEnv(context);
  const active = await readProviderKey(supabase, user.id, env.API_KEY_ENCRYPTION_KEY);

  if (!active) {
    return Response.json({ ok: false, error: 'No provider is connected.' }, { status: 400, headers });
  }

  /*
   * The model has to be one that can actually do the job. Storing a text
   * model as the image model would fail later, at the provider, in a way that
   * looks like the feature is broken rather than like a setting is wrong.
   */
  const catalog = await readCatalog(supabase, active.provider);
  const qualifies = candidatesFor(catalog, capability, active.provider).some((d) => d.model === model);

  if (!qualifies) {
    return Response.json({ ok: false, error: `${model} cannot do ${capability}.` }, { status: 400, headers });
  }

  const { error } = await supabase.from('model_assignments').upsert(
    {
      user_id: user.id,
      capability,
      provider: active.provider,
      model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,capability' },
  );

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true, capability, model }, { headers });
}
