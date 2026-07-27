/**
 * Generate Image Schema
 * ---------------------
 * Used by: generate_image tool (work mode only)
 *
 * The image generation flow:
 *   1. Tool receives prompt + size + transparent flag
 *   2. Calls OpenRouter's image API (or Z-AI image API as fallback)
 *   3. Returns a data URL OR hosted URL the frontend can render directly
 *
 * Why two providers?
 *   - OpenRouter: supports DALL-E, Stable Diffusion, etc. (needs API key)
 *   - Z-AI: built into PalmKit environment, free tier, no key needed
 *   - The tool tries OpenRouter first; falls back to Z-AI on failure.
 */
import { z } from 'zod';

export const generateImageSchema = z.object({
  prompt: z
    .string()
    .min(3)
    .max(2000)
    .describe(
      'Detailed image description. Be specific about: subject, style, colors, ' +
        'composition, lighting. Example: "A minimalist mountain landscape at sunset, ' +
        'warm orange and purple sky, vector illustration style".',
    ),
  size: z
    .enum(['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'])
    .optional()
    .describe(
      'Image dimensions. Square (1024x1024) for icons/avatars, ' +
        'landscape (1344x768 or 1440x720) for hero images, ' +
        'portrait (768x1344 or 720x1440) for posters. Default: 1024x1024.',
    ),
  transparent: z
    .boolean()
    .optional()
    .describe(
      'If true, request transparent PNG background (best for logos/icons). ' + 'Default: false (opaque background).',
    ),
});

export type GenerateImageInput = z.infer<typeof generateImageSchema>;
