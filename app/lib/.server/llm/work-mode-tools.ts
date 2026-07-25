/**
 * Work Mode Tools — office, analytical, and investigative tools.
 *
 * These tools are available in /work mode (chatMode='discuss' + sidebarMode='work').
 * They run in Cloudflare Pages (no external-worker needed) and provide:
 *
 * OFFICE:
 *   - generate_image: AI image generation via OpenRouter
 *   - create_document: structured document creation (markdown → downloadable)
 *
 * ANALYTICAL:
 *   - analyze_data: parse CSV/JSON, return statistical insights
 *   - format_table: format raw data into a structured table
 *
 * INVESTIGATIVE:
 *   - deep_search: multi-query web search with synthesis
 *   - read_and_extract: enhanced URL reader with structured extraction
 *
 * All tools use fetch() (no heavy dependencies) and are safe for CF Pages.
 */

import { tool } from 'ai';
import { z } from 'zod';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * OFFICE TOOLS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Generate an image using OpenRouter's image models.
 * Calls the image generation API directly — no external-worker needed.
 */
export const generateImageTool = tool({
  description:
    'Generate an AI image from a text description. Use this to create logos, illustrations, ' +
    'hero images, icons, or any visual asset. The image is returned as a data URL that can ' +
    'be displayed in the chat or downloaded. Provide a detailed prompt including style, ' +
    'colors, and composition.',
  parameters: z.object({
    prompt: z.string().describe('Detailed image description: subject, style, colors, composition.'),
    size: z.enum(['256x256', '512x512', '1024x1024']).optional().describe('Image size (default 1024x1024)'),
    transparent: z.boolean().optional().describe('Use transparent background (for logos/icons)'),
  }),
  execute: async ({ prompt, size, transparent }) => {
    // Get API key from environment or cookies
    const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_API_KEY;

    if (!apiKey) {
      return {
        ok: false,
        error: 'Image generation requires an OpenRouter API key. Configure it in Settings.',
      };
    }

    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30000);

      const fullPrompt = transparent ? `${prompt}, transparent background, no background` : prompt;

      // Use OpenRouter to call an image model
      const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://palmkit.app',
          'X-Title': 'PalmKit Work',
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          n: 1,
          size: size || '1024x1024',
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return { ok: false, error: `Image generation failed: HTTP ${response.status} — ${errText.slice(0, 200)}` };
      }

      const data: any = await response.json();
      const imageBase64 = data.data?.[0]?.b64_json;

      if (!imageBase64) {
        // Some models return URL instead of base64
        const imageUrl = data.data?.[0]?.url;

        if (imageUrl) {
          return { ok: true, url: imageUrl, prompt: fullPrompt };
        }

        return { ok: false, error: 'No image data returned from the model.' };
      }

      const mime = transparent ? 'image/png' : 'image/png';
      const dataUrl = `data:${mime};base64,${imageBase64}`;

      return {
        ok: true,
        dataUrl,
        prompt: fullPrompt,
        size: size || '1024x1024',
        bytes: Math.round((imageBase64.length * 3) / 4),
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { ok: false, error: 'Image generation timed out (30s). Try a simpler prompt.' };
      }

      return { ok: false, error: `Image generation failed: ${err.message}` };
    }
  },
});

/**
 * Create a structured document (markdown format, downloadable as .md).
 * The document is returned as text — the frontend can render it or offer download.
 */
export const createDocumentTool = tool({
  description:
    'Create a structured document in markdown format. Use this for reports, proposals, ' +
    'meeting notes, specifications, or any written deliverable. The document includes ' +
    'headings, lists, tables, and code blocks as needed. The content is returned as ' +
    'markdown text that the user can read, edit, or export.',
  parameters: z.object({
    title: z.string().describe('Document title'),
    content: z.string().describe('Full document content in markdown format'),
    format: z.enum(['markdown', 'html', 'text']).optional().describe('Output format (default: markdown)'),
  }),
  execute: async ({ title, content, format }) => {
    const outputFormat = format || 'markdown';
    const timestamp = new Date().toISOString();

    let output = '';

    if (outputFormat === 'html') {
      // Simple markdown → HTML conversion
      const html = content
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.+<\/li>\n?)+/g, '<ul>$&</ul>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');

      output = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<h1>${title}</h1>
<p><em>Generated by PalmKit — ${timestamp}</em></p>
${html}
</body>
</html>`;
    } else {
      output = `# ${title}\n\n_Generated by PalmKit — ${timestamp}_\n\n${content}`;
    }

    return {
      ok: true,
      title,
      format: outputFormat,
      content: output,
      length: output.length,
      downloadable: true,
    };
  },
});

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * ANALYTICAL TOOLS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Analyze CSV or JSON data — returns statistical insights.
 */
