/**
 * Read URL Schema
 * ---------------
 * Used by: read_url tool (chat, work, code modes)
 */
import { z } from 'zod';

export const readUrlSchema = z.object({
  url: z.string().url().describe('The URL to fetch. Must include the protocol (https:// or http://).'),
  maxLength: z
    .number()
    .int()
    .min(500)
    .max(50000)
    .optional()
    .describe('Maximum characters of extracted text to return (default 5000, max 50000).'),
  format: z
    .enum(['text', 'html', 'markdown'])
    .optional()
    .describe(
      'Output format. "text" strips HTML (default). "html" keeps the raw HTML. ' +
        '"markdown" converts basic HTML to markdown.',
    ),
});

export type ReadUrlInput = z.infer<typeof readUrlSchema>;
