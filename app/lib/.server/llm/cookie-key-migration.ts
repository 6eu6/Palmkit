import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptSecret } from '~/lib/auth/crypto.server';
import { createScopedLogger } from '~/utils/logger';
import { keyHint, listProviderKeys } from './user-keys';

const logger = createScopedLogger('cookie-key-migration');

/**
 * Retiring the `apiKeys` cookie.
 *
 * Keys used to live in a browser cookie, written by a field in the composer
 * and re-written on every page load by the root loader. They live in the
 * database now, encrypted, and nothing reads the cookie any more.
 *
 * A user who typed a key into that field and never opened settings has it
 * only in the cookie, though, and deleting it without looking would take
 * their key with it. So the cookie is read once, anything it holds that the
 * account does not already have is stored properly, and then it is expired.
 *
 * This file exists to be deleted. Once no browser can still be carrying the
 * cookie, the call in root.tsx and this module go together.
 */

/** The cookie's contents, or an empty object if it is absent or malformed. */
export function readApiKeysCookie(cookieHeader: string | null): Record<string, string> {
  const match = (cookieHeader || '').match(/(?:^|;\s*)apiKeys=([^;]*)/);

  if (!match) {
    return {};
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as Record<string, unknown>;
    const out: Record<string, string> = {};

    for (const [provider, key] of Object.entries(parsed)) {
      // `{"OpenRouter":""}` is what the old UI left behind on removal.
      if (typeof key === 'string' && key.trim()) {
        out[provider] = key.trim();
      }
    }

    return out;
  } catch {
    return {};
  }
}

/**
 * Store any cookie key the account does not already have.
 *
 * The account always wins: a key the user entered in settings is the one they
 * chose most recently, and a stale cookie must not overwrite it. Nothing here
 * changes which provider is active either — adopting an old key should not
 * silently redirect the user's requests to a different provider.
 */
export async function adoptCookieKeys(
  supabase: SupabaseClient,
  userId: string,
  masterKey: string,
  cookieKeys: Record<string, string>,
): Promise<void> {
  try {
    const existing = new Set((await listProviderKeys(supabase, userId)).map((k) => k.provider));
    const missing = Object.entries(cookieKeys).filter(([provider]) => !existing.has(provider));

    if (missing.length === 0) {
      return;
    }

    const rows = await Promise.all(
      missing.map(async ([provider, key], i) => ({
        user_id: userId,
        provider,
        encrypted_key: await encryptSecret(key, masterKey),

        /*
         * Active only if the account had nothing at all — otherwise the
         * partial unique index would reject a second active row, and rightly:
         * the user's existing choice stands.
         */
        is_active: existing.size === 0 && i === 0,
        key_hint: keyHint(key),
        updated_at: new Date().toISOString(),
      })),
    );

    const { error } = await supabase.from('user_api_keys').upsert(rows, { onConflict: 'user_id,provider' });

    if (error) {
      logger.warn(`Could not adopt cookie keys: ${error.message}`);
      return;
    }

    logger.info(`Adopted ${rows.length} key(s) from the apiKeys cookie`);
  } catch (err) {
    /*
     * Never fail the page over this. The worst case is a user re-entering a
     * key in settings, which is the same thing they would do if they had
     * cleared their cookies.
     */
    logger.warn(`Could not adopt cookie keys: ${err instanceof Error ? err.message : String(err)}`);
  }
}
