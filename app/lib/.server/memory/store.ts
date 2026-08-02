/**
 * Memory Store — applies extraction operations to Supabase.
 *
 * Handles:
 *   - Reading current user profile (Layer 1)
 *   - Applying ADD/UPDATE/DELETE operations
 *   - Storing facts with embeddings (Layer 3)
 */

import { createScopedLogger } from '~/utils/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createScopedLogger('memory-store');

/**
 * Get the current user profile (Layer 1).
 */
export async function getProfile(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase.from('user_memory').select('content').eq('user_id', userId).maybeSingle();

  if (error) {
    logger.warn(`Failed to get profile: ${error.message}`);
    return '';
  }

  return data?.content || '';
}

/**
 * Save the user profile (Layer 1).
 * Uses upsert — creates if doesn't exist, updates if it does.
 */
export async function saveProfile(supabase: SupabaseClient, userId: string, content: string): Promise<void> {
  const lineCount = content.split('\n').filter((l) => l.trim()).length;

  const { error } = await supabase.from('user_memory').upsert({
    user_id: userId,
    content,
    line_count: lineCount,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    logger.warn(`Failed to save profile: ${error.message}`);
  }
}

/**
 * Generate embedding for a fact using OpenRouter.
 */
async function generateFactEmbedding(text: string, apiKeys: Record<string, string>): Promise<number[] | null> {
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
        input: text.slice(0, 8000),
      }),
      signal: (() => {
        const c = new AbortController();
        setTimeout(() => c.abort(), 8000);

        return c.signal;
      })(),
    });

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();

    return data.data?.[0]?.embedding || null;
  } catch {
    return null;
  }
}

/**
 * Store a fact in the memory_facts table (Layer 3).
 * Uses upsert — if the key already exists, it updates the value.
 */
export async function storeFact(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  value: string,
  mode: string,
  conversationId: string | undefined,
  apiKeys: Record<string, string>,
  folderId?: string,
): Promise<void> {
  // Generate embedding
  const embeddingText = `${key}=${value}`;
  const embedding = await generateFactEmbedding(embeddingText, apiKeys);

  const row = {
    user_id: userId,
    fact_key: key,
    fact_value: value,
    mode,
    conversation_id: conversationId,
    embedding,
    updated_at: new Date().toISOString(),
  };

  // folder_id ships in 0016; retry without it on a database that lacks it.
  let { error } = await supabase.from('memory_facts').upsert({ ...row, folder_id: folderId ?? null });

  if (error) {
    ({ error } = await supabase.from('memory_facts').upsert(row));
  }

  if (error) {
    logger.warn(`Failed to store fact ${key}: ${error.message}`);
  }
}

/**
 * Delete a fact by key.
 */
export async function deleteFact(supabase: SupabaseClient, userId: string, key: string): Promise<void> {
  const { error } = await supabase.from('memory_facts').delete().eq('user_id', userId).eq('fact_key', key);

  if (error) {
    logger.warn(`Failed to delete fact ${key}: ${error.message}`);
  }
}

/**
 * Extract key=value pairs from memory text lines.
 * Looks for patterns like "project.name=BrewHive" or "user.prefers=Arabic".
 */
export function extractFactsFromMemory(memoryText: string): Array<{ key: string; value: string }> {
  const lines = memoryText.split('\n').filter((l) => l.trim());
  const facts: Array<{ key: string; value: string }> = [];

  for (const line of lines) {
    // Match key=value pattern (entity.attribute=value)
    const match = line.match(/^([a-z_]+\.[a-z_]+)=(.+)$/i);

    if (match) {
      facts.push({ key: match[1], value: match[2] });
    }
  }

  return facts;
}
