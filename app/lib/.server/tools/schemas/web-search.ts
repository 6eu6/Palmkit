/**
 * Web Search Schema
 * -----------------
 * Used by: web_search tool (chat, work, code modes)
 */
import { z } from 'zod';

export const webSearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe('The search query. Be specific — "react-query useQuery invalidation" is better than "react query".'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Maximum number of results to return (default 5, max 20).'),
  includeAnswer: z
    .boolean()
    .optional()
    .describe('If true, ask the search provider to also return a synthesized answer (default true).'),
});

export type WebSearchInput = z.infer<typeof webSearchSchema>;
