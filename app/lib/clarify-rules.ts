/**
 * Clarify gate — lightweight heuristic that decides WHETHER to show the
 * clarifier for a given prompt. The actual questions are generated dynamically
 * by the LLM (api.clarify.ts); this just gates the call so we never spend
 * tokens on a prompt that's already detailed or too short to clarify.
 *
 * Why no LLM in the gate: this runs on every send — it must be instant and
 * free. The LLM only runs once we've decided the prompt is a clarifier
 * candidate.
 */

export interface ClarifyQuestion {
  prompt: string;
  options: { label: string; append: string }[];
}

const MIN_LEN = 12;
const MAX_LEN = 160;

/**
 * A prompt is a candidate for clarification if it's short-to-medium and vague.
 * Very short (<12 chars) is too thin to analyze; long (>160) already carries
 * enough spec. This is a wide gate — the LLM itself can return [] if the
 * prompt is detailed enough.
 */
export function shouldClarify(prompt: string): boolean {
  const text = prompt.trim();
  return text.length >= MIN_LEN && text.length <= MAX_LEN;
}
