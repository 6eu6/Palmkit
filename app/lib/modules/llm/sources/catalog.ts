import type { DescriptorFragment } from '~/lib/modules/llm/model-descriptor';

/**
 * Layer 2 — a catalog for the providers that publish nothing.
 *
 * OpenAI, Anthropic, Groq, DeepSeek and the rest return model IDs and no
 * capabilities at all, so something has to say what those models do. This is
 * that something — but it is DATA keyed by exact model id, not logic. A wrong
 * or missing entry is corrected by editing a value, and a model that is not
 * listed still gets probed rather than guessed at.
 *
 * Entries are keyed by a prefix so a dated snapshot (`gpt-4o-2024-11-20`)
 * inherits from its family (`gpt-4o`) instead of needing its own row.
 */

type Entry = Omit<DescriptorFragment, 'source'>;

const TEXT_TOOLS: Entry = {
  input: { text: true },
  output: { text: true },
  tools: { functionCalling: true, structuredOutput: true, parallel: true },
};

const VISION_TOOLS: Entry = {
  input: { text: true, image: true },
  output: { text: true },
  tools: { functionCalling: true, structuredOutput: true, parallel: true },
};

/**
 * Longest matching prefix wins, so order in this table does not matter.
 * Prices are USD per million tokens as published; they move, and a stale price
 * only affects ranking, never whether something works.
 */
export const MODEL_CATALOG: Record<string, Entry> = {
  /* ── OpenAI ─────────────────────────────────────────────────────────── */
  'gpt-4o': { ...VISION_TOOLS, limits: { contextTokens: 128_000 }, cost: { promptPerM: 2.5, completionPerM: 10 } },
  'gpt-4o-mini': {
    ...VISION_TOOLS,
    limits: { contextTokens: 128_000 },
    cost: { promptPerM: 0.15, completionPerM: 0.6 },
  },
  'gpt-4.1': { ...VISION_TOOLS, limits: { contextTokens: 1_047_576 }, cost: { promptPerM: 2, completionPerM: 8 } },
  'gpt-4.1-mini': {
    ...VISION_TOOLS,
    limits: { contextTokens: 1_047_576 },
    cost: { promptPerM: 0.4, completionPerM: 1.6 },
  },
  'gpt-5': {
    ...VISION_TOOLS,
    reasoning: { supported: true, controllable: true },
    limits: { contextTokens: 400_000 },
  },
  o1: { ...VISION_TOOLS, reasoning: { supported: true, controllable: true }, limits: { contextTokens: 200_000 } },
  o3: { ...VISION_TOOLS, reasoning: { supported: true, controllable: true }, limits: { contextTokens: 200_000 } },
  'o4-mini': {
    ...VISION_TOOLS,
    reasoning: { supported: true, controllable: true },
    limits: { contextTokens: 200_000 },
  },
  'dall-e-3': { input: { text: true }, output: { text: false, image: true } },
  'gpt-image-1': { input: { text: true, image: true }, output: { text: false, image: true } },
  'text-embedding-3': { input: { text: true }, output: { text: false, embedding: true } },
  'whisper-1': { input: { text: false, audio: true }, output: { text: true } },
  'tts-1': { input: { text: true }, output: { text: false, audio: true } },

  /* ── Anthropic ──────────────────────────────────────────────────────── */
  'claude-3-5-haiku': {
    ...VISION_TOOLS,
    limits: { contextTokens: 200_000 },
    cost: { promptPerM: 0.8, completionPerM: 4 },
  },
  'claude-3-5-sonnet': {
    ...VISION_TOOLS,
    limits: { contextTokens: 200_000 },
    cost: { promptPerM: 3, completionPerM: 15 },
  },
  'claude-3-7-sonnet': {
    ...VISION_TOOLS,
    reasoning: { supported: true, controllable: true },
    limits: { contextTokens: 200_000 },
    cost: { promptPerM: 3, completionPerM: 15 },
  },
  'claude-sonnet-4': {
    ...VISION_TOOLS,
    reasoning: { supported: true, controllable: true },
    limits: { contextTokens: 200_000 },
    cost: { promptPerM: 3, completionPerM: 15 },
  },
  'claude-opus-4': {
    ...VISION_TOOLS,
    reasoning: { supported: true, controllable: true },
    limits: { contextTokens: 200_000 },
    cost: { promptPerM: 15, completionPerM: 75 },
  },
  'claude-haiku-4': {
    ...VISION_TOOLS,
    reasoning: { supported: true, controllable: true },
    limits: { contextTokens: 200_000 },
  },

  /* ── Google ─────────────────────────────────────────────────────────── */
  'gemini-1.5-pro': { ...VISION_TOOLS, input: { text: true, image: true, audio: true, video: true, pdf: true } },
  'gemini-1.5-flash': { ...VISION_TOOLS, input: { text: true, image: true, audio: true, video: true, pdf: true } },
  'gemini-2.0-flash': { ...VISION_TOOLS, input: { text: true, image: true, audio: true, video: true, pdf: true } },
  'gemini-2.5-flash': {
    ...VISION_TOOLS,
    input: { text: true, image: true, audio: true, video: true, pdf: true },
    reasoning: { supported: true, controllable: true },
  },
  'gemini-2.5-pro': {
    ...VISION_TOOLS,
    input: { text: true, image: true, audio: true, video: true, pdf: true },
    reasoning: { supported: true, controllable: true },
  },
  imagen: { input: { text: true }, output: { text: false, image: true } },
  veo: { input: { text: true, image: true }, output: { text: false, video: true } },

  /* ── DeepSeek ───────────────────────────────────────────────────────── */
  'deepseek-chat': { ...TEXT_TOOLS, limits: { contextTokens: 64_000 } },
  'deepseek-coder': { ...TEXT_TOOLS, limits: { contextTokens: 64_000 } },

  /*
   * Reasons on every call but takes no effort parameter — exactly the case
   * `controllable` exists to describe.
   */
  'deepseek-reasoner': {
    ...TEXT_TOOLS,
    reasoning: { supported: true, controllable: false },
    limits: { contextTokens: 64_000 },
  },

  /* ── xAI ────────────────────────────────────────────────────────────── */
  'grok-2-vision': VISION_TOOLS,
  'grok-3': { ...TEXT_TOOLS, reasoning: { supported: true, controllable: true } },
  'grok-4': { ...VISION_TOOLS, reasoning: { supported: true, controllable: true } },

  /* ── Mistral ────────────────────────────────────────────────────────── */
  'mistral-large': TEXT_TOOLS,
  'mistral-small': TEXT_TOOLS,
  pixtral: VISION_TOOLS,
  codestral: TEXT_TOOLS,

  /* ── Others ─────────────────────────────────────────────────────────── */
  'llama-3.1': TEXT_TOOLS,
  'llama-3.2-vision': VISION_TOOLS,
  'llama-3.3': TEXT_TOOLS,
  'qwen2.5-coder': TEXT_TOOLS,
  qwq: { ...TEXT_TOOLS, reasoning: { supported: true, controllable: false } },
  'glm-4': TEXT_TOOLS,
  'kimi-k2': TEXT_TOOLS,
};

/** Longest-prefix lookup, so dated snapshots inherit from their family. */
export function catalogLookup(model: string): DescriptorFragment | undefined {
  const id = model.toLowerCase().replace(/^[^/]+\//, '');

  let bestKey = '';

  for (const key of Object.keys(MODEL_CATALOG)) {
    if (id.startsWith(key) && key.length > bestKey.length) {
      bestKey = key;
    }
  }

  return bestKey ? { ...MODEL_CATALOG[bestKey], source: 'catalog' } : undefined;
}
