/**
 * web_search tool
 * ===============
 * Search the web for documentation, examples, or current information.
 *
 * Available in: chat, work, code (all modes — research is universal)
 *
 * Provider priority:
 *   1. Tavily (if TAVILY_API_KEY is set) — AI-optimized results
 *   2. SerpApi (if SERPAPI_KEY is set) — secondary
 *   3. Fallback: helpful error suggesting the user configure a key
 *
 * Why a fallback error instead of a DuckDuckGo scrape?
 *   - DuckDuckGo HTML scraping is fragile (changes break it silently).
 *   - The scrape also tends to return low-quality snippets.
 *   - Better to tell the user "configure Tavily (free 1000/mo)" than
 *     return garbage results that send the LLM down the wrong path.
 */
import { webSearchSchema, type WebSearchInput } from '~/lib/.server/tools/schemas/web-search';
import { fetchWithTimeout } from '~/lib/.server/tools/schemas/_network';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

interface TavilyResult {
  title: string;
  url: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

interface SerpApiResult {
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiResult[];
  answer_box?: { snippet?: string; answer?: string };
}

export const webSearchTool: ToolDefinition<typeof webSearchSchema> = {
  name: 'web_search',
  description:
    'Search the web for documentation, examples, current news, or factual information. ' +
    'Use this when you need to verify a library API, find usage examples, check the latest ' +
    'syntax, or look up any fact you are not 100% sure about. ' +
    'Returns: an optional synthesized answer plus a list of results with title, URL, and snippet. ' +
    'Do NOT use this for content the user already provided, or for URLs the user already gave ' +
    '(use read_url or scrape_page for those).',

  inputSchema: webSearchSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: WebSearchInput, ctx): Promise<ToolResult> => {
    const { query, maxResults = 5, includeAnswer = true } = input;
    const apiKey = ctx.searchApiKey;

    if (!apiKey) {
      return {
        ok: false,
        error: 'Web search is not configured. Set TAVILY_API_KEY or SERPAPI_KEY in the environment.',
        hint: 'Tavily offers a free tier (1000 searches/month). Get a key at https://tavily.com',
      };
    }

    // Detect provider by key prefix — Tavily keys start with "tvly-".
    const isTavily = apiKey.startsWith('tvly-') || !!process.env.TAVILY_API_KEY;

    try {
      if (isTavily) {
        const resp = await fetchWithTimeout('https://api.tavily.com/search', {
          method: 'POST',
          timeoutMs: 12000,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: maxResults,
            include_answer: includeAnswer,
            search_depth: 'advanced',
          }),
        });

        if (!resp.ok) {
          return {
            ok: false,
            error: `Tavily search failed: HTTP ${resp.status} ${resp.statusText}`,
          };
        }

        const data = (await resp.json()) as TavilyResponse;

        return {
          ok: true,
          provider: 'tavily',
          query,
          answer: data.answer ?? null,
          results: (data.results ?? []).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content?.slice(0, 400) ?? '',
          })),
          totalResults: data.results?.length ?? 0,
        };
      }

      // SerpApi fallback
      const serpResp = await fetchWithTimeout('https://serpapi.com/search.json', {
        timeoutMs: 12000,
        headers: { 'Content-Type': 'application/json' },
      });

      // SerpApi uses query params, not POST body
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('num', String(maxResults));

      const resp2 = await fetchWithTimeout(url.toString(), {
        timeoutMs: 12000,
        headers: { 'Content-Type': 'application/json' },
      });

      void serpResp; // unused, kept for clarity

      if (!resp2.ok) {
        return {
          ok: false,
          error: `SerpApi search failed: HTTP ${resp2.status} ${resp2.statusText}`,
        };
      }

      const data = (await resp2.json()) as SerpApiResponse;

      return {
        ok: true,
        provider: 'serpapi',
        query,
        answer: data.answer_box?.answer ?? data.answer_box?.snippet ?? null,
        results: (data.organic_results ?? []).slice(0, maxResults).map((r) => ({
          title: r.title ?? '(untitled)',
          url: r.link ?? '',
          snippet: r.snippet ?? '',
        })),
        totalResults: data.organic_results?.length ?? 0,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (err instanceof Error && err.name === 'AbortTimeoutError') {
        return {
          ok: false,
          error: 'Web search timed out (12s). The search provider may be slow — retry.',
        };
      }

      return {
        ok: false,
        error: `Web search failed: ${message}`,
      };
    }
  },
};
