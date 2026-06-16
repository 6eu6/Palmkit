import { type LoaderFunctionArgs, redirect } from '@remix-run/cloudflare';
import { getSupabaseServerClient } from '~/lib/auth/supabase.server';

/**
 * Dedicated OAuth entry point for GitHub.
 * Visiting /api/auth/github redirects the browser to GitHub's OAuth consent
 * screen. No client-side JS or form submission required — works with a plain
 * <a href="/api/auth/github"> link.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { supabase, headers } = getSupabaseServerClient(request, context);
  const origin = new URL(request.url).origin;

  const redirectTo = new URL(request.url).searchParams.get('redirectTo') ?? '/';
  const callbackUrl = `${origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: callbackUrl },
  });

  if (error || !data.url) {
    const msg = error?.message ?? 'Could not start GitHub sign-in.';
    return redirect(`/login?error=${encodeURIComponent(msg)}`, { headers });
  }

  return redirect(data.url, { headers });
}
