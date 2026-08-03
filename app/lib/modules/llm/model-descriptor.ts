/**
 * What a model can actually do — and how we know.
 *
 * This replaces a regex classifier that guessed capabilities from the model's
 * NAME. That approach cannot see a new model it has no pattern for, cannot
 * report price or context, and is wrong silently. Features built on it were
 * building on sand.
 *
 * A descriptor is assembled from up to four sources, highest confidence wins
 * field by field. Nothing here is a hardcoded list of models: the catalog is
 * data, and the probe asks the model itself.
 */

/** Where a fact came from. Higher is more trustworthy. */
export type CapabilitySource = 'provider-api' | 'probe' | 'catalog' | 'heuristic';

export const SOURCE_RANK: Record<CapabilitySource, number> = {
  'provider-api': 4,
  probe: 3,
  catalog: 2,
  heuristic: 1,
};

/** What the model accepts. */
export interface InputModalities {
  text: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
}

/** What the model produces. This is what picks image and video models apart. */
export interface OutputModalities {
  text: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  embedding: boolean;
}

export interface ReasoningSupport {
  /** The model reasons at all. */
  supported: boolean;

  /**
   * How hard it reasons can be asked for. Distinct from `supported`: DeepSeek
   * R1 always reasons but takes no effort parameter, while o3 takes one.
   */
  controllable: boolean;
}

export interface ToolSupport {
  functionCalling: boolean;
  structuredOutput: boolean;
  parallel: boolean;
}

export interface ModelLimits {
  contextTokens?: number;
  maxOutputTokens?: number;
}

/** USD per million tokens, as the provider states it. */
export interface ModelCost {
  promptPerM?: number;
  completionPerM?: number;
  cachedPromptPerM?: number;

  /**
   * Video is not sold by the token. It is sold by the second, and the rate
   * changes with resolution and whether audio comes with it, so there is no
   * single number and no way to compare it against a per-token price.
   */
  perSecond?: Record<string, number>;
}

/**
 * What a media model accepts beyond a prompt.
 *
 * Video models describe themselves with a different vocabulary entirely —
 * durations, aspect ratios, whether you may pin the first or last frame —
 * and none of it fits the token-shaped fields above. Absent for text models.
 */
export interface MediaOptions {
  /** Seconds of output the model will produce, e.g. [4, 6, 8]. */
  durations?: number[];

  aspectRatios?: string[];
  resolutions?: string[];
  sizes?: string[];

  /**
   * Which frames may be supplied as images. `first_frame` is what makes
   * image-to-video possible: hand it a picture and it animates from there.
   */
  frameImages?: string[];

  /** The model produces a soundtrack alongside the picture. */
  generatesAudio?: boolean;
}

export interface ModelDescriptor {
  provider: string;
  model: string;
  displayName?: string;

  input: InputModalities;
  output: OutputModalities;
  reasoning: ReasoningSupport;
  tools: ToolSupport;
  limits: ModelLimits;
  cost: ModelCost;

  /** Present only for models that produce video or images. */
  media?: MediaOptions;

  /** Where the bulk of this came from, and how much to trust it. */
  source: CapabilitySource;
  confidence: number;

  /** ISO timestamp of the last time anything here was established. */
  verifiedAt?: string;
}

/**
 * A partial descriptor from one source, before merging.
 *
 * Every field is optional because a source knows what it knows: OpenRouter
 * states modalities and price but not whether tools run in parallel; a probe
 * establishes tool support but learns nothing about price.
 */
export interface DescriptorFragment {
  displayName?: string;
  input?: Partial<InputModalities>;
  output?: Partial<OutputModalities>;
  reasoning?: Partial<ReasoningSupport>;
  tools?: Partial<ToolSupport>;
  limits?: ModelLimits;
  cost?: ModelCost;
  media?: MediaOptions;
  source: CapabilitySource;
}

const EMPTY_INPUT: InputModalities = { text: true, image: false, audio: false, video: false, pdf: false };
const EMPTY_OUTPUT: OutputModalities = { text: true, image: false, audio: false, video: false, embedding: false };

export function emptyDescriptor(provider: string, model: string): ModelDescriptor {
  return {
    provider,
    model,
    input: { ...EMPTY_INPUT },
    output: { ...EMPTY_OUTPUT },
    reasoning: { supported: false, controllable: false },
    tools: { functionCalling: false, structuredOutput: false, parallel: false },
    limits: {},
    cost: {},
    source: 'heuristic',
    confidence: 0,
  };
}

/**
 * Fold fragments into one descriptor.
 *
 * Merged FIELD BY FIELD rather than whole-object, so a low-confidence source
 * can still fill a gap a high-confidence one left empty — a probe proves tool
 * support without knowing the price the catalog already told us. The resulting
 * `source` and `confidence` describe the strongest source that contributed.
 */
export function mergeFragments(provider: string, model: string, fragments: DescriptorFragment[]): ModelDescriptor {
  const out = emptyDescriptor(provider, model);

  // Weakest first, so stronger sources overwrite as we go.
  const ordered = [...fragments].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);

  let best: CapabilitySource = 'heuristic';

  for (const f of ordered) {
    if (SOURCE_RANK[f.source] > SOURCE_RANK[best]) {
      best = f.source;
    }

    if (f.displayName) {
      out.displayName = f.displayName;
    }

    Object.assign(out.input, f.input ?? {});
    Object.assign(out.output, f.output ?? {});
    Object.assign(out.reasoning, f.reasoning ?? {});
    Object.assign(out.tools, f.tools ?? {});

    for (const [k, v] of Object.entries(f.limits ?? {})) {
      if (v !== undefined) {
        (out.limits as Record<string, number>)[k] = v as number;
      }
    }

    for (const [k, v] of Object.entries(f.cost ?? {})) {
      if (v !== undefined) {
        (out.cost as Record<string, unknown>)[k] = v;
      }
    }

    /*
     * Only media models carry this, so it stays absent rather than becoming
     * an empty object on every text model in the catalog.
     */
    if (f.media) {
      out.media = { ...(out.media ?? {}), ...f.media };
    }
  }

  out.source = best;
  out.confidence = fragments.length ? CONFIDENCE[best] : 0;
  out.verifiedAt = new Date().toISOString();

  return out;
}

const CONFIDENCE: Record<CapabilitySource, number> = {
  'provider-api': 1,
  probe: 1,
  catalog: 0.9,
  heuristic: 0.3,
};

/* ── Queries. Features ask these, never a model name. ─────────────────────── */

export function canSeeImages(d: ModelDescriptor): boolean {
  return d.input.image;
}

export function makesImages(d: ModelDescriptor): boolean {
  return d.output.image;
}

export function makesVideo(d: ModelDescriptor): boolean {
  return d.output.video;
}

export function canUseTools(d: ModelDescriptor): boolean {
  return d.tools.functionCalling;
}

export function reasons(d: ModelDescriptor): boolean {
  return d.reasoning.supported;
}

/** Rough price of a turn, for ranking. Zero when the provider states nothing. */
export function blendedCost(d: ModelDescriptor): number {
  const prompt = d.cost.promptPerM ?? 0;
  const completion = d.cost.completionPerM ?? 0;

  // Weighted for a typical turn: far more prompt than completion.
  return prompt * 0.75 + completion * 0.25;
}
