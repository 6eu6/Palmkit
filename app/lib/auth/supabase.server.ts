import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppLoadContext } from '@remix-run/cloudflare';

/**
 * Reads the runtime environment from the Cloudflare load context. On Cloudflare
 * Pages, secrets/vars live on `context.cloudflare.env`.
 */
export function getEnv(context: AppLoadContext): Record<string, string | undefined> {
  return (context as unknown as { cloudflare?: { env?: Record<string, string | undefined> } }).cloudflare?.env ?? {};
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
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY as Cloudflare Pages environment variables.',
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

/** Returns the authenticated user (verified against Supabase) or null. */
export async function getAuthedUser(request: Request, context: AppLoadContext) {
  const env = getEnv(context);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { user: null, supabase: null, headers: new Headers() };
  }

  const { supabase, headers } = getSupabaseServerClient(request, context);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, supabase, headers };
}
