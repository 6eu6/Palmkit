/**
 * Image generation via OpenRouter image models (Media pipeline v1).
 *
 * OpenRouter returns generated images on the chat/completions endpoint when
 * `modalities: ['image','text']` is set — the image comes back as a base64
 * data URI at `choices[0].message.images[0].image_url.url` (verified live
 * against google/gemini-2.5-flash-image). We keep this as a plain fetch (not
 * the ai-sdk) because image output isn't part of the ai@4 generateText return.
 */
import { logger } from './logger';

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

export interface GeneratedImage {
  dataUri: string; // data:image/png;base64,...
  bytes: number;
  mime: string;
}

/**
 * Generate one image. Returns the data URI, or throws with a concise message
 * the caller can surface to the agent (which then falls back gracefully).
 */
export async function generateImage(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<GeneratedImage> {
  const { apiKey, model, prompt } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://palmkit.app',
        'X-Title': 'Palmkit',
      },
      body: JSON.stringify({
        model,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`image API ${resp.status}: ${text.slice(0, 160)}`);
    }

    const data = (await resp.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } | string }> } }>;
    };

    if (data.error) {
      throw new Error(data.error.message ?? 'image API error');
    }

    const images = data.choices?.[0]?.message?.images ?? [];
    const first = images[0]?.image_url;
    const url = typeof first === 'string' ? first : first?.url;

    if (!url || !url.startsWith('data:')) {
      throw new Error('model returned no image');
    }

    const mime = url.slice(5, url.indexOf(';')) || 'image/png';
    const b64 = url.slice(url.indexOf(',') + 1);
    const bytes = Math.floor((b64.length * 3) / 4);

    logger.info(`[image-gen] ${model}: ${(bytes / 1024).toFixed(0)}KB ${mime}`);

    return { dataUri: url, bytes, mime };
  } finally {
    clearTimeout(timer);
  }
}
