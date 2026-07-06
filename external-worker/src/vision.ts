/**
 * Vision Analysis — let the agent SEE its rendered preview.
 *
 * RADICAL REBUILD: the agent was blind. The old `take_screenshot` tool
 * returned a 300-char text dump of document.body.textContent — the model
 * could read the DOM text but couldn't see a single pixel. So it could
 * not tell whether the hero was centered, whether colors clashed, whether
 * a video background played, or whether the layout was broken.
 *
 * This module wraps the Z.ai vision chat API (z-ai-web-dev-sdk) so the
 * agent can ask arbitrary questions about a base64 PNG screenshot and get
 * a natural-language description back. Used by the `analyze_screenshot`
 * tool in agent-tools.ts.
 *
 * The SDK runs server-side only (it imports the API key), so this file
 * lives in external-worker/ — never in app/.
 */
import ZAI from 'z-ai-web-dev-sdk';
import { logger } from './logger';

export interface VisionAnalysis {
  ok: boolean;
  description: string;
  issues?: string[];
  raw?: string;
}

const DEFAULT_PROMPT =
  'You are looking at a screenshot of a web app preview. Describe what you see in detail: ' +
  'layout, colors, typography, hero section, navigation, any visible content. ' +
  'Then identify any visual problems: text clipping, overlapping elements, broken layout, ' +
  'missing images, poor contrast, uncentered content, or anything that looks off. ' +
  'Be specific and concise (under 300 words).';

/**
 * Analyze a screenshot with the vision model.
 *
 * @param imageBase64 — raw base64 PNG (no data: prefix)
 * @param question — optional specific question; falls back to the default
 *                   "describe + find problems" prompt
 */
export async function analyzeScreenshot(
  imageBase64: string,
  question?: string,
): Promise<VisionAnalysis> {
  try {
    const zai = await ZAI.create();

    const prompt = question?.trim()
      ? `You are looking at a screenshot of a web app preview. ${question.trim()}`
      : DEFAULT_PROMPT;

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
    logger.warn(`[vision] analyzeScreenshot failed: ${msg}`);
    return {
      ok: false,
      description: '',
      raw: msg,
    };
  }
}
