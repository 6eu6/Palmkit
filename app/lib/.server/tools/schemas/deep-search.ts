/**
 * Deep Search Schema
 * ------------------
 * Used by: deep_search tool (work mode only)
 *
 * Performs multi-query web search for comprehensive topic research.
 * Generates 3-5 query variations from different angles, runs them in
 * parallel, deduplicates results, and returns synthesized findings.
 *
 * Successor to the legacy deep_search tool. Improvements:
 *   - Better query generation (semantic angles, not just suffix variations)
 *   - Proper deduplication by URL (normalized)
 *   - Source diversity: limits 3 results per source domain
 *   - Returns structured "findings" array, not just a flat list
 */
import { z } from 'zod';

export const deepSearchSchema = z.object({
  topic: z
    .string()
    .min(2)
    .max(300)
    .describe('The topic to research. Be specific: "React 19 useTransition hook" is better than "React hooks".'),
  depth: z
    .enum(['quick', 'standard', 'thorough'])
    .optional()
    .describe(
      'Search depth. "quick" = 2 queries, "standard" = 3 queries (default), "thorough" = 5 queries. ' +
        'Use "thorough" only for complex research topics.',
    ),
  maxResultsPerQuery: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Max results per query (default 3). Total results capped at 15 across all queries.'),
});

export type DeepSearchInput = z.infer<typeof deepSearchSchema>;

export interface DeepSearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
  query: string;
}

export interface DeepSearchSuccess {
  ok: true;
  topic: string;
  depth: 'quick' | 'standard' | 'thorough';
  queriesUsed: string[];
  totalResults: number;
  results: DeepSearchResult[];
  findings: string[];
  searchedAt: string;
  [key: string]: unknown;
}
