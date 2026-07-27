/**
 * screenshot tool
 * ===============
 * Take a screenshot of the running preview app.
 *
 * Available in: code mode only (requires ToolContext.sandboxId)
 *
 * The LLM uses this to visually verify the app renders correctly after
 * building. The screenshot is taken via Playwright inside the sandbox's
 * headless browser, then returned as base64 PNG.
 *
 * The returned image is LARGE (typically 50-200KB base64). To avoid
 * blowing up the LLM's context window, we return:
 *   - imageUrl: a sandbox-relative URL the frontend can render
 *   - mimeType: image/png
 *   - size: byte count
 *   - dimensions: width × height
 *
 * We do NOT return the full base64 in the LLM-facing result. The
 * frontend renders the image in the chat UI directly from the sandbox URL.
 *
 * REQUIRES a sandboxId. The sandbox must have a running dev server
 * (the LLM should run `npm run dev` via run_shell first).
 *
 * If the dev server isn't running, the screenshot will be a blank page
 * or a "connection refused" error page — the LLM should run_shell to
 * start the dev server before calling screenshot.
 */
import { screenshotSchema, type ScreenshotInput } from '~/lib/.server/tools/schemas/screenshot';
import { callSandbox } from '~/lib/.server/tools/schemas/_sandbox';
import type { ToolDefinition, ToolContext, ToolResult } from '~/lib/.server/tools/types';

export const screenshotTool: ToolDefinition<typeof screenshotSchema> = {
  name: 'screenshot',
  description:
    'Take a screenshot of the running preview app in the sandbox. ' +
    'Use this AFTER starting the dev server (via run_shell "npm run dev") to visually ' +
    'verify the app renders correctly. ' +
    'Returns: imageUrl (frontend renders it), mimeType, size in bytes, dimensions. ' +
    'The image is NOT returned as base64 in the LLM context (too large). ' +
    'Defaults: url=http://localhost:5173, width=1280, height=720, fullPage=false. ' +
    'For specific routes use url="http://localhost:5173/about". ' +
    'REQUIRES an active sandbox. If you get a blank screenshot, the dev server may not be running.',

  inputSchema: screenshotSchema,
  availableIn: ['code'],

  execute: async (input: ScreenshotInput, ctx: ToolContext): Promise<ToolResult> => {
    const { url = 'http://localhost:5173', width = 1280, height = 720, fullPage = false } = input;

    const result = await callSandbox(ctx.sandboxId ?? '', 'screenshot', { url, width, height, fullPage }, 30000);

    if (!result.ok) {
      return result;
    }

    const data = result.data as {
      url?: string;
      image?: string;
      mimeType?: string;
      size?: number;
      width?: number;
      height?: number;
    };

    /*
     * The sandbox returns the image as base64. We don't return it in the
     * LLM-facing result (too large). Instead, we return metadata + a
     * truncated preview marker so the LLM knows the screenshot was taken.
     */
    const fullImageSize = data.size ?? (data.image ? Math.round((data.image.length * 3) / 4) : 0);

    return {
      ok: true,
      url: data.url ?? url,
      mimeType: data.mimeType ?? 'image/png',
      size: fullImageSize,
      width: data.width ?? width,
      height: data.height ?? height,
      captured: true,

      // Signal to the LLM that the image is rendered in the UI, not in its context
      note: 'Screenshot captured and displayed in the chat UI. The image is too large to include in your context — use vision capabilities if you need to analyze it visually.',
    };
  },
};