export const analyzeDataTool = tool({
  description:
    'Analyze tabular data (CSV or JSON array) and return statistical insights. ' +
    'Calculates: row count, column summary, numeric statistics (min/max/avg/sum), ' +
    'value distribution, and detects patterns. Use this when the user provides data ' +
    'for analysis or asks for insights from a dataset.',
  parameters: z.object({
    data: z.string().describe('Raw data in CSV or JSON format'),
    format: z.enum(['csv', 'json']).optional().describe('Data format (auto-detected if omitted)'),
  }),
  execute: async ({ data, format }) => {
    try {
      let rows: Record<string, any>[] = [];
      const detectedFormat = format || (data.trim().startsWith('[') || data.trim().startsWith('{') ? 'json' : 'csv');

      if (detectedFormat === 'json') {
        const parsed = JSON.parse(data);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        // Parse CSV
        const lines = data.trim().split('\n');

        if (lines.length < 2) {
          return { ok: false, error: 'CSV needs at least a header row and one data row.' };
        }

        const headers = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
          const row: Record<string, any> = {};

          headers.forEach((h, idx) => {
            const v = values[idx];
            const num = Number(v);
            row[h] = !isNaN(num) && v !== '' ? num : v;
          });
          rows.push(row);
        }
      }

      if (rows.length === 0) {
        return { ok: false, error: 'No data rows found.' };
      }

      // Column analysis
      const columns = Object.keys(rows[0]);
      const columnStats: Record<string, any> = {};

      for (const col of columns) {
        const values = rows.map((r) => r[col]).filter((v) => v !== undefined && v !== null && v !== '');
        const numericValues = values.filter((v) => typeof v === 'number' || !isNaN(Number(v))).map(Number);

        if (numericValues.length === values.length && numericValues.length > 0) {
          // Numeric column
          const sum = numericValues.reduce((a, b) => a + b, 0);
          const avg = sum / numericValues.length;
          const sorted = [...numericValues].sort((a, b) => a - b);

          columnStats[col] = {
            type: 'numeric',
            count: numericValues.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            avg: Math.round(avg * 100) / 100,
            sum: Math.round(sum * 100) / 100,
            median: sorted[Math.floor(sorted.length / 2)],
          };
        } else {
          // Text column
          const uniqueValues = [...new Set(values)];
          const valueCounts: Record<string, number> = {};

          values.forEach((v) => {
            valueCounts[String(v)] = (valueCounts[String(v)] || 0) + 1;
          });

          const topValues = Object.entries(valueCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([val, count]) => ({ value: val, count, percentage: Math.round((count / values.length) * 100) }));

          columnStats[col] = {
            type: 'text',
            count: values.length,
            unique: uniqueValues.length,
            topValues,
          };
        }
      }

      return {
        ok: true,
        totalRows: rows.length,
        totalColumns: columns.length,
        columns: columnStats,
        sample: rows.slice(0, 3),
      };
    } catch (err: any) {
      return { ok: false, error: `Data analysis failed: ${err.message}` };
    }
  },
});

/**
 * Format raw text data into a structured table.
 */
