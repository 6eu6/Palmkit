/**
 * Read and Extract Schema
 * -----------------------
 * Used by: read_and_extract tool (work mode only)
 *
 * Fetches a URL and extracts structured information. This is the
 * Swiss-army-knife tool for "I want to deeply understand this page".
 *
 * Difference from read_url:
 *   - read_url returns plain text (lightweight, fast, 5000 chars max)
 *   - read_and_extract returns structured fields: title, content, key points,
 *     links, images, tables, metadata (15000 chars max)
 *
 * Difference from scrape_page:
 *   - scrape_page returns ALL fields (title, metadata, headings, content,
 *     links, images, tables, code blocks, lists) — comprehensive
 *   - read_and_extract is more selective: focuses on what the LLM needs
 *     to UNDERSTAND the page (key points + main content + key links)
 *
 * When to use which:
 *   - User says "read this article" → read_url
 *   - User says "extract data from this page" → read_and_extract
 *   - User says "analyze this page's full structure" → scrape_page
 */
import { z } from 'zod';

export const readAndExtractSchema = z.object({
  url: z.string().url().describe('The URL to read and extract information from.'),
  extract: z
    .array(
      z.enum([
        'title', // page title
        'content', // main readable text (readability-style extraction)
        'keyPoints', // 3-7 bullet-point summary extracted from content
        'links', // 5-10 most relevant outbound links
        'images', // 3-5 most relevant images with alt text
        'metadata', // OpenGraph + Twitter card meta tags
        'tables', // HTML tables as JSON arrays
      ]),
    )
    .optional()
    .describe(
      'What to extract. If omitted, defaults to [title, content, keyPoints, links, metadata]. ' +
        'Requesting fewer fields reduces LLM context usage.',
    ),
  maxContentLength: z
    .number()
    .int()
    .min(1000)
    .max(30000)
    .optional()
    .describe('Max chars of content to return (default 15000).'),
});

export type ReadAndExtractInput = z.infer<typeof readAndExtractSchema>;

export const READ_AND_EXTRACT_DEFAULT_FIELDS = ['title', 'content', 'keyPoints', 'links', 'metadata'] as const;
