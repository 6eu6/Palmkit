/**
 * read_url tool
 * =============
 * Fetch a single URL and return its content as text, HTML, or markdown.
 *
 * Available in: chat, work, code (universal)
 *
 * When to use read_url vs scrape_page:
 *   - read_url: you just want the text of a page (docs, articles, APIs).
 *     Lightweight, fast, returns up to 5000 chars by default.
 *   - scrape_page: you need structured data (links, images, tables,
 *     headings, metadata). Heavier, returns up to 15000 chars plus
 *     structured fields. Available in work mode only.
 *
 * If you're not sure which to use, start with read_url. If the user
 * asks to "analyze" or "extract data from" a page, switch to scrape_page.
 */
import { readUrlSchema, type ReadUrlInput } from '~/lib/.server/tools/schemas/read-url';
import {
  fetchWithTimeout,
  decodeHtmlEntities,
  stripHtmlTags,
  truncateWithMarker,
} from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

/**
 * Minimal HTML→Markdown converter for the "markdown" format option.
 * Handles headings, bold, italic, lists, code, links, and paragraphs.
 * Not a full markdown library — just enough for documentation pages.
 */
function htmlToMarkdown(html: string): string {
  let out = html;

  // Remove script/style/nav/footer entirely
  out = out
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '');

  // Convert links before stripping tags: <a href="X">Y</a> → [Y](X)
  out = out.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanText = text.replace(/<[^>]+>/g, '').trim();
    return cleanText ? `[${cleanText}](${href})` : '';
  });

  // Headings
  out = out.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  out = out.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  out = out.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  out = out.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  out = out.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  out = out.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Emphasis
  out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

  // Code blocks
  out = out.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Blockquotes
  out = out.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => {
    return (
      '\n' +
      text
        .replace(/<[^>]+>/g, '')
        .split('\n')
        .map((l: string) => `> ${l}`)
        .join('\n') +
      '\n'
    );
  });

  // Lists
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  // Paragraphs and breaks
  out = out.replace(/<p[^>]*>/gi, '\n');
  out = out.replace(/<\/p>/gi, '\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip remaining tags
  out = out.replace(/<[^>]+>/g, '');

  // Decode entities
  out = decodeHtmlEntities(out);

  // Collapse whitespace
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/[ \t]+/g, ' ');
  out = out.trim();

  return out;
}

export const readUrlTool: ToolDefinition<typeof readUrlSchema> = {
  name: 'read_url',
  description:
    'Fetch a URL and return its content as text, HTML, or markdown. ' +
    'Use this to read documentation pages, API references, articles, or any URL the user shares. ' +
    'Returns: the extracted content (default: text, max 5000 chars), the content type, and the URL. ' +
    'For JSON APIs, returns the raw JSON. For HTML pages, strips tags and returns readable text. ' +
    'Do NOT use this for search queries (use web_search instead). ' +
    'If you need structured data (links, images, tables, metadata), use scrape_page instead.',

  inputSchema: readUrlSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: ReadUrlInput, _ctx): Promise<ToolResult> => {
    const { url, maxLength = 5000, format = 'text' } = input;

    try {
      const resp = await fetchWithTimeout(url, {
        timeoutMs: 12000,
        redirect: 'follow',
      });

      if (!resp.ok) {
        return {
          ok: false,
          error: `HTTP ${resp.status} ${resp.statusText} for ${url}`,
          hint:
            resp.status === 404
              ? 'The page does not exist. Verify the URL.'
              : resp.status >= 500
                ? 'The server had an error. Retry or try a different URL.'
                : 'Check the URL and your access.',
        };
      }

      const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';

      // JSON responses are always returned as pretty-printed JSON.
      if (contentType.includes('application/json')) {
        const data = await resp.json();
        const jsonStr = JSON.stringify(data, null, 2);
        const { text, truncated, originalLength } = truncateWithMarker(jsonStr, maxLength);

        return {
          ok: true,
          url,
          contentType,
          format: 'json',
          content: text,
          truncated,
          originalLength,
        };
      }

      // Non-HTML responses: return as text.
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        const text = await resp.text();
        const { text: truncated, truncated: wasTruncated } = truncateWithMarker(text, maxLength);

        return {
          ok: true,
          url,
          contentType,
          format: 'raw',
          content: truncated,
          truncated: wasTruncated,
          originalLength: text.length,
        };
      }

      // HTML responses
      const html = await resp.text();

      if (format === 'html') {
        const { text, truncated, originalLength } = truncateWithMarker(html, maxLength);

        return {
          ok: true,
          url,
          contentType,
          format: 'html',
          content: text,
          truncated,
          originalLength,
        };
      }

      if (format === 'markdown') {
        const markdown = htmlToMarkdown(html);
        const { text, truncated, originalLength } = truncateWithMarker(markdown, maxLength);

        return {
          ok: true,
          url,
          contentType,
          format: 'markdown',
          content: text,
          truncated,
          originalLength,
        };
      }

      /*
       * Default: text
       * text variable removed (was unused)
       */

      const stripped = stripHtmlTags(decodeHtmlEntities(html));
      const { text: finalText, truncated, originalLength } = truncateWithMarker(stripped, maxLength);

      return {
        ok: true,
        url,
        contentType,
        format: 'text',
        content: finalText,
        truncated,
        originalLength,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof Error && err.name === 'AbortTimeoutError') {
        return {
          ok: false,
          error: `URL fetch timed out (12s) for ${url}`,
          hint: 'The site is slow or unresponsive. Try a different URL or retry.',
        };
      }

      return {
        ok: false,
        error: `Failed to fetch ${url}: ${message}`,
      };
    }
  },
};