export const formatTableTool = tool({
  description:
    'Format raw text data into a structured markdown table. Use this when the user ' +
    'has unstructured data (e.g., copy-pasted from a spreadsheet or document) and ' +
    'wants it organized into a clean table format.',
  parameters: z.object({
    data: z.string().describe('Raw data to format'),
    headers: z.array(z.string()).optional().describe('Column headers (auto-detected if omitted)'),
  }),
  execute: async ({ data, headers }) => {
    const lines = data.trim().split('\n');

    if (lines.length === 0) {
      return { ok: false, error: 'No data provided.' };
    }

    // Auto-detect delimiter
    const delimiters = ['\t', ',', ';', '|', '  '];
    let bestDelimiter = '\t';
    let maxColumns = 0;

    for (const d of delimiters) {
      const cols = lines[0].split(d).filter((c) => c.trim()).length;

      if (cols > maxColumns) {
        maxColumns = cols;
        bestDelimiter = d;
      }
    }

    const rows = lines.filter((l) => l.trim()).map((l) => l.split(bestDelimiter).map((c) => c.trim()));

    const cols = headers || rows[0] || [];
    const dataRows = headers ? rows : rows.slice(1);

    // Build markdown table
    const headerRow = `| ${cols.join(' | ')} |`;
    const separatorRow = `| ${cols.map(() => '---').join(' | ')} |`;
    const bodyRows = dataRows.map((r) => `| ${r.join(' | ')} |`);

    const markdownTable = [headerRow, separatorRow, ...bodyRows].join('\n');

    return {
      ok: true,
      table: markdownTable,
      rows: dataRows.length,
      columns: cols.length,
    };
  },
});

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * INVESTIGATIVE TOOLS
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Multi-query web search with synthesis.
 * Runs multiple searches and combines results for comprehensive coverage.
 */
export const deepSearchTool = tool({
  description:
    'Perform a comprehensive web search using multiple query variations. ' +
    'Use this when the user needs thorough research on a topic — it runs ' +
    '3-5 search queries from different angles and combines the results. ' +
    'Returns synthesized findings with source URLs.',
  parameters: z.object({
    topic: z.string().describe('The topic to research'),
    depth: z.enum(['quick', 'standard', 'thorough']).optional().describe('Search depth (default: standard)'),
  }),
  execute: async ({ topic, depth }) => {
    const searchDepth = depth || 'standard';
    const queryCount = searchDepth === 'quick' ? 2 : searchDepth === 'thorough' ? 5 : 3;

    // Generate query variations
    const queries = [
      topic,
      `${topic} guide tutorial`,
      `${topic} best practices examples`,
      `what is ${topic} explained`,
      `${topic} comparison review`,
    ].slice(0, queryCount);

    const allResults: Array<{ title: string; url: string; snippet: string; query: string }> = [];

    // Run searches in parallel
    const searchPromises = queries.map(async (query) => {
      try {
        const apiKey = process.env.TAVILY_API_KEY;

        if (apiKey) {
          const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, query, max_results: 3 }),
          });

          if (resp.ok) {
            const data = (await resp.json()) as any;
            return (data.results || []).map((r: any) => ({
              title: r.title,
              url: r.url,
              snippet: r.content?.slice(0, 200) || '',
              query,
            }));
          }
        }

        // Fallback: use the existing web search via DuckDuckGo HTML
        const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': 'Palmkit-Agent/1.0' },
        });

        if (resp.ok) {
          const html = await resp.text();
          const results: Array<{ title: string; url: string; snippet: string; query: string }> = [];
          const matches = html.matchAll(
            /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]*)<\/a>/g,
          );

          let count = 0;

          for (const match of matches) {
            if (count >= 3) {
              break;
            }

            results.push({
              title: match[2].trim(),
              url: match[1].trim(),
              snippet: match[3].trim().slice(0, 200),
              query,
            });
            count++;
          }

          return results;
        }

        return [];
      } catch {
        return [];
      }
    });

    const results = await Promise.all(searchPromises);

    for (const batch of results) {
      allResults.push(...batch);
    }

    // Deduplicate by URL
    const seen = new Set<string>();
    const deduped = allResults.filter((r) => {
      if (seen.has(r.url)) {
        return false;
      }

      seen.add(r.url);

      return true;
    });

    return {
      ok: true,
      topic,
      depth: searchDepth,
      totalResults: deduped.length,
      queries,
      results: deduped.slice(0, 10),
    };
  },
});

/**
 * Enhanced URL reader with structured extraction.
 * Reads a URL and extracts: title, main content, links, images, metadata.
 */
