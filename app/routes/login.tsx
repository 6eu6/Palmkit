import { type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction, json, redirect } from '@remix-run/cloudflare';
import { Form, Link, useActionData, useRouteLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { AuthButton, AuthInput, AuthLayout } from '~/components/auth/AuthLayout';
import { getAuthedUser, getSupabaseServerClient } from '~/lib/auth/supabase.server';
import { getSupabaseBrowserClient } from '~/lib/auth/supabase.client';
import { useCallback, useState } from 'react';

type LoginActionData = { error: string };

export const meta: MetaFunction = () => [{ title: 'Log in — Palmkit' }];

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
  const redirectTo = String(formData.get('redirectTo') || '/');

  // OAuth is handled client-side now, but keep server-side fallback
  if (intent === 'github' || intent === 'twitter') {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: intent,
      options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(redirectTo)}` },
    });

    if (error || !data.url) {
      return json({ error: error?.message ?? 'Could not start sign-in.' } satisfies LoginActionData, { status: 400, headers });
    }

    return redirect(data.url, { headers });
  }

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return json({ error: 'Email and password are required.' } satisfies LoginActionData, { status: 400, headers });
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return json({ error: error.message } satisfies LoginActionData, { status: 400, headers });
  }

  return redirect(redirectTo, { headers });
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/';
  const busy = navigation.state !== 'idle';

  // Get Supabase credentials from root loader for client-side OAuth
  const rootData = useRouteLoaderData('root') as { supabaseUrl?: string | null; supabaseAnonKey?: string | null } | null;
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);

  // Check for URL error params (from OAuth callback failures)
  const urlError = searchParams.get('error');

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
        options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}` },
      });

      if (error) {
        setOauthLoading(null);
        return;
      }

      // Browser will redirect — no need to do anything else
    } catch {
      setOauthLoading(null);
    }
  }, [rootData?.supabaseUrl, rootData?.supabaseAnonKey, redirectTo]);

  const isOAuthBusy = oauthLoading !== null;

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to keep your projects and key in sync.">
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

      {/* Email/password form — stays as server-side Remix form for inline error display */}
      <Form method="post" className="flex flex-col gap-3">
        <input type="hidden" name="redirectTo" value={redirectTo} />

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
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />

        <Link
          to="/forgot-password"
          className="self-end -mt-1 text-xs text-bolt-elements-textSecondary hover:underline"
          style={{ color: '#5eead4' }}
        >
          Forgot password?
        </Link>

        {(actionData?.error || urlError) ? (
          <div
            className="flex items-start gap-2 p-3 rounded-xl text-xs"
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#fca5a5',
            }}
          >
            <span className="i-ph:warning-circle-fill text-sm mt-0.5 flex-shrink-0" />
            <span>{actionData?.error ?? urlError}</span>
          </div>
        ) : null}

        <AuthButton disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</AuthButton>
      </Form>

      <p className="mt-4 text-center text-xs text-bolt-elements-textSecondary">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="underline" style={{ color: '#5eead4' }}>
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}
