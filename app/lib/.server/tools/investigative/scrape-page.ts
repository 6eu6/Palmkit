/**
 * scrape_page tool
 * =================
 * Fetch a URL and extract structured data: title, metadata, headings,
 * readable content, links, images, tables, code blocks, lists.
 *
 * Available in: work mode only
 *
 * Why work-only?
 *   - scrape_page is heavier than read_url (more parsing, larger response).
 *   - Chat mode is for lightweight Q&A — read_url is sufficient there.
 *   - Code mode users want code, not page analysis.
 *   - Work mode is exactly the place where "analyze this page" belongs.
 *
 * Difference from read_url:
 *   - read_url returns plain text (1 field).
 *   - scrape_page returns up to 9 structured fields.
 *   - scrape_page uses readability-style heuristics for "main content"
 *     (filters out nav/footer/aside/sidebar), while read_url uses a
 *     cruder strip-everything approach.
 *
 * Difference from read_and_extract (legacy work-mode tool):
 *   - scrape_page is a fresh implementation with better heuristics.
 *   - The legacy tool will be deprecated once scrape_page is stable.
 */
import {
  scrapePageSchema,
  type ScrapePageInput,
  type ScrapePageSuccess,
  SCRAPE_PAGE_DEFAULT_FIELDS,
} from '~/lib/.server/tools/schemas/scrape-page';
import {
  fetchWithTimeout,
  decodeHtmlEntities,
  stripHtmlTags,
  resolveUrl,
  truncateWithMarker,
} from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

type ExtractField = NonNullable<ScrapePageInput['extract']>[number];

/**
 * Extract <title> tag content.
 */
function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : undefined;
}

/**
 * Extract all <meta> tags (name= or property= variants) into a flat record.
 * Captures OpenGraph (og:*) and Twitter card (twitter:*) properties.
 */
function extractMetadata(html: string): Record<string, string> | undefined {
  const meta: Record<string, string> = {};

  const re = /<meta\s+(?:name|property|itemprop)=["']([^"']+)["']\s+(?:content|value)=["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const key = m[1].trim();
    const value = decodeHtmlEntities(m[2].trim());

    if (key && !(key in meta)) {
      meta[key] = value;
    }
  }

  // Also pick up charset
  const charset = html.match(/<meta\s+charset=["']?([^"'>\s]+)/i);

  if (charset && !('charset' in meta)) {
    meta.charset = charset[1];
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Extract headings (h1-h6) as a flat list with level + text.
 * The LLM can reconstruct hierarchy from the level field.
 */
function extractHeadings(html: string): Array<{ level: number; text: string }> | undefined {
  const headings: Array<{ level: number; text: string }> = [];

  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    const level = parseInt(m[1], 10);
    const text = stripHtmlTags(m[2]).trim();

    if (text) {
      headings.push({ level, text });
    }

    if (headings.length >= 100) {
      break; // cap at 100 headings
    }
  }

  return headings.length > 0 ? headings : undefined;
}

/**
 * Extract readable main content using a readability-inspired heuristic.
 *
 * Strategy:
 *   1. Remove non-content blocks (script, style, nav, footer, header,
 *      aside, form, iframe, noscript).
 *   2. Find the <main>, <article>, or <div role="main"> if present —
 *      these are strong signals of "this is the article body".
 *   3. If no semantic container, fall back to the full body.
 *   4. Convert block-level tags to newlines, strip remaining tags.
 *
 * This is NOT a full readability implementation (no scoring). It's a
 * pragmatic extraction that works well for documentation, blog posts,
 * and articles. For SPA shells with no server-rendered content, it
 * returns whatever text exists.
 */
function extractContent(
  html: string,
  maxLength: number,
):
  | {
      content: string;
      contentLength: number;
      contentTruncated: boolean;
    }
  | undefined {
  let out = html;

  /*
   * Strip non-content blocks.
   * IMPORTANT: <head> must be removed entirely — otherwise <title>, <meta>,
   * <link>, and other head tags leak into the extracted content as raw text.
   */
  out = out
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');

  /*
   * Try to isolate the main content container.
   * Order matters: <main> is most specific, <article> is also good,
   * <div role="main"> is the ARIA fallback.
   */
  const containerMatch =
    out.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ??
    out.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
    out.match(/<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i);

  if (containerMatch) {
    out = containerMatch[1];
  }

  // Convert block-level tags to newlines
  out = out
    .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|pre|code|blockquote|tr|td|th|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');

  out = decodeHtmlEntities(out);

  // Collapse whitespace
  out = out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!out) {
    return undefined;
  }

  const { text, truncated, originalLength } = truncateWithMarker(out, maxLength);

  return {
    content: text,
    contentLength: originalLength,
    contentTruncated: truncated,
  };
}

/**
 * Extract links with anchor text. Resolves relative URLs against the page URL.
 * Skips javascript:, mailto:, tel:, and #anchor links.
 */
function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string; rel?: string }> | undefined {
  const links: Array<{ text: string; url: string; rel?: string }> = [];
  const seen = new Set<string>();

  const re = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (links.length >= 50) {
      break; // cap
    }

    const attrs = m[1];
    const textRaw = m[2];

    // Extract href
    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);

    if (!hrefMatch) {
      continue;
    }

    let href = hrefMatch[1].trim();

    // Skip non-http links
    if (/^(javascript:|mailto:|tel:|#)/i.test(href)) {
      continue;
    }

    // Resolve relative URLs
    href = resolveUrl(href, baseUrl);

    // Deduplicate by URL
    if (seen.has(href)) {
      continue;
    }

    seen.add(href);

    // Extract rel attribute
    const relMatch = attrs.match(/rel=["']([^"']+)["']/i);
    const rel = relMatch ? relMatch[1] : undefined;

    const text = stripHtmlTags(textRaw).trim().slice(0, 200);

    links.push({
      text: text || '(no text)',
      url: href,
      rel,
    });
  }

  return links.length > 0 ? links : undefined;
}

