/**
 * Image generation via OpenRouter image models (Media pipeline v1).
 *
 * OpenRouter returns generated images on the chat/completions endpoint when
 * `modalities: ['image','text']` is set — the image comes back as a base64
 * data URI at `choices[0].message.images[0].image_url.url` (verified live
 * against google/gemini-2.5-flash-image). We keep this as a plain fetch (not
 * the ai-sdk) because image output isn't part of the ai@4 generateText return.
 */
import { Jimp } from 'jimp';
import { logger } from './logger';

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

export interface GeneratedImage {
  dataUri: string; // data:image/(png|jpeg);base64,...
  bytes: number;
  mime: string;
}

/**
 * Downscale + compress a generated image so it's a production-appropriate
 * bundle asset (the raw model output is often 1–2 MB, which is far too heavy
 * to inline into a built app AND strains the preview file pipeline).
 *
 * - `transparent` (logos/icons): keep PNG (alpha), cap at 512px.
 * - otherwise (photos/heroes): re-encode as JPEG q72, cap at 1280px.
 *
 * Falls back to the original data URI if processing fails for any reason.
 */
async function compressImage(dataUri: string, transparent: boolean): Promise<GeneratedImage> {
  const original = (): GeneratedImage => {
    const mime = dataUri.slice(5, dataUri.indexOf(';')) || 'image/png';
    const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
    return { dataUri, mime, bytes: Math.floor((b64.length * 3) / 4) };
  };

  try {
    const b64 = dataUri.slice(dataUri.indexOf(',') + 1);
    const buf = Buffer.from(b64, 'base64');
    const img = await Jimp.read(buf);

    const maxW = transparent ? 512 : 1280;

    if (img.width > maxW) {
      img.resize({ w: maxW });
    }

    let outBuf: Buffer;
    let mime: string;

    if (transparent) {
      outBuf = await img.getBuffer('image/png');
      mime = 'image/png';
    } else {
      outBuf = await img.getBuffer('image/jpeg', { quality: 72 });
      mime = 'image/jpeg';
    }

    const outB64 = outBuf.toString('base64');

    return { dataUri: `data:${mime};base64,${outB64}`, mime, bytes: outBuf.length };
  } catch (e) {
    logger.warn(`[image-gen] compress failed, using original: ${e instanceof Error ? e.message : String(e)}`);
    return original();
  }
}

/**
 * Generate one image. Returns the data URI, or throws with a concise message
 * the caller can surface to the agent (which then falls back gracefully).
 */
export async function generateImage(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  /** Keep alpha (PNG) and cap smaller — for logos/icons. */
  transparent?: boolean;
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

    const rawBytes = Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);
    const out = await compressImage(url, opts.transparent ?? false);

    logger.info(
      `[image-gen] ${model}: ${(rawBytes / 1024).toFixed(0)}KB → ${(out.bytes / 1024).toFixed(0)}KB ${out.mime}`,
    );

    return out;
  } finally {
    clearTimeout(timer);
  }
}
