import type { ModelDescriptor } from './model-descriptor';

/**
 * How hard the model should think — a property of the REQUEST, not the model.
 *
 * The user picks an intent; what that means in wire format is resolved per
 * provider from the model's descriptor. So the same three buttons work whether
 * the model behind them takes OpenAI's `reasoning_effort`, Anthropic's
 * thinking budget, Google's `thinkingConfig`, or nothing at all.
 */
export type Effort = 'fast' | 'balanced' | 'deep';

export const EFFORT_LEVELS: { value: Effort; label: string; hint: string; icon: string }[] = [
  { value: 'fast', label: 'Fast', hint: 'Answer quickly — least thinking', icon: 'i-ph:lightning' },
  { value: 'balanced', label: 'Balanced', hint: "The model's own default", icon: 'i-ph:equals' },
  { value: 'deep', label: 'Deep', hint: 'Think hard — best for difficult problems', icon: 'i-ph:brain' },
];

export const DEFAULT_EFFORT: Effort = 'balanced';

/** Thinking budgets in tokens, for providers that take a number, not a word. */
const BUDGET: Record<Exclude<Effort, 'balanced'>, number> = {
  fast: 1024,
  deep: 24_000,
};

const WORD: Record<Exclude<Effort, 'balanced'>, 'low' | 'high'> = {
  fast: 'low',
  deep: 'high',
};

/**
 * Turn an intent into provider options.
 *
 * Balanced returns nothing on purpose. "Don't ask for anything" is a real and
 * useful state: the model behaves exactly as its provider tuned it, the bill
 * holds no surprises, and a model with no effort control is not misrepresented
 * as having one. Only Fast and Deep spend anything to be different.
 *
 * Returns undefined when the model cannot be steered, so the caller sends no
 * parameter rather than one the provider will reject.
 */
export function effortProviderOptions(
  provider: string,
  descriptor: ModelDescriptor | undefined,
  effort: Effort,
): Record<string, Record<string, unknown>> | undefined {
  if (effort === 'balanced' || !descriptor?.reasoning.controllable) {
    return undefined;
  }

  switch (provider) {
    case 'OpenAI':
    case 'xAI':
      return { [provider.toLowerCase()]: { reasoningEffort: WORD[effort] } };

    case 'Anthropic':
      return { anthropic: { thinking: { type: 'enabled', budgetTokens: BUDGET[effort] } } };

    case 'Google':
      return { google: { thinkingConfig: { thinkingBudget: BUDGET[effort] } } };

    case 'OpenRouter':
      /*
       * OpenRouter normalises across everything it proxies, so an effort word
       * is enough — it maps to whatever the upstream model actually accepts.
       */
      return { openrouter: { reasoning: { effort: WORD[effort] } } };

    default:
      return undefined;
  }
}

/**
 * Whether the control should be offered at all.
 *
 * A model that cannot be steered gets a disabled button with a reason, not a
 * button that silently does nothing — which is what the old one did.
 */
export function effortAvailable(provider: string, descriptor: ModelDescriptor | undefined): boolean {
  if (!descriptor?.reasoning.controllable) {
    return false;
  }

  return ['OpenAI', 'xAI', 'Anthropic', 'Google', 'OpenRouter'].includes(provider);
}
