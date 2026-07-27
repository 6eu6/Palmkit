import { type ActionFunctionArgs, json, redirect } from '@remix-run/cloudflare';
import { getSupabaseServerClient } from '~/lib/auth/supabase.server';

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const { supabase, headers } = getSupabaseServerClient(request, context);
  const redirectTo = String(formData.get('redirectTo') || '/');

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return json({ error: 'Email and password are required.' }, { status: 400, headers });
  }

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return json({ error: error.message }, { status: 400, headers });
  }

  return redirect(redirectTo, { headers });
}
