/**
 * Model Capability Classifier
 *
 * Categorizes LLM models by their capabilities based on model name patterns.
 * This is used to filter the model list shown in each "Models per task"
 * dropdown — so the Brain dropdown only shows reasoning-capable models,
 * the Media dropdown only shows image/video models, etc.
 *
 * The classification is heuristic (regex-based) because most providers
 * don't expose a structured capability field. We err on the side of
 * "general" when uncertain — a general-purpose model can be assigned to
 * any role, but a specialized model (e.g., image-only) should only appear
 * in the role it supports.
 */

/**
 * Model capability flags.
 * - text:      general chat / code generation (the default for most LLMs)
 * - vision:    can process images (multimodal input)
 * - image:     can generate images (output modality)
 * - video:     can generate video (output modality)
 * - reasoning: extended thinking / chain-of-thought (o1, R1, etc.)
 * - code:      optimized for code generation (Coder, Code, DeepSeek-Coder, etc.)
 */
export type ModelCapability = 'text' | 'vision' | 'image' | 'video' | 'reasoning' | 'code';

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  image: boolean;
  video: boolean;
  reasoning: boolean;
  code: boolean;
}

const EMPTY_CAPABILITIES: ModelCapabilities = {
  text: false,
  vision: false,
  image: false,
  video: false,
  reasoning: false,
  code: false,
};

/*
 * Pattern tables — order matters (most specific first).
 * Each pattern matches against the lowercase model name (without provider prefix).
 */

/** Models that can generate images as output. */
const IMAGE_GEN_PATTERNS: RegExp[] = [
  /dall-?e/i,
  /stable-?diffusion/i,
  /sd[-_]?xl/i,
  /sd[-_]?3/i,
  /flux/i,
  /midjourney/i,
  /imagen/i,
  /cogview/i,
  /cog[-_]image/i,
  /kolors/i,
  /playground[-_]?v/i,
  /ideogram/i,
  /recraft/i,
  /leonardo/i,
  /firefly/i,
  /jasper/i,
  /dream[-_]?studio/i,
  /glif/i,
  /lumalabs/i,
  /lumia/i,
  /bfl[-_]?\.:/i,
  /black[-_]?forest/i,
  /gpt[-_]?5[-_]?image/i,
  /gpt[-_]?5\.[0-9]+[-_]?image/i,
  /inkling/i,
];

/** Models that can generate video as output. */
const VIDEO_GEN_PATTERNS: RegExp[] = [
  /sora/i,
  /runway/i,
  /pika/i,
  /cog[-_]?video/i,
  /kling/i,
  /luma[-_]?dream/i,
  /luma[-_]?ray/i,
  /stable[-_]?video/i,
  /svd/i,
  /animate[-_]?diff/i,
  /wan/i,
  /hailuo/i,
  /minimax[-_]?video/i,
  /veo/i,
];

/** Models with vision (multimodal image input). */
const VISION_INPUT_PATTERNS: RegExp[] = [
  /gpt-?4o/i,
  /gpt-?4[-_]?vision/i,
  /gpt-?4[-_]?turbo/i,
  /gpt-?4o[-_]?mini/i,
  /claude[-_]?3[-_]?5[-_]?sonnet/i,
  /claude[-_]?3[-_]?5[-_]?haiku/i,
  /claude[-_]?3[-_]?opus/i,
  /claude[-_]?3[-_]?sonnet/i,
  /claude[-_]?3[-_]?haiku/i,
  /claude[-_]?3[-_]?5/i,
  /gemini[-_]?1[-_.]?5/i,
  /gemini[-_]?2/i,
  /gemini[-_]?pro[-_]?vision/i,
  /gemini[-_]?ultra/i,
  /qwen[-_]?vl/i,
  /qwen[-_]?2[-_]?vl/i,
  /qwen[-_]?2[-_.]?5[-_]?vl/i,
  /internvl/i,
  /llava/i,
  /cogvlm/i,
  /cogagent/i,
  /glm[-_]?4v/i,
  /glm[-_]?4[-_]?v/i,
  /glm[-_]?5v/i,
  /glm[-_]?5[-_]?v/i,
  /glm[-_]?5[-_]?vl/i,
  /pixtral/i,
  /phi[-_]?3[-_]?vision/i,
  /phi[-_]?3[-_.]?5[-_]?vision/i,
  /moondream/i,
  /idefics/i,
  /florence/i,
  /kosmos/i,
  /mistral[-_]?pixtral/i,
];

