/**
 * Key Fetcher — retrieves + decrypts the user's API key from Supabase.
 *
 * The CF Pages app stores per-user API keys in `user_api_keys` (encrypted
 * with AES-GCM, keyed by API_KEY_ENCRYPTION_KEY). This module reads the
 * encrypted key for the job's user_id and provider, then decrypts it.
 *
 * SECURITY:
 *   - Uses Supabase service role key (bypasses RLS) — server only.
 *   - The decrypted key lives in memory only; never logged, never persisted.
 *   - The master key (API_KEY_ENCRYPTION_KEY) must be set on the worker.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret } from './crypto';
import { logger } from './logger';

/**
 * Fetch + decrypt the user's API key for the given provider.
 *
 * Tries exact provider match first. If not found, falls back to any stored key
 * (backwards-compatible with the single-key schema where provider is ignored).
 *
 * @returns The decrypted API key, or null if not found / decryption failed.
 */
export async function getUserApiKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
): Promise<string | null> {
  const masterKey = process.env.API_KEY_ENCRYPTION_KEY;

  if (!masterKey) {
    logger.error('API_KEY_ENCRYPTION_KEY env var missing — cannot decrypt user API keys.');
    return null;
  }

  // Try provider-specific key first.
  const { data: exactMatch, error: exactError } = await supabase
    .from('user_api_keys')
    .select('provider, encrypted_key')
    .eq('user_id', userId)
    .ilike('provider', provider)
    .maybeSingle();

  if (exactError) {
    logger.error(`Failed to fetch API key for user ${userId} (provider=${provider}):`, exactError.message);
    return null;
  }

  let row = exactMatch;

  // Fallback: if no provider-specific key, use any key the user has stored.
  if (!row) {
    const { data: anyKey, error: anyError } = await supabase
      .from('user_api_keys')
      .select('provider, encrypted_key')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (anyError) {
      logger.error(`Failed to fetch fallback API key for user ${userId}:`, anyError.message);
      return null;
    }

    row = anyKey;

    if (row) {
      logger.warn(
        `No key for provider "${provider}" for user ${userId}; using stored "${row.provider}" key as fallback.`,
      );
    }
  }

  if (!row || !row.encrypted_key) {
    logger.warn(`No API key stored for user ${userId} (provider: ${provider}).`);
    return null;
  }

  try {
    const decrypted = await decryptSecret(row.encrypted_key, masterKey);
    logger.info(`Decrypted API key for user ${userId} (provider: ${row.provider}).`);
    return decrypted;
  } catch (decryptError: any) {
    logger.error(`Failed to decrypt API key for user ${userId}:`, decryptError.message);
    return null;
  }
}