/**
 * Extract images with src, alt, and dimensions (if specified).
 */
function extractImages(
  html: string,
  baseUrl: string,
): Array<{ src: string; alt: string; width?: number; height?: number }> | undefined {
  const images: Array<{ src: string; alt: string; width?: number; height?: number }> = [];
  const seen = new Set<string>();

  const re = /<img\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (images.length >= 20) {
      break;
    }

    const attrs = m[1];

    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);

    if (!srcMatch) {
      continue;
    }

    let src = srcMatch[1].trim();

    // Skip data URIs (they bloat the response)
    if (src.startsWith('data:')) {
      continue;
    }

    src = resolveUrl(src, baseUrl);

    if (seen.has(src)) {
      continue;
    }

    seen.add(src);

    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    const widthMatch = attrs.match(/width=["']?(\d+)["']?/i);
    const heightMatch = attrs.match(/height=["']?(\d+)["']?/i);

    images.push({
      src,
      alt: altMatch ? decodeHtmlEntities(altMatch[1]) : '',
      width: widthMatch ? parseInt(widthMatch[1], 10) : undefined,
      height: heightMatch ? parseInt(heightMatch[1], 10) : undefined,
    });
  }

  return images.length > 0 ? images : undefined;
}

/**
 * Extract <table> content as JSON arrays (rows of cells).
 */
function extractTables(html: string): Array<{ caption?: string; rows: string[][] }> | undefined {
  const tables: Array<{ caption?: string; rows: string[][] }> = [];

  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRe.exec(html)) !== null) {
    if (tables.length >= 10) {
      break;
    }

    const tableHtml = tableMatch[0];

    // Caption
    const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch ? stripHtmlTags(captionMatch[1]).trim() : undefined;

    // Rows
    const rows: string[][] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
      const cells: string[] = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(stripHtmlTags(cellMatch[1]).trim().slice(0, 500));
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length > 0) {
      tables.push({ caption, rows });
    }
  }

  return tables.length > 0 ? tables : undefined;
}

/**
 * Extract <pre><code> blocks. Tries to detect language from class="language-X".
 */
function extractCodeBlocks(html: string): Array<{ language?: string; code: string }> | undefined {
  const blocks: Array<{ language?: string; code: string }> = [];

  // Match <pre><code>...</code></pre> first (most common)
  const re = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (blocks.length >= 15) {
      break;
    }

    const preContent = m[1];

    // Try to find <code> inside <pre>
    const codeMatch = preContent.match(/<code[^>]*>([\s\S]*?)<\/code>/i);

    if (codeMatch) {
      // Look for language class on <code>
      const langMatch = preContent.match(/<code[^>]*class=["'][^"']*language-([\w-]+)[^"']*["']/i);
      const language = langMatch ? langMatch[1] : undefined;

      const code = decodeHtmlEntities(stripHtmlTags(codeMatch[1])).trim();

      if (code) {
        blocks.push({ language, code: code.slice(0, 5000) });
      }
    } else {
      // <pre> without <code>
      const code = decodeHtmlEntities(stripHtmlTags(preContent)).trim();

      if (code) {
        blocks.push({ code: code.slice(0, 5000) });
      }
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}

/**
 * Extract <ul> and <ol> lists with their items.
 */
function extractLists(html: string): Array<{ type: 'ul' | 'ol'; items: string[] }> | undefined {
  const lists: Array<{ type: 'ul' | 'ol'; items: string[] }> = [];

  // Combined regex for both ul and ol
  const re = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (lists.length >= 20) {
      break;
    }

    const type = m[1].toLowerCase() as 'ul' | 'ol';
    const inner = m[2];

    const items: string[] = [];
    const itemRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRe.exec(inner)) !== null) {
      const item = stripHtmlTags(itemMatch[1]).trim().slice(0, 500);

      if (item) {
        items.push(item);
      }
    }

    if (items.length > 0) {
      lists.push({ type, items });
    }
  }

  return lists.length > 0 ? lists : undefined;
}