/** Reasoning models (extended thinking / chain-of-thought). */
const REASONING_PATTERNS: RegExp[] = [
  /\bo1\b/i,
  /\bo3\b/i,
  /\bo4\b/i,
  /openai[-_]?o1/i,
  /openai[-_]?o3/i,
  /openai[-_]?o4/i,
  /reasoning/i,
  /\br1\b/i,
  /deepseek[-_]?r1/i,
  /deepseek[-_]?reason/i,
  /qwen[-_]?qwq/i,
  /qwq/i,
  /qwen[-_]?2[-_.]?5[-_]?max/i,
  /claude[-_]?thinking/i,
  /gemini[-_]?2[-_.]?0[-_]?flash[-_]?thinking/i,
  /gemini[-_]?thinking/i,
  /glm[-_]?zero/i,
  /glm[-_]?5\.\d/i,
  /o3[-_]?mini/i,
  /o1[-_]?mini/i,
  /nemotron.*nano.*omni/i,
  /sonar[-_]?reasoning/i,

  // GPT-5 base variants (NOT image/codex/mini/nano/chat — those are disqualified)
  /^gpt[-_]?5$/i,
  /^gpt[-_]?5\.[0-9]+$/i,

  // GLM-5 base (NOT glm-5v which is vision)
  /^glm[-_]?5$/i,
];

/**
 * Patterns that DISQUALIFY a model from being reasoning — even if a reasoning
 * pattern matches. For example, "gpt-5-image" should NOT be reasoning even
 * though "gpt-5" is. We check these first and skip reasoning classification.
 */
const REASONING_DISQUALIFY_PATTERNS: RegExp[] = [
  /gpt[-_]?5[-_]?image/i,
  /gpt[-_]?5[-_]?codex/i,
  /gpt[-_]?5\.[0-9]+[-_]?codex/i,
  /gpt[-_]?5[-_]?nano/i,
  /gpt[-_]?5[-_]?mini/i,
  /gpt[-_]?5[-_]?pro/i,
  /gpt[-_]?5[-_]?chat/i,
  /glm[-_]?5[-_]?v/i,
  /glm[-_]?5[-_]?image/i,
];

/** Code-optimized models. */
const CODE_PATTERNS: RegExp[] = [
  /code[-_]?llama/i,
  /codellama/i,
  /deepseek[-_]?coder/i,
  /deepseek[-_]?code/i,
  /qwen[-_]?2[-_.]?5[-_]?coder/i,
  /qwen[-_]?coder/i,
  /codestral/i,
  /codeqwen/i,
  /starcoder/i,
  /codegemma/i,
  /phind/i,
  /wizard[-_]?coder/i,
  /wizard[-_]?code/i,
  /magicoder/i,
  /openchat/i,
  /olmo[-_]?code/i,
  /code[-_]?t5/i,
  /codegen/i,
  /polycoder/i,
  /refact/i,
  /gpt[-_]?5[-_]?codex/i,
  /gpt[-_]?5\.[0-9]+[-_]?codex/i,
  /qwen3[-_]?coder/i,
  /glm[-_]?4[-_]?5/i,
  /glm[-_]?4\.5/i,
  /glm[-_]?4\.6/i,
];

/**
 * Strip the provider prefix from a model name.
 * "~anthropic/claude-sonnet-latest" → "claude-sonnet-latest"
 * "openai/gpt-4o" → "gpt-4o"
 */
function stripProviderPrefix(name: string): string {
  const slashIdx = name.lastIndexOf('/');

  return slashIdx >= 0 ? name.slice(slashIdx + 1) : name;
}

/**
 * Classify a model's capabilities based on its name.
 *
 * Returns a flags object. If no patterns match, the model is assumed to be
 * a general text model (text: true, everything else false).
 */
