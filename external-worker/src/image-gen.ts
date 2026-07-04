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
/**
 * Knock out a near-uniform background to real transparency.
 *
 * Image models routinely ignore "transparent background" and bake a solid
 * white/light fill into the pixels, so a logo comes out as a white rectangle.
 * We fix that deterministically: sample the four corners, and if they agree on
 * a background color, flood-fill from the edges — every edge-connected pixel
 * within tolerance of that color becomes transparent. Flood-fill (not a global
 * threshold) preserves matching colors INSIDE the mark (e.g. a white highlight
 * enclosed by the logo). If the corners disagree (a real full-bleed scene), we
 * bail and leave the image untouched.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function removeBackground(img: any): boolean {
  const w: number = img.bitmap.width;
  const h: number = img.bitmap.height;
  const data: Buffer = img.bitmap.data; // RGBA
  const at = (x: number, y: number) => (y * w + x) * 4;

  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const cr = corners.map((i) => [data[i], data[i + 1], data[i + 2]]);
  const dist = (a: number[], b: number[]) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

  // Corners must agree (uniform border) — otherwise this isn't a plain-bg logo.
  for (let i = 1; i < cr.length; i++) {
    if (dist(cr[0], cr[i]) > 24) {
      return false;
    }
  }

  const bg = cr[0];
  const TOL = 40; // per-channel tolerance for "is background"
  const stack: number[] = [];
  const visited = new Uint8Array(w * h);

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) {
      return;
    }

    const p = y * w + x;

    if (visited[p]) {
      return;
    }

    const i = p * 4;

    if (dist([data[i], data[i + 1], data[i + 2]], bg) <= TOL) {
      visited[p] = 1;
      stack.push(x, y);
    }
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }

  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  let cleared = 0;

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    data[(y * w + x) * 4 + 3] = 0; // alpha → 0
    cleared++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // Only count it a success if we actually removed a meaningful border region.
  return cleared > w * h * 0.02;
}

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
      // Cut out the baked-in background so the logo/icon is actually isolated.
      try {
        const removed = removeBackground(img);
        logger.info(`[image-gen] background removal: ${removed ? 'applied' : 'skipped (non-uniform)'}`);
      } catch (e) {
        logger.warn(`[image-gen] background removal failed: ${e instanceof Error ? e.message : String(e)}`);
      }

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
  const { apiKey, model } = opts;

  /*
   * For logos/icons, steer the model toward a cleanly-removable result: a
   * centered, isolated subject on ONE flat solid color with no scene, gradient
   * or shadow. The model still often bakes in a background, but a flat uniform
   * one is exactly what removeBackground() keys out reliably afterward.
   */
  const prompt = opts.transparent
    ? `${opts.prompt}\n\nComposition: a single centered, isolated subject on a plain flat SOLID white background. No scene, no gradient, no drop shadow, no reflection, no border — just the subject on flat white, with clear margins, so the background can be cleanly removed to transparency.`
    : opts.prompt;

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
