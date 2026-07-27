import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppLoadContext } from '@remix-run/cloudflare';

/**
 * Reads the runtime environment from the Cloudflare load context. On Cloudflare
 * Pages, secrets/vars live on `context.cloudflare.env`.
 *
 * Falls back to `process.env` and `VITE_`-prefixed variants for compatibility:
 *   1. context.cloudflare.env.SUPABASE_URL  (Cloudflare Pages dashboard — recommended)
 *   2. process.env.SUPABASE_URL              (local dev via dotenv / .env.local)
 *   3. context.cloudflare.env.VITE_SUPABASE_URL  (fallback: some setups use VITE_ prefix)
 *   4. process.env.VITE_SUPABASE_URL             (fallback: Vite embeds these at build time)
 */
export function getEnv(context: AppLoadContext): Record<string, string | undefined> {
  const cloudflareEnv =
    (context as unknown as { cloudflare?: { env?: Record<string, string | undefined> } }).cloudflare?.env ?? {};

  // Resolve each key with a cascade of fallbacks
  const resolve = (key: string, viteKey: string): string | undefined => {
    return cloudflareEnv[key] ?? process.env[key] ?? cloudflareEnv[viteKey] ?? process.env[viteKey] ?? undefined;
  };

  return {
    SUPABASE_URL: resolve('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    SUPABASE_ANON_KEY: resolve('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'),
    API_KEY_ENCRYPTION_KEY: resolve('API_KEY_ENCRYPTION_KEY', 'VITE_API_KEY_ENCRYPTION_KEY'),
    ...cloudflareEnv, // keep any other Cloudflare vars
  };
}

export interface SupabaseServer {
  supabase: SupabaseClient;

  /** Set-Cookie headers that MUST be attached to the response for auth to persist. */
  headers: Headers;
}

/**
 * Creates a request-scoped Supabase client that reads the session from the
 * request cookies and records any session cookies that need to be written back
 * on the response. Always merge `headers` into your loader/action Response.
 */
export function getSupabaseServerClient(request: Request, context: AppLoadContext): SupabaseServer {
  const env = getEnv(context);
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY (or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) as Cloudflare Pages environment variables or in .env.local.',
    );
  }

  const headers = new Headers();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          headers.append('Set-Cookie', serializeCookieHeader(name, value, options));
        });
      },
    },
  });

  return { supabase, headers };
}

/**
 * Returns the authenticated user or null.
 *
 * Uses getSession() to read the JWT from cookies without a network call to
 * Supabase's auth server. This eliminates the 300-500ms round-trip on every
 * page load. The JWT is cryptographically signed by Supabase and expires in
 * 1 hour; all DB queries are still protected by RLS on the JWT claims.
 */
export async function getAuthedUser(request: Request, context: AppLoadContext) {
  const env = getEnv(context);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { user: null, supabase: null, headers: new Headers() };
  }

  const { supabase, headers } = getSupabaseServerClient(request, context);

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { user: session?.user ?? null, supabase, headers };
}
