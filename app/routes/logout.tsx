import { type ActionFunctionArgs, redirect } from '@remix-run/cloudflare';
import { getSupabaseServerClient } from '~/lib/auth/supabase.server';

export async function action({ request, context }: ActionFunctionArgs) {
  const { supabase, headers } = getSupabaseServerClient(request, context);
  await supabase.auth.signOut();

  /*
   * Send logged-out users straight to the marketing landing at "/", not the
   * auth page. The _index loader shows <Landing /> for unauthenticated
   * visitors, so they immediately see the product (with the prompt box) again.
   */
  return redirect('/', { headers });
}

export async function loader() {
  return redirect('/');
}