export const readAndExtractTool = tool({
  description:
    'Read a URL and extract structured information: title, main content, ' +
    'key points, links, images, and metadata. More thorough than read_url — ' +
    'use this when the user needs a deep analysis of a web page.',
  parameters: z.object({
    url: z.string().url().describe('The URL to analyze'),
    extract: z
      .array(z.enum(['content', 'links', 'images', 'metadata', 'headings', 'tables']))
      .optional()
      .describe('What to extract (default: all)'),
  }),
  execute: async ({ url, extract }) => {
    const extractAll = !extract || extract.length === 0;
    const wantContent = extractAll || extract!.includes('content');
    const wantLinks = extractAll || extract!.includes('links');
    const wantImages = extractAll || extract!.includes('images');
    const wantMetadata = extractAll || extract!.includes('metadata');
    const wantHeadings = extractAll || extract!.includes('headings');
    const wantTables = extractAll || extract!.includes('tables');

    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Palmkit-Agent/1.0' },
        signal: controller.signal,
      });

      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
      }

      const html = await resp.text();
      const result: any = { ok: true, url };

      // Title
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      result.title = titleMatch ? titleMatch[1].trim() : '';

      // Metadata
      if (wantMetadata) {
        const meta: Record<string, string> = {};
        const metaMatches = html.matchAll(/<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']*)["']/gi);

        for (const m of metaMatches) {
          meta[m[1]] = m[2];
        }

        result.metadata = meta;
      }

      // Headings
      if (wantHeadings) {
        const headings: Array<{ level: number; text: string }> = [];
        const headingMatches = html.matchAll(/<h([1-6])[^>]*>([^<]*)<\/h\1>/gi);

        for (const m of headingMatches) {
          headings.push({ level: parseInt(m[1]), text: m[2].trim() });
        }

        result.headings = headings;
      }

      // Content (text extraction)
      if (wantContent) {
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '')
          .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|pre|code)[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        result.content = text.slice(0, 10000);
        result.contentLength = text.length;
      }

      // Links
      if (wantLinks) {
        const links: Array<{ text: string; url: string }> = [];
        const linkMatches = html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi);

        let count = 0;

        for (const m of linkMatches) {
          if (count >= 20) {
            break;
          }

          const linkUrl = m[1].trim();
          const linkText = m[2].trim();

          if (linkUrl && !linkUrl.startsWith('#') && !linkUrl.startsWith('javascript:')) {
            links.push({ text: linkText, url: linkUrl });
            count++;
          }
        }

        result.links = links;
      }

      // Images
      if (wantImages) {
        const images: Array<{ src: string; alt: string }> = [];
        const imgMatches = html.matchAll(/<img\s+[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi);

        let count = 0;

        for (const m of imgMatches) {
          if (count >= 10) {
            break;
          }

          images.push({ src: m[1].trim(), alt: m[2].trim() });
          count++;
        }

        result.images = images;
      }

      // Tables
      if (wantTables) {
        const tables: string[][] = [];
        const tableMatches = html.matchAll(/<table[\s\S]*?<\/table>/gi);

        for (const tableMatch of tableMatches) {
          const tableHtml = tableMatch[0];
          const rows: string[][] = [];
          const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

          for (const rowMatch of rowMatches) {
            const cells: string[] = [];
            const cellMatches = rowMatch[1].matchAll(/<t[dh][^>]*>([^<]*)<\/t[dh]>/gi);

            for (const cellMatch of cellMatches) {
              cells.push(cellMatch[1].trim());
            }

            if (cells.length > 0) {
              rows.push(cells);
            }
          }

          if (rows.length > 0) {
            tables.push(...rows);
          }
        }

        result.tables = tables;
      }

      return result;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { ok: false, error: 'URL read timed out (15s).' };
      }

      return { ok: false, error: `Failed to read URL: ${err.message}` };
    }
  },
});

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * EXPORT
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const workModeTools = {
  generate_image: generateImageTool,
  create_document: createDocumentTool,
  analyze_data: analyzeDataTool,
  format_table: formatTableTool,
  deep_search: deepSearchTool,
  read_and_extract: readAndExtractTool,
} as const;
