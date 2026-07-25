import { type LoaderFunctionArgs, redirect, json } from '@remix-run/cloudflare';
import { getSupabaseServerClient, getEnv } from '~/lib/auth/supabase.server';

/**
 * Dedicated OAuth entry point for GitHub.
 * Visiting /api/auth/github redirects the browser to GitHub's OAuth consent
 * screen. No client-side JS or form submission required — works with a plain
 * <a href="/api/auth/github"> link.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = getEnv(context);
    const url = env.SUPABASE_URL;
    const anonKey = env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return json(
        {
          error: 'Supabase not configured',
          debug: {
            hasUrl: Boolean(url),
            hasAnonKey: Boolean(anonKey),
            urlPrefix: url ? url.substring(0, 20) + '...' : null,
          },
        },
        { status: 500 },
      );
    }

    const { supabase, headers } = getSupabaseServerClient(request, context);
    const origin = new URL(request.url).origin;

    const redirectTo = new URL(request.url).searchParams.get('redirectTo') ?? '/chat';
    const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: callbackUrl },
    });

    if (error || !data.url) {
      return json(
        {
          error: error?.message ?? 'Could not start GitHub sign-in.',
          debug: {
            hasData: Boolean(data),
            hasUrl: Boolean(data?.url),
            provider: 'github',
            callbackUrl,
            origin,
          },
        },
        { status: 500, headers },
      );
    }

    return redirect(data.url, { headers });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
      },
      { status: 500 },
    );
  }
}
