import { type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction, redirect } from '@remix-run/cloudflare';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { AuthButton, AuthInput, AuthLayout } from '~/components/auth/AuthLayout';
import { getAuthedUser, getSupabaseServerClient } from '~/lib/auth/supabase.server';

export const meta: MetaFunction = () => [{ title: 'Sign up — Palmkit' }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, headers } = await getAuthedUser(request, context);

  if (user) {
    return redirect('/', { headers });
  }

  return new Response(null, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? 'password');
  const { supabase, headers } = getSupabaseServerClient(request, context);
  const origin = new URL(request.url).origin;

  if (intent === 'github') {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${origin}/auth/callback` },
    });

    if (error || !data.url) {
      return Response.json({ error: error?.message ?? 'Could not start GitHub sign-in.' }, { status: 400, headers });
    }

    return redirect(data.url, { headers });
  }

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || password.length < 8) {
    return Response.json(
      { error: 'Enter an email and a password of at least 8 characters.' },
      { status: 400, headers },
    );
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400, headers });
  }

  // If email confirmation is enabled there is no session yet.
  if (!data.session) {
    return Response.json({ confirm: true, email }, { headers });
  }

  return redirect('/', { headers });
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  if (actionData && 'confirm' in actionData && actionData.confirm) {
    return (
      <AuthLayout title="Check your inbox" subtitle="One more step to activate your account.">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <span className="i-ph:envelope-simple-open text-3xl text-purple-400" />
          <p className="text-sm text-bolt-elements-textSecondary">
            We sent a confirmation link to <span className="text-bolt-elements-textPrimary">{actionData.email}</span>.
            Click it to finish creating your account.
          </p>
          <Link to="/login" className="text-xs underline" style={{ color: '#5eead4' }}>
            Back to log in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="Keep your projects and API key across devices.">
      <Form method="post" className="flex flex-col gap-3">
        <button
          type="submit"
          name="intent"
          value="github"
          disabled={busy}
          className="w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-bg-depth-3 transition-colors disabled:opacity-60"
        >
          <span className="i-ph:github-logo-fill text-lg" />
          Continue with GitHub
        </button>

        <div className="flex items-center gap-3 my-1">
          <div className="h-px flex-1 bg-bolt-elements-borderColor" />
          <span className="text-[11px] text-bolt-elements-textTertiary">or</span>
          <div className="h-px flex-1 bg-bolt-elements-borderColor" />
        </div>

        <AuthInput
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
        <AuthInput
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
        />

        {actionData && 'error' in actionData && actionData.error ? (
          <p className="text-xs text-red-400">{actionData.error}</p>
        ) : null}

        <AuthButton disabled={busy}>{busy ? 'Creating account…' : 'Sign up'}</AuthButton>
      </Form>

      <p className="mt-4 text-center text-xs text-bolt-elements-textSecondary">
        Already have an account?{' '}
        <Link to="/login" className="underline" style={{ color: '#5eead4' }}>
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
