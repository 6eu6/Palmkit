/**
 * Vision Analysis — let the agent SEE its rendered preview.
 *
 * Supports two paths:
 *   1. User's BYOK vision model (via provider-registry) — uses the provider,
 *      model name, and API key the user configured in Settings.
 *   2. Z.ai SDK fallback — uses the built-in z-ai-web-dev-sdk for vision
 *      analysis (requires ZAI_ env vars on the worker).
 *
 * Path 1 is preferred because it respects the user's provider choice and
 * doesn't require Z.ai env vars on the worker.
 */
import { logger } from './logger';

export interface VisionAnalysis {
  ok: boolean;
  description: string;
  issues?: string[];
  raw?: string;
}

/** Options for using the user's BYOK vision model. */
export interface VisionOptions {
  model?: string;
  apiKey?: string;
  provider?: string;
}

const DEFAULT_PROMPT =
  'You are looking at a screenshot of a web app preview. Describe what you see in detail: ' +
  'layout, colors, typography, hero section, navigation, any visible content. ' +
  'Then identify any visual problems: text clipping, overlapping elements, broken layout, ' +
  'missing images, poor contrast, uncentered content, or anything that looks off. ' +
  'Be specific and concise (under 300 words).';

/**
 * Analyze a screenshot with a vision model.
 *
 * If opts has apiKey + provider + model, uses the user's BYOK model via
 * provider-registry (OpenRouter, Google, Anthropic, etc.).
 * Otherwise falls back to Z.ai SDK.
 *
 * @param imageBase64 — raw base64 PNG (no data: prefix)
 * @param question — optional specific question; falls back to the default
 *                   "describe + find problems" prompt
 * @param opts — optional BYOK vision model config
 */
export async function analyzeScreenshot(
  imageBase64: string,
  question?: string,
  opts?: VisionOptions,
): Promise<VisionAnalysis> {
  const prompt = question?.trim()
    ? `You are looking at a screenshot of a web app preview. ${question.trim()}`
    : DEFAULT_PROMPT;

  /*
   * Path 1: User's BYOK vision model.
   * Use provider-registry to create a LanguageModelV1, then call generateText
   * with the image as a multi-modal message.
   *
   * NOTE: mediaConfig uses short provider names ('openrouter', 'google', 'zai')
   * but provider-registry uses full names ('OpenRouter', 'Google', 'Z.ai').
   * We map here.
   */
  if (opts?.apiKey && opts?.provider && opts?.model) {
    try {
      // Map short provider names to full registry names
      const providerNameMap: Record<string, string> = {
        openrouter: 'OpenRouter',
        google: 'Google',
        anthropic: 'Anthropic',
        openai: 'OpenAI',
        zai: 'OpenRouter', // Z.ai models accessible via OpenRouter proxy
      };
      const registryProvider = providerNameMap[opts.provider.toLowerCase()] || opts.provider;

      const { getModelInstance } = await import('./provider-registry');
      const visionModel = getModelInstance(registryProvider, opts.model, opts.apiKey);
      const { generateText } = await import('ai');

      const result = await generateText({
        model: visionModel,
        maxTokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image',
                image: Buffer.from(imageBase64, 'base64'),
              },
            ],
          },
        ],
      });

      const text = result.text;

      return {
        ok: true,
        description: text,
        raw: text,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[vision] BYOK vision analysis failed (${opts.provider}/${opts.model}): ${msg}`);
      // Fall through to Z.ai SDK
    }
  }

  /*
   * Path 2: Z.ai SDK fallback.
   * Uses the built-in z-ai-web-dev-sdk. This requires ZAI_ env vars on
   * the worker. If those aren't set, this will fail and return ok:false.
   */
  try {
    const ZAI = await import('z-ai-web-dev-sdk');
    const zai = await (ZAI.default ?? ZAI).create();

    const completion = await (zai as any).chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${imageBase64}` },
            },
          ] as any,
        },
      ],
      thinking: { type: 'disabled' },
    } as any);

    const text = completion.choices[0]?.message?.content ?? '';

    return {
      ok: true,
      description: text,
      raw: text,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[vision] Z.ai vision analysis failed: ${msg}`);
    return {
      ok: false,
      description: '',
      raw: msg,
    };
  }
}