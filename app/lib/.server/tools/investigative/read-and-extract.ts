/**
 * read_and_extract tool
 * =====================
 * Fetch a URL and extract structured information for understanding.
 *
 * Available in: work mode only
 *
 * This is the middle-ground tool between read_url (lightweight) and
 * scrape_page (comprehensive). It focuses on what the LLM needs to
 * UNDERSTAND a page:
 *   - title + metadata (context)
 *   - content (the actual text)
 *   - keyPoints (3-7 bullet summary extracted from content)
 *   - links (top 5-10 most relevant outbound links)
 *   - images (top 3-5 most relevant images with alt text)
 *   - tables (HTML tables as JSON arrays)
 *
 * The "keyPoints" field is unique to read_and_extract — it auto-extracts
 * 3-7 bullet points from the content using a simple but effective
 * heuristic (sentences containing keywords from the title + first
 * sentences of paragraphs).
 *
 * When to use vs other tools:
 *   - read_url: user says "read this article" → just want the text
 *   - read_and_extract: user says "extract info from this page" → want structure
 *   - scrape_page: user says "analyze this page's full structure" → want everything
 */
import {
  readAndExtractSchema,
  type ReadAndExtractInput,
  READ_AND_EXTRACT_DEFAULT_FIELDS,
} from '~/lib/.server/tools/schemas/read-and-extract';
import {
  fetchWithTimeout,
  decodeHtmlEntities,
  stripHtmlTags,
  resolveUrl,
  truncateWithMarker,
} from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

type ExtractField = NonNullable<ReadAndExtractInput['extract']>[number];

export const readAndExtractTool: ToolDefinition<typeof readAndExtractSchema> = {
  name: 'read_and_extract',
  description:
    'Fetch a URL and extract structured information for understanding: title, main content, ' +
    'auto-extracted key points (3-7 bullet summary), top links, top images, metadata, and tables. ' +
    'Use this when the user wants to "extract info from", "summarize this page", "what is this page about". ' +
    'Lighter than scrape_page (which returns ALL fields), heavier than read_url (which returns only text). ' +
    'Returns a JSON object with the requested fields. ' +
    'For just reading text use read_url. For full structural analysis use scrape_page.',

  inputSchema: readAndExtractSchema,
  availableIn: ['work'],

  execute: async (input: ReadAndExtractInput): Promise<ToolResult> => {
    const { url, extract, maxContentLength = 15000 } = input;

    // Determine which fields to extract
    const fields = new Set<ExtractField>(extract ?? READ_AND_EXTRACT_DEFAULT_FIELDS);
    const wantAll = !extract || extract.length === 0;
    const want = (field: ExtractField): boolean => wantAll || fields.has(field);

    try {
      const resp = await fetchWithTimeout(url, {
        timeoutMs: 15000,
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
          error: `read_and_extract only supports HTML pages. Got content-type: ${contentType}`,
          hint: 'For JSON APIs use read_url. For PDFs/documents use read_document.',
        };
      }

      const html = await resp.text();
      const result: Record<string, unknown> = {
        ok: true,
        url,
        fetchedAt: new Date().toISOString(),
      };

      // Strip non-content blocks for cleaner extraction
      const cleanedHtml = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '');

      // Title
      if (want('title')) {
        const titleMatch = cleanedHtml.match(/<title[^>]*>([^<]*)<\/title>/i);
        result.title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : '';
      }

      // Metadata (OpenGraph + Twitter cards + standard meta)
      if (want('metadata')) {
        const meta: Record<string, string> = {};
        const re = /<meta\s+(?:name|property|itemprop)=["']([^"']+)["']\s+(?:content|value)=["']([^"']*)["']/gi;
        let m: RegExpExecArray | null;

        while ((m = re.exec(cleanedHtml)) !== null) {
          const key = m[1].trim();
          const value = decodeHtmlEntities(m[2].trim());

          if (key && !(key in meta)) {
            meta[key] = value;
          }
        }

        result.metadata = meta;
      }

      // Content (readability-style extraction)
      let extractedContent = '';

      if (want('content') || want('keyPoints')) {
        extractedContent = extractMainContent(cleanedHtml, maxContentLength);

        if (want('content')) {
          const { text, truncated, originalLength } = truncateWithMarker(extractedContent, maxContentLength);
          result.content = text;
          result.contentLength = originalLength;
          result.contentTruncated = truncated;
        }
      }

      // Key points (auto-extracted bullet summary)
      if (want('keyPoints')) {
        const title = (result.title as string) ?? '';
        result.keyPoints = extractKeyPoints(extractedContent, title, 7);
      }

      // Links (top 5-10)
      if (want('links')) {
        result.links = extractTopLinks(cleanedHtml, url, 10);
      }

      // Images (top 3-5)
      if (want('images')) {
        result.images = extractTopImages(cleanedHtml, url, 5);
      }

      // Tables (HTML tables as JSON)
      if (want('tables')) {
        result.tables = extractTables(cleanedHtml);
      }

      return result as ToolResult;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof Error && err.name === 'AbortTimeoutError') {
        return {
          ok: false,
          error: `URL fetch timed out (15s) for ${url}`,
          hint: 'The site is slow. Use a different URL or use scrape_page with a longer timeout.',
        };
      }

      return { ok: false, error: `Failed to read ${url}: ${message}` };
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Extract main readable content using a readability-inspired heuristic.
 * Same as scrape_page's extractContent, kept here so the tool is self-contained.
 */
function extractMainContent(html: string, _maxLength: number): string {
  let out = html;

  out = out
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

  // Try main/article containers
  const containerMatch =
    out.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ??
    out.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
    out.match(/<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i);

  if (containerMatch) {
    out = containerMatch[1];
  }

  out = out
    .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|pre|code|blockquote|tr|td|th|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');

  out = decodeHtmlEntities(out);

  out = out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return out;
}

/**
 * Extract 3-7 key points from the content as bullet-style sentences.
 *
 * Heuristic:
 *   1. Split content into sentences.
 *   2. Score each sentence by:
 *      - Contains keywords from the title (+3 per keyword)
 *      - Length between 40 and 250 chars (+2)
 *      - Contains a number/percentage (+1)
 *      - First sentence of a paragraph (+1)
 *   3. Pick top N sentences, preserving their original order.
 *
 * This is a pragmatic algorithm — not as good as an LLM summary, but
 * good enough to give the user a quick "what's this page about" without
 * another round-trip to the LLM.
 */
function extractKeyPoints(content: string, title: string, maxPoints: number): string[] {
  if (!content || content.length < 50) {
    return [];
  }

  // Extract keywords from title (skip common stop words)
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'shall',
    'can',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'what',
    'which',
    'who',
    'when',
    'where',
    'why',
    'how',
    'all',
    'each',
    'every',
    'both',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'nor',
    'not',
    'only',
    'own',
    'same',
    'so',
    'than',
    'too',
    'very',
    'just',
    'about',
    'above',
    'after',
    'before',
  ]);

  const titleWords = (title.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !stopWords.has(w));

  // Split content into sentences (handle . ! ? followed by space + capital)
  const sentences = content.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [];

  if (sentences.length === 0) {
    return [];
  }

  // Score each sentence
  const scored = sentences.map((sentence, idx) => {
    const trimmed = sentence.trim();
    const lower = trimmed.toLowerCase();
    let score = 0;

    // Title keyword matches
    for (const word of titleWords) {
      if (lower.includes(word)) {
        score += 3;
      }
    }

    // Length heuristic
    if (trimmed.length >= 40 && trimmed.length <= 250) {
      score += 2;
    } else if (trimmed.length < 20 || trimmed.length > 400) {
      score -= 2;
    }

    // Contains a number/percentage
    if (/\d+(\.\d+)?%?/.test(trimmed)) {
      score += 1;
    }

    // First sentence bonus
    if (idx === 0) {
      score += 2;
    }

    if (idx < 3) {
      score += 1;
    }

    return { sentence: trimmed, score, idx };
  });

  // Pick top N, then sort by original order
  const top = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPoints)
    .sort((a, b) => a.idx - b.idx);

  return top.map((s) => s.sentence);
}

