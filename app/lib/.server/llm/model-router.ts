import type { ModelDescriptor } from '~/lib/modules/llm/model-descriptor';

/**
 * Which model to use for a job that is not the one the user picked.
 *
 * The composer chip selects the model that writes the replies. It cannot be
 * the model that draws a picture: a text model has no image output, and
 * asking one to generate an image is the request that used to fail. So when a
 * tool needs a different kind of model, it asks here.
 *
 * The answer comes from the catalog, which is established fact — 337 models
 * whose modalities and prices the provider publishes. Nothing here contains a
 * list of model names, so a model released tomorrow is eligible the moment
 * the catalog refreshes.
 */

export type Capability = 'image' | 'video' | 'audio' | 'vision' | 'reasoning' | 'text';

export interface RouteRequest {
  capability: Capability;

  /** Only consider models from this provider (the user's active key). */
  provider?: string;

  /** An explicit choice always wins, if it is in the catalog and qualifies. */
  preferred?: string;
}

export interface Route {
  model: string;
  descriptor: ModelDescriptor;

  /** Why this one, in words a user can read. */
  reason: string;
}

/** Does this descriptor satisfy the capability at all? */
function qualifies(d: ModelDescriptor, c: Capability): boolean {
  switch (c) {
    case 'image':
      return d.output.image;
    case 'video':
      return d.output.video;
    case 'audio':
      return d.output.audio;
    case 'vision':
      return d.input.image;
    case 'reasoning':
      return d.reasoning.supported;
    case 'text':
      return d.output.text;
    default:
      return false;
  }
}

/**
 * What "cheapest" means, which differs by what you are buying.
 *
 * Text is priced per million tokens and video per second of output, so the
 * numbers are not comparable across capabilities — only within one. Anything
 * with no price at all sorts last rather than first: a missing price is
 * unknown, not free, and treating it as free would route every request to the
 * model we know the least about.
 */
function price(d: ModelDescriptor): number {
  const p = d.cost.completionPerM ?? d.cost.promptPerM;

  /*
   * Negative is not cheap — it is OpenRouter's marker for "the price depends
   * on what this routes to", which `openrouter/auto` and `auto-beta` carry.
   * Sorted naively they came first at -$1,000,000 per million and won every
   * routing decision, so a request for an image would have gone to a meta
   * router rather than to a model that draws. Unknown sorts last, which is
   * also what a missing price does, because they mean the same thing.
   */
  return typeof p === 'number' && p >= 0 ? p : Number.POSITIVE_INFINITY;
}

/**
 * Pick a model for the capability, or return undefined if the catalog holds
 * none — which is a real answer, and better than routing to something that
 * cannot do the job and failing at the provider.
 */
export function chooseModel(catalog: Map<string, ModelDescriptor>, req: RouteRequest): Route | undefined {
  const candidates: ModelDescriptor[] = [];

  for (const d of catalog.values()) {
    if (req.provider && d.provider !== req.provider) {
      continue;
    }

    if (qualifies(d, req.capability)) {
      candidates.push(d);
    }
  }

  if (candidates.length === 0) {
    return undefined;
  }

  if (req.preferred) {
    const hit = candidates.find((d) => d.model === req.preferred);

    if (hit) {
      return { model: hit.model, descriptor: hit, reason: 'chosen in settings' };
    }
  }

  /*
   * Established facts first, then price. A heuristic guess that happens to be
   * cheap should never outrank a model the provider actually describes —
   * being wrong about what a model can do costs more than a few cents.
   */
  candidates.sort((a, b) => {
    const established = Number(b.source !== 'heuristic') - Number(a.source !== 'heuristic');

    if (established !== 0) {
      return established;
    }

    return price(a) - price(b);
  });

  const best = candidates[0];
  const p = price(best);

  return {
    model: best.model,
    descriptor: best,
    reason: Number.isFinite(p)
      ? `cheapest ${req.capability} model at $${p}/M`
      : `only ${req.capability} model available`,
  };
}

/** Every model that can do this, cheapest first. For the settings picker. */
export function candidatesFor(catalog: Map<string, ModelDescriptor>, c: Capability, provider?: string) {
  return [...catalog.values()]
    .filter((d) => (!provider || d.provider === provider) && qualifies(d, c))
    .sort((a, b) => price(a) - price(b));
}
