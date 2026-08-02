/**
 * Memory Retriever — hybrid search for relevant facts.
 *
 * Combines:
 *   1. Vector similarity (pgvector) — semantic matching
 *   2. BM25 full-text search — exact keyword matching
 *
 * Returns top-K relevant facts for the current user message.
 * Injected as compact key=value format (~50 tokens).
 */

import { createScopedLogger } from '~/utils/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createScopedLogger('memory-retriever');

export interface RetrievedFact {
  key: string;
  value: string;
  mode: string;
  score: number;
}

/**
 * Generate an embedding for the query text using OpenAI's text-embedding-3-small.
 * Falls back to null if no API key is available (retrieval skips vector search).
 */
async function generateEmbedding(text: string, apiKeys: Record<string, string>): Promise<number[] | null> {
  const openrouterKey = apiKeys.OpenRouter || apiKeys.openrouter;

  if (!openrouterKey) {
    return null;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://palmkit.app',
        'X-Title': 'PalmKit Memory',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text.slice(0, 8000), // cap input length
      }),
      signal: (() => {
        const c = new AbortController();
        setTimeout(() => c.abort(), 8000);

        return c.signal;
      })(),
    });

    if (!response.ok) {
      logger.warn(`Embedding generation HTTP ${response.status}`);
      return null;
    }

    const data: any = await response.json();

    return data.data?.[0]?.embedding || null;
  } catch (err) {
    logger.warn(`Embedding generation failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Retrieve the user's persistent profile (Layer 1).
 * This is always injected in full — no search needed.
 */
export async function getUserProfile(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data, error } = await supabase.from('user_memory').select('content').eq('user_id', userId).maybeSingle();

    if (error) {
      logger.warn(`Failed to fetch user profile: ${error.message}`);
      return '';
    }

    return data?.content || '';
  } catch (err) {
    logger.warn(`Profile fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * Retrieve relevant facts (Layer 3) using hybrid search.
 *
 * @param supabase - Supabase client with service role or user JWT
 * @param userId - User ID
 * @param query - The user's current message (for relevance matching)
 * @param apiKeys - API keys for embedding generation
 * @param limit - Max facts to return (default 5)
 * @param mode - Optional mode filter (chat/work/code)
 * @returns Array of relevant facts
 */
export async function retrieveRelevantFacts(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  apiKeys: Record<string, string>,
  limit: number = 5,
  mode?: string,
  scope?: { folderId?: string; projectOnly: boolean },
): Promise<RetrievedFact[]> {
  // Generate embedding for the query
  const embedding = await generateEmbedding(query, apiKeys);

  if (!embedding) {
    // Fallback: BM25-only search (no vector)
    return retrieveFactsBM25(supabase, userId, query, limit, mode);
  }

  try {
    // Call the hybrid search RPC
    /*
     * The scoped RPC ships in migration 0016. On a database that has not run
     * it, fall back to the original — facts are then unscoped, but the
     * profile (the layer that actually reaches the model) is still scoped by
     * readScopedProfile, so Project-only never leaks the real memory.
     */
    let { data, error } = await supabase.rpc('search_memory_facts_scoped', {
      p_user_id: userId,
      p_query: query,
      p_query_embedding: embedding,
      p_limit: limit,
      p_mode: mode || null,
      p_folder_id: scope?.folderId ?? null,
      p_project_only: scope?.projectOnly ?? false,
    });

    if (error) {
      ({ data, error } = await supabase.rpc('search_memory_facts', {
        p_user_id: userId,
        p_query: query,
        p_query_embedding: embedding,
        p_limit: limit,
        p_mode: mode || null,
      }));
    }

    if (error) {
      logger.warn(`Hybrid search failed: ${error.message}`);
      return retrieveFactsBM25(supabase, userId, query, limit, mode);
    }

    if (!data || data.length === 0) {
      return [];
    }

    return data.map((row: any) => ({
      key: row.fact_key,
      value: row.fact_value,
      mode: row.mode,
      score: row.combined_score,
    }));
  } catch (err) {
    logger.warn(`Hybrid search error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Fallback: BM25-only search (no vector embeddings).
 */
async function retrieveFactsBM25(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  limit: number,
  mode?: string,
): Promise<RetrievedFact[]> {
  try {
    let q = supabase
      .from('memory_facts')
      .select('fact_key, fact_value, mode')
      .eq('user_id', userId)
      .textSearch('fts', query, { type: 'websearch' })
      .limit(limit);

    if (mode) {
      q = q.eq('mode', mode);
    }

    const { data, error } = await q;

    if (error || !data) {
      return [];
    }

    return data.map((row: any) => ({
      key: row.fact_key,
      value: row.fact_value,
      mode: row.mode,
      score: 0.5, // BM25 score (not computed here)
    }));
  } catch {
    return [];
  }
}

/**
 * Format facts for injection into the system prompt.
 * Compact key=value format (~10 tokens per fact).
 *
 * Example output:
 *   project.name=BrewHive
 *   project.stack=React+Vite+Tailwind
 *   user.prefers=Arabic
 */
export function formatFactsForInjection(facts: RetrievedFact[]): string {
  if (facts.length === 0) {
    return '';
  }

  return facts.map((f) => `${f.key}=${f.value}`).join('\n');
}

/**
 * Build the complete memory block for system prompt injection.
 *
 * Format (~80-100 tokens total):
 *   <user_profile>
 *   User prefers Arabic responses.
 *   Building BrewHive, a coffee shop website.
 *   </user_profile>
 *
 *   <relevant_facts>
 *   project.name=BrewHive
 *   project.stack=React+Vite+Tailwind
 *   </relevant_facts>
 */
export function buildMemoryBlock(profile: string, facts: string): string {
  const parts: string[] = [];

  if (profile) {
    parts.push(`<user_profile>\n${profile}\n</user_profile>`);
  }

  if (facts) {
    parts.push(`<relevant_facts>\n${facts}\n</relevant_facts>`);
  }

  return parts.length > 0 ? parts.join('\n\n') : '';
}
