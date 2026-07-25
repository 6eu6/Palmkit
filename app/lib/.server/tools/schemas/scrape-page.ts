/**
 * Scrape Page Schema
 * ------------------
 * Used by: scrape_page tool (work mode only — deeper than read_url)
 *
 * scrape_page returns structured data (title, metadata, headings,
 * content, links, images, tables) from a single page. It's the right
 * tool when the user needs to *analyze* a page rather than just read it.
 */
import { z } from 'zod';

export const scrapePageSchema = z.object({
  url: z.string().url().describe('The page URL to scrape. Must include the protocol.'),
  extract: z
    .array(
      z.enum([
        'title', // <title> tag
        'metadata', // <meta> tags + OpenGraph + Twitter cards
        'headings', // h1-h6 with hierarchy
        'content', // main readable text (readability-style extraction)
        'links', // <a href> with anchor text
        'images', // <img src alt>
        'tables', // <table> as JSON arrays
        'code', // <pre><code> blocks
        'lists', // <ul>/<ol> items
      ]),
    )
    .optional()
    .describe(
      'What to extract. If omitted, all fields are returned. ' +
        'Requesting fewer fields reduces response size and LLM context usage.',
    ),
  maxContentLength: z
    .number()
    .int()
    .min(1000)
    .max(50000)
    .optional()
    .describe('Maximum characters of readable content to return (default 15000).'),
  timeoutMs: z
    .number()
    .int()
    .min(3000)
    .max(30000)
    .optional()
    .describe('Fetch timeout in ms (default 15000, max 30000). Pages that take longer will fail.'),
});

export type ScrapePageInput = z.infer<typeof scrapePageSchema>;

/**
 * Default fields extracted when `extract` is omitted.
 */
export const SCRAPE_PAGE_DEFAULT_FIELDS = ['title', 'metadata', 'headings', 'content', 'links', 'images'] as const;

/**
 * The structured result of scrape_page. Exported so tests and
 * downstream tools (e.g. extract_structured) can reference it.
 *
 * Extends ToolSuccess so the result is assignable to ToolResult
 * without an explicit cast. The index signature on ToolSuccess
 * covers all the optional fields below.
 */
export interface ScrapePageSuccess {
  ok: true;
  url: string;
  title?: string;
  metadata?: Record<string, string>;
  headings?: Array<{ level: number; text: string }>;
  content?: string;
  contentLength?: number;
  contentTruncated?: boolean;
  links?: Array<{ text: string; url: string; rel?: string }>;
  images?: Array<{ src: string; alt: string; width?: number; height?: number }>;
  tables?: Array<{ caption?: string; rows: string[][] }>;
  codeBlocks?: Array<{ language?: string; code: string }>;
  lists?: Array<{ type: 'ul' | 'ol'; items: string[] }>;
  fetchedAt: string;
  durationMs: number;
  [key: string]: unknown;
}
