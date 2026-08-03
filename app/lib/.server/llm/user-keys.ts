import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret } from '~/lib/auth/crypto.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('user-keys');

/**
 * The user's provider keys — read here, used here, never sent anywhere.
 *
 * One place, because four routes were each doing their own version of "find
 * the key, decrypt it", and a fifth was handing the decrypted key back to the
 * browser. A key that never leaves the server cannot be read out of a network
 * log, an XSS payload, or a browser extension; `key_hint` gives the UI the
 * last four characters it actually needs, and nothing more.
 */

export interface StoredProviderKey {
  provider: string;
  isActive: boolean;
  hint?: string;
  updatedAt?: string;
}

interface Row {
  provider: string;
  encrypted_key: string;
  is_active?: boolean;
  key_hint?: string | null;
  updated_at?: string;
}

/**
 * Every provider the user has connected, without any secret in the result.
 *
 * Safe to hand to a route that will serialise it: there is nothing here a
 * client should not see.
 */
export async function listProviderKeys(supabase: SupabaseClient, userId: string): Promise<StoredProviderKey[]> {
  const { data, error } = await supabase
    .from('user_api_keys')
    .select('provider, is_active, key_hint, updated_at')
    .eq('user_id', userId);

  if (error) {
    /*
     * Before migration 0020 the extra columns do not exist and this select
     * fails wholesale. Fall back to the shape that has always been there, so
     * a database that is merely behind still reports the connected provider.
     */
    const legacy = await supabase.from('user_api_keys').select('provider, updated_at').eq('user_id', userId);

    if (legacy.error) {
      logger.warn(`Could not list provider keys: ${legacy.error.message}`);
      return [];
    }

    return (legacy.data ?? []).map((r) => ({
      provider: (r as Row).provider,
      isActive: true,
      updatedAt: (r as Row).updated_at,
    }));
  }

  return (data ?? []).map((r) => ({
    provider: (r as Row).provider,
    isActive: (r as Row).is_active ?? true,
    hint: (r as Row).key_hint ?? undefined,
    updatedAt: (r as Row).updated_at,
  }));
}

/**
 * Decrypt one provider's key. Server only.
 *
 * `provider` omitted means "whichever one is active" — the key a chat request
 * should be made with.
 */
export async function readProviderKey(
  supabase: SupabaseClient,
  userId: string,
  masterKey: string | undefined,
  provider?: string,
): Promise<{ provider: string; key: string } | undefined> {
  if (!masterKey) {
    return undefined;
  }

  try {
    let query = supabase.from('user_api_keys').select('provider, encrypted_key, is_active').eq('user_id', userId);

    query = provider ? query.eq('provider', provider) : query.eq('is_active', true);

    const { data, error } = await query.limit(1);

    const row = (
      error
        ? /* Pre-0020: no is_active column, and only one row can exist anyway. */
          (await supabase.from('user_api_keys').select('provider, encrypted_key').eq('user_id', userId).limit(1)).data
        : data
    )?.[0] as Row | undefined;

    if (!row?.encrypted_key) {
      return undefined;
    }

    if (provider && row.provider !== provider) {
      return undefined;
    }

    return { provider: row.provider, key: await decryptSecret(row.encrypted_key, masterKey) };
  } catch (err) {
    logger.warn(`Could not read provider key: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** The last four characters, which is all the UI needs to tell keys apart. */
export function keyHint(apiKey: string): string {
  return apiKey.slice(-4);
}
