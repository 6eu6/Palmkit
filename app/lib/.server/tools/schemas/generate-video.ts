import { z } from 'zod';

/**
 * What a video model accepts.
 *
 * Deliberately small. The provider states which durations, sizes and aspect
 * ratios each model supports, and those lists differ per model — so the tool
 * validates the request against the chosen model's own declaration rather
 * than pinning an enum here that goes stale the first time a model ships with
 * a duration nobody wrote down.
 */
export const generateVideoSchema = z.object({
  prompt: z
    .string()
    .min(3, 'Describe the shot in at least a few words.')
    .max(2000)
    .describe(
      'What happens in the video: subject, motion, camera movement, lighting. ' +
        'Motion is what separates a good prompt from a still image — say what moves and how.',
    ),

  /**
   * A still to animate from. This is the whole of image-to-video: hand the
   * model a picture and it starts there.
   */
  imageUrl: z
    .string()
    .optional()
    .describe(
      'Optional starting frame: the `url` returned by generate_image. ' +
        'The video begins from that image, which is how "turn this picture into a video" works. ' +
        'Pass the URL exactly as generate_image returned it.',
    ),

  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe('Seconds of video. Rounded to the nearest duration the chosen model supports.'),

  aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional().describe('Landscape, portrait or square.'),

  /**
   * Audio doubles the price on some models, so it is opt-in rather than
   * silently on. The result reports what was actually charged.
   */
  withAudio: z.boolean().optional().describe('Generate a soundtrack. Costs more; off by default.'),
});

export type GenerateVideoInput = z.infer<typeof generateVideoSchema>;
