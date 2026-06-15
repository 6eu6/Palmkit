import { type ActionFunctionArgs, redirect } from '@remix-run/cloudflare';
import { getSupabaseServerClient } from '~/lib/auth/supabase.server';

export async function action({ request, context }: ActionFunctionArgs) {
  const { supabase, headers } = getSupabaseServerClient(request, context);
  await supabase.auth.signOut();

  return redirect('/login', { headers });
}

export async function loader() {
  return redirect('/');
}
