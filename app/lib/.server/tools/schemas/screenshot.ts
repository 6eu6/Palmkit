/**
 * Screenshot Schema
 * -----------------
 * Used by: screenshot tool (code mode only, requires active sandbox)
 *
 * Take a screenshot of the running preview app. The LLM uses this to
 * visually verify the app renders correctly after building.
 *
 * REQUIRES a sandboxId. The screenshot is taken via Playwright inside
 * the sandbox's headless browser, then returned as base64 PNG.
 *
 * The returned image is LARGE (typically 50-200KB). To avoid blowing
 * up the LLM's context window, we return:
 *   - imageUrl: a sandbox-relative URL the frontend can render
 *   - mimeType: image/png
 *   - size: byte count
 *   - dimensions: width × height
 *
 * We do NOT return the full base64 in the LLM-facing result — only
 * metadata. The frontend renders the image in the chat UI.
 *
 * If the LLM has vision capabilities and wants to "see" the screenshot,
 * it can request a separate "screenshot_with_image" tool call that
 * returns the base64 (Phase 5 future enhancement).
 */
import { z } from 'zod';

export const screenshotSchema = z.object({
  url: z
    .string()
    .optional()
    .describe(
      'URL to screenshot. Default: http://localhost:5173 (the dev server). ' +
        'Use full URLs like "http://localhost:5173/about" for specific routes.',
    ),
  width: z.number().int().min(320).max(1920).optional().describe('Viewport width in pixels. Default 1280. Max 1920.'),
  height: z.number().int().min(240).max(1080).optional().describe('Viewport height in pixels. Default 720. Max 1080.'),
  fullPage: z
    .boolean()
    .optional()
    .describe(
      'If true, capture the full scrollable page (not just viewport). ' +
        'Default: false. Use for long pages with content below the fold.',
    ),
});

export type ScreenshotInput = z.infer<typeof screenshotSchema>;
