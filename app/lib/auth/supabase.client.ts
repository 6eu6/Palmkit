import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase browser client. Safe to call from any
 * client-side component. Requires `supabaseUrl` and `supabaseAnonKey`
 * (passed through the root loader).
 */
export function getSupabaseBrowserClient(url: string, anonKey: string): SupabaseClient {
  if (_client) {
    return _client;
  }

  _client = createBrowserClient(url, anonKey, {
    cookies: {
      getAll() {
        return document.cookie.split(';').map((c) => {
          const [name, ...rest] = c.trim().split('=');
          return { name, value: rest.join('=') };
        });
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          let cookie = `${name}=${value}`;

          if (options.maxAge) {
            cookie += `; Max-Age=${options.maxAge}`;
          }

          if (options.path) {
            cookie += `; Path=${options.path}`;
          }

          if (options.domain) {
            cookie += `; Domain=${options.domain}`;
          }

          if (options.sameSite) {
            cookie += `; SameSite=${options.sameSite}`;
          }

          if (options.secure) {
            cookie += '; Secure';
          }

          document.cookie = cookie;
        });
      },
    },
  });

  return _client;
}
