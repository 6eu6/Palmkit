/**
 * Generate Image Schema
 * ---------------------
 * Used by: the generate_image tool, in chat, work and code modes.
 *
 * This schema used to offer seven pixel sizes:
 *
 *   1024x1024, 768x1344, 864x1152, 1344x768, 1152x864, 1440x720, 720x1440
 *
 * Six of the seven were rejected by every image model the router can reach.
 * Measured against OpenRouter directly:
 *
 *   google/gemini-3.1-flash-lite-image
 *     1024x1024 → ok    1344x768  → 400 invalid argument
 *     768x1344  → 400   1152x864  → 400 "Image size 2K is not supported"
 *     864x1152  → 400   1440x720  → 400 'does not support aspect_ratio "2:1"'
 *   openai/gpt-5-image-mini
 *     1024x1024 → ok, everything else → 400
 *     "Supported sizes are 1024x1024, 1024x1536, 1536x1024, and auto."
 *
 * So a build that asked for a 1440x720 hero got nothing back, three times in a
 * row, and the failure looked like the model's fault. The two families do not
 * share a size vocabulary and never will: OpenAI takes a literal pixel size
 * from a fixed list, while Gemini reads `size` as an aspect ratio plus a
 * resolution tier keyed on the largest dimension — asking it for 1024x576
 * returns 1376x768, and asking flash-lite for anything above 1024 on either
 * axis is refused as "2K".
 *
 * Pixel sizes are therefore the wrong thing to ask a caller for. What a caller
 * actually knows is the shape it needs — a square avatar, a wide hero — so
 * that is what this schema takes. The tool resolves the shape to a size the
 * chosen model accepts.
 */
import { z } from 'zod';

/** The shapes every image model can produce, in the vocabulary of the caller. */
export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * The old pixel sizes, mapped to the shape each one was reaching for.
 *
 * Still accepted, because a model that has seen the old schema will keep
 * emitting them and a 400 is a worse answer than the nearest working shape.
 */
export const LEGACY_SIZE_RATIOS: Record<string, AspectRatio> = {
  '1024x1024': '1:1',
  '1344x768': '16:9',
  '1440x720': '16:9',
  '768x1344': '9:16',
  '720x1440': '9:16',
  '1152x864': '4:3',
  '864x1152': '3:4',
};

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
  aspectRatio: z
    .enum(ASPECT_RATIOS)
    .optional()
    .describe(
      'Shape of the image. "1:1" for icons, avatars and logos; ' +
        '"16:9" for hero images and banners; "9:16" for phone screens and stories; ' +
        '"4:3" or "3:4" for cards and posters. Default: "1:1". ' +
        'Do not ask for pixel dimensions — the exact resolution is chosen to suit the model.',
    ),
  size: z
    .string()
    .optional()
    .describe('Deprecated. Use aspectRatio. A pixel size given here is read as the nearest aspect ratio.'),
  transparent: z
    .boolean()
    .optional()
    .describe(
      'If true, request transparent PNG background (best for logos/icons). ' + 'Default: false (opaque background).',
    ),
});

export type GenerateImageInput = z.infer<typeof generateImageSchema>;

/**
 * The shape being asked for, however it was expressed.
 *
 * A `size` that is not one of the old seven is measured rather than rejected:
 * its ratio picks the closest supported shape, so a model that invents
 * "1600x900" still gets a wide image.
 */
export function resolveAspectRatio(input: Pick<GenerateImageInput, 'aspectRatio' | 'size'>): AspectRatio {
  if (input.aspectRatio) {
    return input.aspectRatio;
  }

  const size = input.size?.trim();

  if (!size) {
    return '1:1';
  }

  if (LEGACY_SIZE_RATIOS[size]) {
    return LEGACY_SIZE_RATIOS[size];
  }

  const match = /^(\d+)\s*[x:×]\s*(\d+)$/.exec(size);

  if (!match) {
    return '1:1';
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!width || !height) {
    return '1:1';
  }

  const wanted = width / height;
  const ratioOf = (r: AspectRatio) => {
    const [w, h] = r.split(':').map(Number);
    return w / h;
  };

  return ASPECT_RATIOS.reduce((best, r) =>
    Math.abs(ratioOf(r) - wanted) < Math.abs(ratioOf(best) - wanted) ? r : best,
  );
}
