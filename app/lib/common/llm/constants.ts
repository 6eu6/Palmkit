/*
 * Maximum tokens for response generation (updated for modern model capabilities)
 * This serves as a fallback when model-specific limits are unavailable
 * Modern models like Claude 3.5, GPT-4o, and Gemini Pro support 128k+ tokens
 */
export const MAX_TOKENS = 128000;

/*
 * Provider-specific default completion token limits
 * Used as fallbacks when model doesn't specify maxCompletionTokens
 */
export const PROVIDER_COMPLETION_LIMITS: Record<string, number> = {
  OpenAI: 16384, // GPT-4o and above support 16k+ output tokens
  Github: 16384, // GitHub Models use OpenAI-compatible limits
  Anthropic: 16384, // Claude models handle 16k comfortably per segment
  Google: 16384, // Gemini Pro/Flash support 16k+ output
  Cohere: 8192,
  DeepSeek: 16384, // DeepSeek V3/V4 support 16k output tokens
  Groq: 8192,
  HuggingFace: 8192,
  Mistral: 8192,
  Ollama: 8192,
  OpenRouter: 16384, // OpenRouter proxies modern models (DeepSeek, Claude, GPT) that support 16k+
  Perplexity: 8192,
  Together: 8192,
  xAI: 8192,
  LMStudio: 8192,
  OpenAILike: 8192,
  AmazonBedrock: 8192,
  Hyperbolic: 8192,
};

/*
 * Reasoning models that require maxCompletionTokens instead of maxTokens
 * These models use internal reasoning tokens and have different API parameter requirements.
 *
 * Detection covers:
 *  - OpenAI o1 / o3 / o4 / gpt-5 series
 *  - DeepSeek R1 + DeepSeek Reasoner
 *  - Claude models with extended thinking (claude-*thinking*, opus 4.x reasoning)
 *  - Gemini thinking / pro with reasoning
 *  - Qwen QwQ + Qwen reasoning
 *  - xAI Grok 4 reasoning
 *
 * Why this matters: reasoning models can spend 60-120s "thinking" before the
 * first output token. The stream-recovery timeout (120s) was killing these
 * models mid-thought — see api.chat.ts. isReasoningModel() lets the caller
 * bump the timeout dynamically.
 */
export function isReasoningModel(modelName: string): boolean {
  if (!modelName) {
    return false;
  }

  const name = modelName.toLowerCase();

  // OpenAI reasoning family
  if (/^(o1|o3|o4|gpt-5)/i.test(name)) {
    return true;
  }

  // DeepSeek reasoning family (R1, Reasoner, V3.1 Terminus reasoning, etc.)
  if (/(deepseek.*(r1|reasoner|reasoning))|deepseek-r1/i.test(name)) {
    return true;
  }

  // Claude with extended thinking / reasoning variants
  if (/(claude.*thinking|claude.*reasoning|opus-4\.[5-9]|claude.*extended)/i.test(name)) {
    return true;
  }

  // Gemini thinking / reasoning variants
  if (/(gemini.*thinking|gemini.*reasoning|gemini.*pro.*[2-9])/i.test(name)) {
    return true;
  }

  // Qwen reasoning models
  if (/(qwen.*qwq|qwen.*reasoning|qwq)/i.test(name)) {
    return true;
  }

  // xAI Grok 4 reasoning
  if (/(grok-4.*reasoning|grok.*reason)/i.test(name)) {
    return true;
  }

  return false;
}

/*
 * Limits the number of model responses (auto-continue segments) in a single
 * request. Raised from 2 → 8 → 16 → 32: large multi-file projects (full
 * portfolios, dashboards) regularly exceed 16 segments at 16k tokens each,
 * causing the "cuts off mid-creation" bug. 32 segments × 16k = up to 512k
 * output tokens, enough for any realistic single-turn generation.
 */
export const MAX_RESPONSE_SEGMENTS = 32;

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
  isLocked?: boolean;
  lockedByFolder?: string;
}

export interface Folder {
  type: 'folder';
  isLocked?: boolean;
  lockedByFolder?: string;
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
  '**/*lock.json',
  '**/*lock.yml',
];