/**
 * Extract top N outbound links (skip internal nav, mailto, javascript).
 * Heuristic for "top": prefer links whose anchor text is longer (more descriptive).
 */
function extractTopLinks(html: string, baseUrl: string, maxLinks: number): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();

  const re = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (links.length >= maxLinks * 2) {
      break;
    } // gather 2x, then filter top N

    const attrs = m[1];
    const textRaw = m[2];

    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);

    if (!hrefMatch) {
      continue;
    }

    let href = hrefMatch[1].trim();

    if (/^(javascript:|mailto:|tel:|#)/i.test(href)) {
      continue;
    }

    href = resolveUrl(href, baseUrl);

    if (seen.has(href)) {
      continue;
    }

    seen.add(href);

    const text = stripHtmlTags(textRaw).trim().slice(0, 200);

    if (!text) {
      continue;
    }

    links.push({ text, url: href });
  }

  // Sort by text length (longer = more descriptive)
  return links.sort((a, b) => b.text.length - a.text.length).slice(0, maxLinks);
}

/**
 * Extract top N images with alt text.
 * Skip data URIs (too large), tiny images (icons/trackers), and SVGs.
 */
function extractTopImages(html: string, baseUrl: string, maxImages: number): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string; altLength: number }> = [];
  const seen = new Set<string>();

  const re = /<img\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (images.length >= maxImages * 3) {
      break;
    }

    const attrs = m[1];

    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);

    if (!srcMatch) {
      continue;
    }

    let src = srcMatch[1].trim();

    if (src.startsWith('data:')) {
      continue;
    }

    if (src.endsWith('.svg') || src.endsWith('.gif')) {
      continue;
    }

    src = resolveUrl(src, baseUrl);

    if (seen.has(src)) {
      continue;
    }

    seen.add(src);

    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    const alt = altMatch ? decodeHtmlEntities(altMatch[1]) : '';

    // Skip images with no alt text (likely decorative/trackers)
    if (!alt) {
      continue;
    }

    images.push({ src, alt, altLength: alt.length });
  }

  // Sort by alt text length (longer = more descriptive)
  return images
    .sort((a, b) => b.altLength - a.altLength)
    .slice(0, maxImages)
    .map(({ src, alt }) => ({ src, alt }));
}

/**
 * Extract HTML tables as JSON arrays (rows of cells).
 * Skips tables with only 1 row (likely layout tables).
 */
function extractTables(html: string): Array<{ caption?: string; rows: string[][] }> {
  const tables: Array<{ caption?: string; rows: string[][] }> = [];

  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let tableMatch: RegExpExecArray | null;

  while ((tableMatch = tableRe.exec(html)) !== null) {
    if (tables.length >= 5) {
      break;
    }

    const tableHtml = tableMatch[0];
    const rows: string[][] = [];

    const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch ? stripHtmlTags(captionMatch[1]).trim() : undefined;

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

    // Skip 1-row tables (layout)
    if (rows.length >= 2) {
      tables.push({ caption, rows });
    }
  }

  return tables;
}
