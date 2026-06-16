import { type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction, json, redirect } from '@remix-run/cloudflare';
import { Form, Link, useActionData, useRouteLoaderData, useNavigation } from '@remix-run/react';
import { AuthButton, AuthInput, AuthLayout } from '~/components/auth/AuthLayout';
import { getAuthedUser, getSupabaseServerClient } from '~/lib/auth/supabase.server';
import { getSupabaseBrowserClient } from '~/lib/auth/supabase.client';
import { useCallback, useState } from 'react';

type SignupActionData =
  | { error: string }
  | { confirm: true; email: string };

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

  // OAuth is handled client-side now, but keep server-side fallback
  if (intent === 'github' || intent === 'twitter') {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: intent,
      options: { redirectTo: `${origin}/auth/callback` },
    });

    if (error || !data.url) {
      return json({ error: error?.message ?? 'Could not start sign-in.' } satisfies SignupActionData, { status: 400, headers });
    }

    return redirect(data.url, { headers });
  }

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || password.length < 8) {
    return json(
      { error: 'Enter an email and a password of at least 8 characters.' } satisfies SignupActionData,
      { status: 400, headers },
    );
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    return json({ error: error.message } satisfies SignupActionData, { status: 400, headers });
  }

  // If email confirmation is enabled there is no session yet.
  if (!data.session) {
    return json({ confirm: true, email } satisfies SignupActionData, { headers });
  }

  return redirect('/', { headers });
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  // Get Supabase credentials from root loader for client-side OAuth
  const rootData = useRouteLoaderData('root') as { supabaseUrl?: string | null; supabaseAnonKey?: string | null } | null;
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  const handleOAuth = useCallback(async (provider: 'github' | 'twitter') => {
    const url = rootData?.supabaseUrl;
    const anonKey = rootData?.supabaseAnonKey;

    if (!url || !anonKey) {
      // Fallback: submit the form server-side
      return;
    }

    setOauthLoading(provider);

    try {
      const supabase = getSupabaseBrowserClient(url, anonKey);
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });

      if (error) {
        setOauthLoading(null);
        // If client-side fails, the form fallback will handle it
        return;
      }

      // Browser will redirect — no need to do anything else
    } catch {
      setOauthLoading(null);
    }
  }, [rootData?.supabaseUrl, rootData?.supabaseAnonKey]);

  if (actionData && 'confirm' in actionData) {
    return (
      <AuthLayout title="Check your inbox" subtitle="One more step to activate your account.">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <span className="i-ph:envelope-simple-open text-3xl" style={{ color: '#5eead4' }} />
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

  const isOAuthBusy = oauthLoading !== null;

  return (
    <AuthLayout title="Create your account" subtitle="Keep your projects and API key across devices.">
      {/* OAuth buttons — client-side redirect via Supabase browser SDK */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => handleOAuth('github')}
          disabled={busy || isOAuthBusy}
          className="w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-bg-depth-3 transition-colors disabled:opacity-60"
        >
          {oauthLoading === 'github' ? (
            <span className="i-ph:spinner-gap-bold text-lg animate-spin" />
          ) : (
            <span className="i-ph:github-logo-fill text-lg" />
          )}
          {oauthLoading === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
        </button>

        <button
          type="button"
          onClick={() => handleOAuth('twitter')}
          disabled={busy || isOAuthBusy}
          className="w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-bg-depth-3 transition-colors disabled:opacity-60"
        >
          {oauthLoading === 'twitter' ? (
            <span className="i-ph:spinner-gap-bold text-lg animate-spin" />
          ) : (
            <span className="i-ph:x-logo-fill text-lg" />
          )}
          {oauthLoading === 'twitter' ? 'Redirecting…' : 'Continue with X'}
        </button>
      </div>

      <div className="flex items-center gap-3 my-4">
        <div className="h-px flex-1 bg-bolt-elements-borderColor" />
        <span className="text-[11px] text-bolt-elements-textTertiary">or</span>
        <div className="h-px flex-1 bg-bolt-elements-borderColor" />
      </div>

      {/* Email/password form — server-side Remix form for inline errors */}
      <Form method="post" className="flex flex-col gap-3">
        <AuthInput
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
        <div>
          <AuthInput
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="At least 8 characters"
          />
          <p className="mt-1.5 text-[11px] text-bolt-elements-textTertiary leading-relaxed">
            Must include uppercase, lowercase, number, and special character.
          </p>
        </div>

        {'error' in (actionData ?? {}) && actionData?.error ? (
          <div
            className="flex items-start gap-2 p-3 rounded-xl text-xs"
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#fca5a5',
            }}
          >
            <span className="i-ph:warning-circle-fill text-sm mt-0.5 flex-shrink-0" />
            <span>{actionData.error}</span>
          </div>
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