export function classifyModelCapabilities(modelName: string): ModelCapabilities {
  const stripped = stripProviderPrefix(modelName);
  const caps = { ...EMPTY_CAPABILITIES };

  // Check specialized modalities first (image/video gen)
  if (IMAGE_GEN_PATTERNS.some((re) => re.test(stripped))) {
    caps.image = true;
  }

  if (VIDEO_GEN_PATTERNS.some((re) => re.test(stripped))) {
    caps.video = true;
  }

  // Vision (input) — multimodal models
  if (VISION_INPUT_PATTERNS.some((re) => re.test(stripped))) {
    caps.vision = true;
    caps.text = true; // vision models also do text
  }

  // Reasoning — but only if not disqualified (e.g., gpt-5-image is NOT reasoning)
  const isDisqualified = REASONING_DISQUALIFY_PATTERNS.some((re) => re.test(stripped));

  if (!isDisqualified && REASONING_PATTERNS.some((re) => re.test(stripped))) {
    caps.reasoning = true;
    caps.text = true;
  }

  // Code-optimized
  if (CODE_PATTERNS.some((re) => re.test(stripped))) {
    caps.code = true;
    caps.text = true;
  }

  /*
   * Default: if nothing matched, it's a general text model
   * (most LLMs are text-capable even if not explicitly matched)
   */
  if (!caps.image && !caps.video && !caps.vision && !caps.reasoning && !caps.code) {
    caps.text = true;
  }

  /*
   * Image/video generation models are usually NOT general text models
   * (e.g., dall-e can't chat). But we keep text=true if it was already set
   * by another pattern (e.g., a multimodal model that also generates images).
   */
  if (caps.image && !caps.vision && !caps.reasoning && !caps.code) {
    caps.text = false;
  }

  if (caps.video && !caps.vision && !caps.reasoning && !caps.code) {
    caps.text = false;
  }

  return caps;
}

/**
 * Check if a model supports a given capability.
 */
export function modelSupports(modelName: string, capability: ModelCapability): boolean {
  const caps = classifyModelCapabilities(modelName);

  return caps[capability];
}

/**
 * Get a human-readable label for a model's primary capability.
 * Useful for badges in the UI.
 *
 * Returns the most specific capability (image > video > reasoning > code > vision > text).
 */
export function getModelCapabilityLabel(modelName: string): string {
  const caps = classifyModelCapabilities(modelName);

  if (caps.image) {
    return 'image';
  }

  if (caps.video) {
    return 'video';
  }

  if (caps.reasoning) {
    return 'reasoning';
  }

  if (caps.code) {
    return 'code';
  }

  if (caps.vision) {
    return 'vision';
  }

  return 'text';
}

/**
 * Get the icon name (Phosphor) for a model's primary capability.
 */
export function getModelCapabilityIcon(modelName: string): string {
  const label = getModelCapabilityLabel(modelName);

  switch (label) {
    case 'image':
      return 'ph:image-duotone';
    case 'video':
      return 'ph:video-camera-duotone';
    case 'reasoning':
      return 'ph:brain-duotone';
    case 'code':
      return 'ph:code-duotone';
    case 'vision':
      return 'ph:eye-duotone';
    default:
      return 'ph:chat-circle-text-duotone';
  }
}

/**
 * Filter a list of models by capability requirement.
 *
 * Returns models that support the `primary` capability OR the `secondary`
 * capability (if specified). General text models are only included if
 * `allowTextFallback` is true.
 *
 * The result is split into two groups so the UI can show a "Recommended"
 * section (primary capability matches) and a "Compatible" section
 * (secondary capability matches).
 */
export interface FilteredModels<T> {
  /** Models that match the primary capability (recommended). */
  recommended: T[];

  /** Models that match the secondary capability (compatible). */
  compatible: T[];

  /** Combined list (recommended + compatible), deduped. */
  all: T[];
}

export function filterModelsByCapability<T extends { name: string }>(
  models: T[],
  spec: {
    primary: ModelCapability;
    secondary?: ModelCapability;
    allowTextFallback: boolean;
  },
): FilteredModels<T> {
  const recommended: T[] = [];
  const compatible: T[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    if (seen.has(model.name)) {
      continue;
    }

    const caps = classifyModelCapabilities(model.name);
    seen.add(model.name);

    // Primary capability match → recommended
    if (caps[spec.primary]) {
      recommended.push(model);
      continue;
    }

    // Secondary capability match → compatible
    if (spec.secondary && caps[spec.secondary]) {
      compatible.push(model);
      continue;
    }

    // Text fallback (if allowed)
    if (spec.allowTextFallback && caps.text && spec.primary !== 'text') {
      compatible.push(model);
    }
  }

  return {
    recommended,
    compatible,
    all: [...recommended, ...compatible],
  };
}