export const scrapePageTool: ToolDefinition<typeof scrapePageSchema> = {
  name: 'scrape_page',
  description:
    'Fetch a URL and extract structured data from the page: title, metadata (OpenGraph, Twitter cards), ' +
    'headings hierarchy, readable main content, links, images, tables, code blocks, and lists. ' +
    'Use this when the user wants to ANALYZE a page (not just read its text), extract specific elements, ' +
    'or compare multiple pages. Returns a structured JSON object. ' +
    'For simple "read this article" requests, prefer read_url (lighter). ' +
    'For search queries, use web_search instead. ' +
    'Available in Work mode only — Chat mode users should use read_url.',

  inputSchema: scrapePageSchema,
  availableIn: ['work'],

  execute: async (input: ScrapePageInput, _ctx): Promise<ToolResult> => {
    const { url, extract, maxContentLength = 15000, timeoutMs = 15000 } = input;

    // Determine which fields to extract
    const fields = new Set<ExtractField>(extract ?? SCRAPE_PAGE_DEFAULT_FIELDS);
    const wantAll = !extract || extract.length === 0;

    const want = (field: ExtractField): boolean => wantAll || fields.has(field);

    const startTime = Date.now();

    try {
      const resp = await fetchWithTimeout(url, {
        timeoutMs,
        redirect: 'follow',
      });

      if (!resp.ok) {
        return {
          ok: false,
          error: `HTTP ${resp.status} ${resp.statusText} for ${url}`,
          hint:
            resp.status === 404
              ? 'Page not found. Verify the URL.'
              : resp.status >= 500
                ? 'Server error. Retry or try a different URL.'
                : 'Check the URL and access permissions.',
        };
      }

      const contentType = resp.headers.get('content-type') ?? '';

      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return {
          ok: false,
          error: `scrape_page only supports HTML pages. Got content-type: ${contentType}`,
          hint: 'For JSON APIs, use read_url. For other content types, use read_url with format=raw.',
        };
      }

      const html = await resp.text();
      const result: ScrapePageSuccess = {
        ok: true,
        url,
        fetchedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };

      if (want('title')) {
        const title = extractTitle(html);

        if (title) {
          result.title = title;
        }
      }

      if (want('metadata')) {
        const metadata = extractMetadata(html);

        if (metadata) {
          result.metadata = metadata;
        }
      }

      if (want('headings')) {
        const headings = extractHeadings(html);

        if (headings) {
          result.headings = headings;
        }
      }

      if (want('content')) {
        const contentResult = extractContent(html, maxContentLength);

        if (contentResult) {
          result.content = contentResult.content;
          result.contentLength = contentResult.contentLength;
          result.contentTruncated = contentResult.contentTruncated;
        }
      }

      if (want('links')) {
        const links = extractLinks(html, url);

        if (links) {
          result.links = links;
        }
      }

      if (want('images')) {
        const images = extractImages(html, url);

        if (images) {
          result.images = images;
        }
      }

      if (want('tables')) {
        const tables = extractTables(html);

        if (tables) {
          result.tables = tables;
        }
      }

      if (want('code')) {
        const codeBlocks = extractCodeBlocks(html);

        if (codeBlocks) {
          result.codeBlocks = codeBlocks;
        }
      }

      if (want('lists')) {
        const lists = extractLists(html);

        if (lists) {
          result.lists = lists;
        }
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof Error && err.name === 'AbortTimeoutError') {
        return {
          ok: false,
          error: `Page fetch timed out after ${timeoutMs}ms for ${url}`,
          hint: 'The site is slow. Increase timeoutMs (up to 30000) or try a different URL.',
        };
      }

      return {
        ok: false,
        error: `Failed to scrape ${url}: ${message}`,
      };
    }
  },
};
