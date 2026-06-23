/**
 * Key Fetcher — retrieves + decrypts the user's API key from Supabase.
 *
 * The CF Pages app stores per-user API keys in `user_api_keys` (encrypted
 * with AES-GCM, keyed by API_KEY_ENCRYPTION_KEY). This module reads the
 * encrypted key for the job's user_id and decrypts it.
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
 * @returns The decrypted API key, or null if not found / decryption failed.
 */
export async function getUserApiKey(
  supabase: SupabaseClient,
  userId: string,
  _provider: string,
): Promise<string | null> {
  const masterKey = process.env.API_KEY_ENCRYPTION_KEY;

  if (!masterKey) {
    logger.error('API_KEY_ENCRYPTION_KEY env var missing — cannot decrypt user API keys.');
    return null;
  }

  // user_api_keys schema: user_id, provider, encrypted_key
  // (one row per user — see api.account.api-key.ts)
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('provider, encrypted_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error(`Failed to fetch API key for user ${userId}:`, error.message);
    return null;
  }

  if (!data || !data.encrypted_key) {
    logger.warn(`No API key stored for user ${userId}.`);
    return null;
  }

  try {
    const decrypted = await decryptSecret(data.encrypted_key, masterKey);
    logger.info(`Decrypted API key for user ${userId} (provider: ${data.provider}).`);
    return decrypted;
  } catch (decryptError: any) {
    logger.error(`Failed to decrypt API key for user ${userId}:`, decryptError.message);
    return null;
  }
}
