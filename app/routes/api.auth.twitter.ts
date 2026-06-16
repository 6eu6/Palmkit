import { type LoaderFunctionArgs, redirect } from '@remix-run/cloudflare';
import { getSupabaseServerClient } from '~/lib/auth/supabase.server';

/**
 * Dedicated OAuth entry point for Twitter/X.
 * Visiting /api/auth/twitter redirects the browser to X's OAuth consent
 * screen. No client-side JS or form submission required — works with a plain
 * <a href="/api/auth/twitter"> link.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { supabase, headers } = getSupabaseServerClient(request, context);
  const origin = new URL(request.url).origin;

  const redirectTo = new URL(request.url).searchParams.get('redirectTo') ?? '/';
  const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'twitter',
    options: { redirectTo: callbackUrl },
  });

  if (error || !data.url) {
    const msg = error?.message ?? 'Could not start X sign-in.';
    return redirect(`/login?error=${encodeURIComponent(msg)}`, { headers });
  }

  return redirect(data.url, { headers });
}
