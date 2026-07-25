/**
 * deep_search tool
 * =================
 * Multi-query web search for comprehensive topic research.
 *
 * Available in: work mode only
 *
 * Improvements over the legacy deep_search:
 *   - Better query generation (semantic angles, not just suffix variations)
 *   - URL normalization for proper deduplication
 *   - Source diversity: caps 3 results per source domain
 *   - Returns structured "findings" array, not just a flat list
 *
 * Search provider:
 *   - Tavily (if TAVILY_API_KEY is set) — AI-optimized results
 *   - DuckDuckGo HTML (fallback) — no key needed, lower quality
 *
 * The tool generates multiple query variations to cover the topic from
 * different angles:
 *   - The original topic
 *   - "topic + guide/tutorial"
 *   - "topic + best practices"
 *   - "what is topic + explained"
 *   - "topic + comparison/review" (thorough only)
 */
import {
  deepSearchSchema,
  type DeepSearchInput,
  type DeepSearchSuccess,
  type DeepSearchResult,
} from '~/lib/.server/tools/schemas/deep-search';
import { fetchWithTimeout } from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolContext, ToolResult } from '~/lib/.server/tools/types';

export const deepSearchTool: ToolDefinition<typeof deepSearchSchema> = {
  name: 'deep_search',
  description:
    'Perform a comprehensive multi-query web search on a topic. ' +
    'Use this when the user needs thorough research: "research X", "look into X", "find out about X", ' +
    '"what are the options for X". ' +
    'Generates 2-5 query variations from different angles (topic, guide, best practices, comparison), ' +
    'runs them in parallel, deduplicates results by URL, and caps 3 results per source domain for diversity. ' +
    'Returns: synthesized findings (3-5 bullet points the user can read directly) + structured results with title/url/snippet/sourceDomain. ' +
    'IMPORTANT: the input parameter is called "topic" (NOT "query" — that is for web_search). ' +
    'For a single quick lookup use web_search instead. For reading one specific URL use read_url.',

  inputSchema: deepSearchSchema,
  availableIn: ['work'],

  execute: async (input: DeepSearchInput, ctx): Promise<ToolResult> => {
    const { topic, depth = 'standard', maxResultsPerQuery = 3 } = input;

    const queryCount = depth === 'quick' ? 2 : depth === 'thorough' ? 5 : 3;
    const queries = generateQueryVariations(topic, queryCount);

    try {
      // Run all queries in parallel
      const searchPromises = queries.map((q) => runSingleSearch(q, maxResultsPerQuery, ctx));
      const searchResults = await Promise.all(searchPromises);

      // Flatten + deduplicate
      const allResults: DeepSearchResult[] = [];

      for (const batch of searchResults) {
        allResults.push(...batch);
      }

      const deduped = deduplicateByUrl(allResults);

      // Apply source diversity cap: max 3 results per domain
      const diversified = applySourceDiversityCap(deduped, 3);

      // Cap total at 15
      const finalResults = diversified.slice(0, 15);

      // Generate findings (top 3-5 bullet points from snippets)
      const findings = generateFindings(topic, finalResults);

      const result: DeepSearchSuccess = {
        ok: true,
        topic,
        depth,
        queriesUsed: queries,
        totalResults: finalResults.length,
        results: finalResults,
        findings,
        searchedAt: new Date().toISOString(),
      };

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Deep search failed: ${message}` };
    }
  },
};

/**
 * Generate semantic query variations from a topic.
 * Instead of just appending suffixes (legacy behavior), we generate
 * queries from different ANGLES to maximize coverage.
 */
function generateQueryVariations(topic: string, count: number): string[] {
  const variations = [
    topic, // original
    `${topic} guide tutorial`, // educational angle
    `${topic} best practices`, // practical angle
    `what is ${topic} explained`, // definitional angle
    `${topic} comparison review`, // evaluative angle
  ];

  return variations.slice(0, count);
}

/**
 * Run a single search query using Tavily (preferred) or DuckDuckGo (fallback).
 * Returns up to `maxResults` results.
 */
async function runSingleSearch(query: string, maxResults: number, ctx: ToolContext): Promise<DeepSearchResult[]> {
  if (ctx.searchApiKey) {
    return await searchWithTavily(query, maxResults, ctx.searchApiKey);
  }

  // Fallback: DuckDuckGo HTML scraping
  return await searchWithDuckDuckGo(query, maxResults);
}

async function searchWithTavily(query: string, maxResults: number, apiKey: string): Promise<DeepSearchResult[]> {
  try {
    const resp = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      timeoutMs: 15000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: false,
      }),
    });

    if (!resp.ok) {
      return [];
    }

    const data: any = await resp.json();
    const results: DeepSearchResult[] = (data.results ?? []).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content?.slice(0, 300) ?? '',
      sourceDomain: extractDomain(r.url ?? ''),
      query,
    }));

    return results;
  } catch {
    return [];
  }
}

/**
 * DuckDuckGo HTML scraping fallback (no API key needed).
 * Parses the HTML search results page.
 *
 * This is the same fallback the legacy tool used. It's fragile (DDG
 * can change their HTML at any time) but works for now. If Tavily
 * is configured, this code path is never reached.
 */
async function searchWithDuckDuckGo(query: string, maxResults: number): Promise<DeepSearchResult[]> {
  try {
    const resp = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      timeoutMs: 12000,
    });

    if (!resp.ok) {
      return [];
    }

    const html = await resp.text();
    const results: DeepSearchResult[] = [];

    /*
     * DDG wraps results in <a class="result__a" href="...">title</a>
     * and snippets in <a class="result__snippet">
     */
    const titleRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>/g;
    const snippetRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const titles: Array<{ url: string; title: string }> = [];
    const snippets: string[] = [];

    let m: RegExpExecArray | null;

    while ((m = titleRegex.exec(html)) !== null) {
      titles.push({
        url: m[1].trim(),
        title: stripHtml(m[2]).trim(),
      });
    }

    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(stripHtml(m[1]).trim());
    }

    for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
      const t = titles[i];

      // DDG URLs are wrapped in a redirect: //duckduckgo.com/l/?uddg=ENCODED_URL
      let cleanUrl = t.url;
      const uddgMatch = t.url.match(/uddg=([^&]+)/);

      if (uddgMatch) {
        try {
          cleanUrl = decodeURIComponent(uddgMatch[1]);
        } catch {
          // keep original
        }
      }

      results.push({
        title: t.title,
        url: cleanUrl,
        snippet: (snippets[i] ?? '').slice(0, 300),
        sourceDomain: extractDomain(cleanUrl),
        query,
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Deduplicate results by normalized URL.
 * Normalization: lowercase, strip trailing slash, strip query string,
 * strip fragment. This catches the same article appearing under
 * slightly different URLs.
 */
function deduplicateByUrl(results: DeepSearchResult[]): DeepSearchResult[] {
  const seen = new Set<string>();
  const deduped: DeepSearchResult[] = [];

  for (const r of results) {
    const normalized = normalizeUrl(r.url);

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(r);
  }

  return deduped;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.toLowerCase();
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Cap results per source domain to ensure diversity.
 * Without this, a single site (e.g. medium.com) can dominate the results.
 */
function applySourceDiversityCap(results: DeepSearchResult[], cap: number): DeepSearchResult[] {
  const domainCounts: Record<string, number> = {};
  const diversified: DeepSearchResult[] = [];

  for (const r of results) {
    const domain = r.sourceDomain;

    if (!domain) {
      diversified.push(r);
      continue;
    }

    if ((domainCounts[domain] ?? 0) < cap) {
      diversified.push(r);
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
    }
  }

  return diversified;
}

/**
 * Generate 3-5 high-level findings the user can read directly.
 * We pick the top snippets (by length, as a quality proxy) and condense them.
 */
function generateFindings(topic: string, results: DeepSearchResult[]): string[] {
  if (results.length === 0) {
    return [`No results found for "${topic}". Try a different phrasing or check your search API key.`];
  }

  // Sort by snippet length (longer snippets tend to be more informative)
  const sorted = [...results].sort((a, b) => b.snippet.length - a.snippet.length);
  const top = sorted.slice(0, 5);

  return top.map((r, idx) => {
    const snippet = r.snippet.slice(0, 200).trim();
    return `${idx + 1}. ${snippet}${r.snippet.length > 200 ? '…' : ''} (Source: ${r.sourceDomain})`;
  });
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
