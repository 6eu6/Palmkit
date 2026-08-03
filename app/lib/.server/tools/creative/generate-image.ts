/**
 * generate_image — draw a picture with a model that can draw.
 *
 * The chat model cannot. It has no image output, so the tool routes to one
 * that does, chosen from the catalog rather than from a list written here.
 *
 * This tool was broken in three separate ways and every one of them was
 * silent — the model called it correctly, wrote a good prompt, and got back
 * an error the user never understood:
 *
 *   1. It read `OPEN_ROUTER_API_KEY` from the deployment's environment, not
 *      from the signed-in user's account. On the hosted app that variable is
 *      unset, so the OpenRouter path never ran for anybody.
 *   2. When it did run it posted to /images/generations without a `model`
 *      field, which that endpoint requires. Every call returned HTTP 400 —
 *      and the tool treated `HTTP 4` as "the prompt is bad, do not retry".
 *   3. The fallback imported a Node SDK that needs a `.z-ai-config` file on
 *      disk. Cloudflare Workers has no disk. It failed with "Configuration
 *      file not found", which is what users actually saw.
 */
import { generateImageSchema, type GenerateImageInput } from '~/lib/.server/tools/schemas/generate-image';
import { fetchWithTimeout } from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

/** Image generation is slow; 45s is the observed ceiling, not a guess. */
const TIMEOUT_MS = 60_000;

/**
 * What the bytes actually are, and how big.
 *
 * The result used to be labelled `data:image/png` unconditionally. It is not
 * always a PNG — `gemini-3.1-flash-lite-image` returns JPEG — so a download
 * saved JPEG bytes under a .png name, and anything stricter than a browser
 * choked on it. Read the header instead of assuming.
 */
function sniffImage(bytes: Uint8Array): { mime: string; width?: number; height?: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG: 8-byte signature, then IHDR carries width and height.
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (PNG_SIG.every((b, i) => bytes[i] === b)) {
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG: walk the segments to the start-of-frame, which holds the size.
    for (let i = 2; i < bytes.length - 9; ) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }

      const marker = bytes[i + 1];
      const len = view.getUint16(i + 2);

      // Any SOFn except DHT (c4), JPG (c8) and DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      }

      i += 2 + len;
    }

    return { mime: 'image/jpeg' };
  }

  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { mime: 'image/webp' };
  }

  return { mime: 'application/octet-stream' };
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }

  return out;
}

export const generateImageTool: ToolDefinition<typeof generateImageSchema> = {
  name: 'generate_image',
  description:
    'Generate an image from a text description. ' +
    'Use this to create logos, illustrations, hero images, icons, or any visual asset. ' +
    'Provide a DETAILED prompt including subject, style, colors, and composition. ' +
    'Returns a data URL (base64 PNG) that appears directly in the chat and can be downloaded. ' +
    'For best results, describe the desired output: "minimalist logo of a tree, green and white, vector style" ' +
    'is better than "tree logo". ' +
    'The image model is selected automatically — do NOT ask the user which model to use. ' +
    'Do NOT use this for charts (use make_chart) or for video (use generate_video).',

  inputSchema: generateImageSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: GenerateImageInput, ctx): Promise<ToolResult> => {
    const { prompt, size = '1024x1024', transparent = false } = input;
    const fullPrompt = transparent ? `${prompt}, transparent background, no background, PNG` : prompt;

    const apiKey = ctx.apiKeys?.OpenRouter;

    if (!apiKey) {
      return {
        ok: false,
        error: 'No OpenRouter key is connected, so there is no model available to draw with.',
        hint: 'Add one in Settings → Model providers.',
      };
    }

    const route = await ctx.routeModel?.('image');

    if (!route) {
      return {
        ok: false,
        error: 'No image-generating model was found in your connected provider.',
        hint: 'Open Settings → Model providers → Refresh capabilities, then try again.',
      };
    }

    try {
      const resp = await fetchWithTimeout('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        timeoutMs: TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://palmkit.app',
          'X-Title': 'Palmkit',
        },

        /*
         * `model` is required — omitting it is what made every call fail —
         * and `size` is honoured: without it the provider picks its own
         * aspect ratio (1408x768 rather than the square that was asked for).
         */
        body: JSON.stringify({ model: route.model, prompt: fullPrompt, n: 1, size }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');

        return {
          ok: false,
          error: `Image generation failed (HTTP ${resp.status}) using ${route.model}: ${errText.slice(0, 200)}`,
          hint:
            resp.status === 401
              ? 'The stored key was rejected. Replace it in Settings → Model providers.'
              : resp.status === 402
                ? 'Your provider account is out of credit.'
                : resp.status === 429
                  ? 'Rate limited by the provider. Wait a moment and try again.'
                  : 'Try a simpler prompt.',
        };
      }

      const data = (await resp.json()) as { data?: { b64_json?: string; url?: string }[] };
      const first = data.data?.[0];

      if (first?.b64_json) {
        const bytes = decodeBase64(first.b64_json);
        const { mime, width, height } = sniffImage(bytes);

        /*
         * Stored, not inlined. This result is fed back into the model's
         * context as well as sent to the browser, and a 673KB JPEG is about
         * 224,000 tokens of base64 against a 204,800 context — which is why
         * "make an image, then a video from it" used to stop after the image.
         * If storage is unavailable the data URL comes back instead, which is
         * the old behaviour: degraded, not broken.
         */
        const stored = await ctx.storeMedia?.(bytes, mime);

        return {
          ok: true,
          model: route.model,
          whyThisModel: route.reason,
          url: stored?.url ?? null,
          dataUrl: stored ? null : `data:${mime};base64,${first.b64_json}`,
          prompt: fullPrompt,

          /* What came back, not what was asked for. */
          size: width && height ? `${width}x${height}` : size,
          format: mime,
          bytes: bytes.length,
          transparent,
        };
      }

      if (first?.url) {
        return {
          ok: true,
          model: route.model,
          whyThisModel: route.reason,
          dataUrl: null,
          url: first.url,
          prompt: fullPrompt,
          size,
          transparent,
        };
      }

      return { ok: false, error: `${route.model} returned neither image data nor a URL.` };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortTimeoutError') {
        return {
          ok: false,
          error: `Image generation timed out after ${TIMEOUT_MS / 1000}s.`,
          hint: 'Try a simpler prompt or a smaller size.',
        };
      }

      return { ok: false, error: `Image generation failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
