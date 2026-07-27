import { type ActionFunctionArgs, redirect } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';

/**
 * GDPR account deletion. Calls the SECURITY DEFINER `delete_current_user` RPC,
 * which removes the caller's auth.users row; ON DELETE CASCADE wipes their
 * profile, API key, and projects. Then signs out and redirects home.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }

  const { error } = await supabase.rpc('delete_current_user');

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  // Clear the (now-orphaned) session cookies.
  await supabase.auth.signOut().catch(() => undefined);

  return redirect('/?deleted=1', { headers });
}
