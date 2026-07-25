/**
 * generate_image tool
 * ===================
 * Generate an AI image from a text description.
 *
 * Available in: work mode only
 *
 * Provider priority:
 *   1. OpenRouter (if OPENROUTER_API_KEY is set) — supports DALL-E, SDXL, etc.
 *   2. Z-AI image API (built into PalmKit environment) — always available
 *
 * Returns:
 *   - dataUrl (base64 PNG) for inline display, OR
 *   - url (hosted) if the provider returns a URL instead of base64
 *
 * The frontend receives whichever format the provider returns and renders
 * it directly in the chat. For data URLs, the image is embedded inline;
 * for hosted URLs, the frontend can lazy-load.
 *
 * Why not just use OpenRouter?
 *   - Requires an API key the user may not have configured.
 *   - Z-AI is built into the PalmKit environment (free, no setup).
 *   - Having a fallback means the tool ALWAYS works for the user.
 */
import { generateImageSchema, type GenerateImageInput } from '~/lib/.server/tools/schemas/generate-image';
import { fetchWithTimeout } from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

export const generateImageTool: ToolDefinition<typeof generateImageSchema> = {
  name: 'generate_image',
  description:
    'Generate an AI image from a text description. ' +
    'Use this to create logos, illustrations, hero images, icons, or any visual asset. ' +
    'Provide a DETAILED prompt including subject, style, colors, and composition. ' +
    'Returns: a data URL (base64 PNG, can be displayed inline) or a hosted image URL. ' +
    'The image appears directly in the chat and the user can download it. ' +
    'For best results, describe the desired output: "minimalist logo of a tree, green and white, vector style" ' +
    'is better than "tree logo". ' +
    'Do NOT use this for charts (use make_chart) or for editing existing images (not supported).',

  inputSchema: generateImageSchema,
  availableIn: ['work'],

  execute: async (input: GenerateImageInput, ctx): Promise<ToolResult> => {
    const { prompt, size = '1024x1024', transparent = false } = input;

    // Build the full prompt with optional transparent flag
    const fullPrompt = transparent ? `${prompt}, transparent background, no background, PNG` : prompt;

    // Try OpenRouter first (if API key is available)
    if (ctx.openRouterApiKey) {
      const result = await tryOpenRouter(ctx.openRouterApiKey, fullPrompt, size, transparent);

      if (result.ok) {
        return result;
      }

      /*
       * If OpenRouter failed with a clear "bad prompt" error, don't retry with Z-AI
       * (the prompt itself is the problem). Only fall back on transient errors.
       */
      if (result.ok === false && result.error.includes('HTTP 4')) {
        return result;
      }

      // Otherwise fall through to Z-AI
    }

    // Try Z-AI as fallback (always available in PalmKit environment)
    return await tryZaiImage(fullPrompt, size, transparent);
  },
};

/**
 * Try OpenRouter's image generation API.
 */
async function tryOpenRouter(apiKey: string, prompt: string, size: string, transparent: boolean): Promise<ToolResult> {
  try {
    const resp = await fetchWithTimeout('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      timeoutMs: 45000, // image gen can take 30-40s
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://palmkit.app',
        'X-Title': 'PalmKit Work',
      },
      body: JSON.stringify({
        prompt,
        n: 1,
        size,
        response_format: 'b64_json',
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return {
        ok: false,
        error: `OpenRouter image generation failed: HTTP ${resp.status} — ${errText.slice(0, 200)}`,
        hint:
          resp.status === 401
            ? 'API key may be invalid. Check OPENROUTER_API_KEY.'
            : resp.status === 429
              ? 'Rate limited. Wait and retry.'
              : 'Try a simpler prompt or different size.',
      };
    }

    const data: any = await resp.json();
    const imageBase64 = data.data?.[0]?.b64_json;
    const imageUrl = data.data?.[0]?.url;

    if (imageBase64) {
      const mime = 'image/png'; // OpenRouter returns PNG
      const dataUrl = `data:${mime};base64,${imageBase64}`;

      return {
        ok: true,
        provider: 'openrouter',
        dataUrl,
        url: null,
        prompt,
        size,
        bytes: Math.round((imageBase64.length * 3) / 4),
        transparent,
      };
    }

    if (imageUrl) {
      return {
        ok: true,
        provider: 'openrouter',
        dataUrl: null,
        url: imageUrl,
        prompt,
        size,
        transparent,
      };
    }

    return {
      ok: false,
      error: 'OpenRouter returned no image data and no URL. Unexpected response shape.',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof Error && err.name === 'AbortTimeoutError') {
      return {
        ok: false,
        error: 'OpenRouter image generation timed out (45s). Try a simpler prompt or smaller size.',
      };
    }

    return { ok: false, error: `OpenRouter image generation failed: ${message}` };
  }
}

/**
 * Try Z-AI's image generation API (built into PalmKit environment).
 *
 * The Z-AI SDK is loaded globally as `ZAI` on the client side. On the
 * server (Cloudflare Workers / Node), we use the same endpoint via
 * direct fetch. The endpoint is `https://api.z.ai/api/v1/images/generations`.
 *
 * Authentication: the SDK handles this automatically when `ZAI.create()`
 * is called; for direct fetch we need to use the env-configured key.
 * For now, we use a simpler approach: call the z-ai-web-dev-sdk if
 * available, otherwise return a helpful error.
 */
async function tryZaiImage(prompt: string, size: string, transparent: boolean): Promise<ToolResult> {
  try {
    /*
     * Try to use the z-ai-web-dev-sdk (installed in PalmKit environment)
     * We import dynamically so this doesn't add to the bundle if OpenRouter succeeds.
     */
    const zaiModule: any = await import('z-ai-web-dev-sdk').catch(() => null);

    if (!zaiModule?.default) {
      return {
        ok: false,
        error:
          'Image generation requires either OPENROUTER_API_KEY or the Z-AI SDK. ' +
          'Neither is available in this environment.',
        hint: 'Set OPENROUTER_API_KEY in your environment, or install z-ai-web-dev-sdk.',
      };
    }

    const ZAI = zaiModule.default;
    const zai = await ZAI.create();

    // Z-AI supports the OpenAI-compatible images.generations API
    const response: any = await zai.images.generations.create({
      prompt,
      size: size as any,
      n: 1,

      /*
       * Z-AI doesn't support response_format=b64_json in all versions,
       * so we accept either b64_json or url.
       */
    });

    const imageBase64 = response.data?.[0]?.b64_json;
    const imageUrl = response.data?.[0]?.url;

    if (imageBase64) {
      const mime = 'image/png';
      const dataUrl = `data:${mime};base64,${imageBase64}`;

      return {
        ok: true,
        provider: 'zai',
        dataUrl,
        url: null,
        prompt,
        size,
        bytes: Math.round((imageBase64.length * 3) / 4),
        transparent,
      };
    }

    if (imageUrl) {
      return {
        ok: true,
        provider: 'zai',
        dataUrl: null,
        url: imageUrl,
        prompt,
        size,
        transparent,
      };
    }

    return {
      ok: false,
      error: 'Z-AI returned no image data and no URL. Unexpected response shape.',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Z-AI image generation failed: ${message}` };
  }
}
