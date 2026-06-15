import { type LoaderFunctionArgs, redirect } from '@remix-run/cloudflare';
import { getSupabaseServerClient } from '~/lib/auth/supabase.server';

/**
 * OAuth / email-confirmation callback. Supabase redirects here with a `code`
 * that we exchange for a session, persisting it via cookies before redirecting
 * the user into the app.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/';

  if (!code) {
    return redirect('/login?error=missing_code');
  }

  const { supabase, headers } = getSupabaseServerClient(request, context);
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`, { headers });
  }

  return redirect(next, { headers });
}
