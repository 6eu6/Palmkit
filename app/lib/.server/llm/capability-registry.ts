import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mergeFragments,
  type DescriptorFragment,
  type ModelDescriptor,
  SOURCE_RANK,
} from '~/lib/modules/llm/model-descriptor';
import { catalogLookup } from '~/lib/modules/llm/sources/catalog';
import { fetchGoogleMetadata, fetchOpenRouterMetadata } from '~/lib/modules/llm/sources/provider-metadata';
import { classifyModelCapabilities } from '~/lib/modules/llm/capabilities';
import { probeModel } from './capability-probe';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('capability-registry');

/** How long a stored descriptor is trusted before it is worth re-establishing. */
const FRESH_FOR_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The one place that answers "what can this model do".
 *
 * Four layers, strongest first: what the provider says, what a probe proved,
 * what the catalog records, and — only when nothing else knows — the old
 * name-matching heuristic, clearly marked as unverified so the UI can say so
 * rather than presenting a guess as a fact.
 *
 * Results live in a catalog shared by every user, because the answer cannot
 * differ between them: a model either accepts an image or it does not.
 */

/** Layer 4. Kept as a floor, never as an authority. */
function heuristicFragment(model: string): DescriptorFragment {
  const c = classifyModelCapabilities(model);

  return {
    input: { text: c.text, image: c.vision },
    output: { text: c.text || c.code, image: c.image, video: c.video },
    reasoning: c.reasoning ? { supported: true, controllable: false } : undefined,
    source: 'heuristic',
  };
}

function rowToDescriptor(row: { provider: string; model: string; descriptor: unknown }): ModelDescriptor {
  return row.descriptor as ModelDescriptor;
}

export async function readCatalog(supabase: SupabaseClient, provider?: string): Promise<Map<string, ModelDescriptor>> {
  const out = new Map<string, ModelDescriptor>();

  try {
    let query = supabase.from('model_catalog').select('provider, model, descriptor');

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { data, error } = await query;

    if (error) {
      // Migration 0018 not applied yet — resolve live instead of failing.
      logger.warn(`Catalog unavailable: ${error.message}`);
      return out;
    }

    for (const row of data ?? []) {
      out.set(`${row.provider}::${row.model}`, rowToDescriptor(row as never));
    }
  } catch (err) {
    logger.warn(`Catalog read failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return out;
}

async function writeCatalog(supabase: SupabaseClient, descriptors: ModelDescriptor[]): Promise<void> {
  if (!descriptors.length) {
    return;
  }

  const rows = descriptors.map((d) => ({
    provider: d.provider,
    model: d.model,
    descriptor: d,
    source: d.source,
    confidence: d.confidence,
    verified_at: d.verifiedAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('model_catalog').upsert(rows, { onConflict: 'provider,model' });

  if (error) {
    logger.warn(`Catalog write failed: ${error.message}`);
  }
}

function isFresh(d: ModelDescriptor | undefined): boolean {
  if (!d?.verifiedAt) {
    return false;
  }

  return Date.now() - Date.parse(d.verifiedAt) < FRESH_FOR_MS;
}

export interface ResolveOptions {
  supabase: SupabaseClient;
  provider: string;
  models: string[];

  /** Needed for metadata endpoints that require one, and for probing. */
  apiKey?: string;

  /** OpenAI-compatible base URL. Absent means this provider cannot be probed. */
  baseUrl?: string;

  /** Probing costs money and time; callers opt in. */
  allowProbe?: boolean;
}

/**
 * Resolve descriptors for a provider's models.
 *
 * Cheap paths first: anything already established and still fresh is returned
 * from the shared catalog without a single network call. Only what is left
 * over reaches the metadata endpoints, and only what those cannot answer is
 * probed — and probing happens at most once per model for the whole install.
 */
export async function resolveDescriptors(opts: ResolveOptions): Promise<ModelDescriptor[]> {
  const { supabase, provider, models, apiKey, baseUrl, allowProbe = false } = opts;

  const stored = await readCatalog(supabase, provider);
  const resolved: ModelDescriptor[] = [];
  const fresh: ModelDescriptor[] = [];
  const stale: string[] = [];

  for (const model of models) {
    const hit = stored.get(`${provider}::${model}`);

    if (isFresh(hit) && hit) {
      fresh.push(hit);
    } else {
      stale.push(model);
    }
  }

  resolved.push(...fresh);

  if (!stale.length) {
    return resolved;
  }

  // ── Layer 1: what the provider says about itself ──────────────────────────
  let metadata = new Map<string, DescriptorFragment>();

  try {
    if (provider === 'OpenRouter') {
      metadata = await fetchOpenRouterMetadata();
    } else if (provider === 'Google' && apiKey) {
      metadata = await fetchGoogleMetadata(apiKey);
    }
  } catch (err) {
    logger.warn(`Metadata fetch failed for ${provider}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const written: ModelDescriptor[] = [];

  for (const model of stale) {
    const fragments: DescriptorFragment[] = [heuristicFragment(model)];

    const fromCatalog = catalogLookup(model);

    if (fromCatalog) {
      fragments.push(fromCatalog);
    }

    const fromProvider = metadata.get(model);

    if (fromProvider) {
      fragments.push(fromProvider);
    }

    /*
     * Probe only what is still unexplained. A model the provider described, or
     * one the catalog covers, has nothing left worth paying to discover — so a
     * user connecting OpenRouter never pays for a single probe.
     */
    const best = Math.max(...fragments.map((f) => SOURCE_RANK[f.source]));
    const needsProbe = allowProbe && best < SOURCE_RANK.catalog && apiKey && baseUrl;

    if (needsProbe) {
      const { fragment, unusable } = await probeModel({ baseUrl: baseUrl!, apiKey: apiKey!, model });

      if (fragment) {
        fragments.push(fragment);
      } else {
        logger.warn(`Probe skipped for ${provider}/${model}: ${unusable}`);
      }
    }

    const descriptor = mergeFragments(provider, model, fragments);
    resolved.push(descriptor);

    /*
     * A heuristic guess is never written to the SHARED catalog — it would be
     * indistinguishable from an established fact the next time anyone reads
     * it, and would stop the model ever being probed properly.
     */
    if (descriptor.source !== 'heuristic') {
      written.push(descriptor);
    }
  }

  await writeCatalog(supabase, written);

  return resolved;
}
