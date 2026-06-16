import { type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction, json, redirect } from '@remix-run/cloudflare';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { AuthButton, AuthInput, AuthLayout } from '~/components/auth/AuthLayout';
import { getAuthedUser, getSupabaseServerClient } from '~/lib/auth/supabase.server';

type ForgotPasswordActionData =
  | { error: string }
  | { sent: true; email: string };

export const meta: MetaFunction = () => [{ title: 'Reset password — Palmkit' }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, headers } = await getAuthedUser(request, context);

  if (user) {
    return redirect('/', { headers });
  }

  return new Response(null, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim();
  const { supabase, headers } = getSupabaseServerClient(request, context);
  const origin = new URL(request.url).origin;

  if (!email) {
    return json({ error: 'Enter your email address.' } satisfies ForgotPasswordActionData, { status: 400, headers });
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) {
    return json({ error: error.message } satisfies ForgotPasswordActionData, { status: 400, headers });
  }

  return json({ sent: true, email } satisfies ForgotPasswordActionData, { headers });
}

export default function ForgotPassword() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  if (actionData && 'sent' in actionData) {
    return (
      <AuthLayout title="Check your inbox" subtitle="We sent you a reset link.">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <span className="i-ph:envelope-simple-open text-3xl" style={{ color: '#5eead4' }} />
          <p className="text-sm text-bolt-elements-textSecondary">
            If an account exists for <span className="text-bolt-elements-textPrimary">{actionData.email}</span>, a link
            to reset your password is on its way.
          </p>
          <Link to="/login" className="text-xs underline" style={{ color: '#5eead4' }}>
            Back to log in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot password?" subtitle="Enter your email and we'll send a reset link.">
      <Form method="post" className="flex flex-col gap-3">
        <AuthInput
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />

        {'error' in (actionData ?? {}) && actionData?.error ? (
          <p className="text-xs text-red-400">{actionData.error}</p>
        ) : null}

        <AuthButton disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</AuthButton>
      </Form>

      <p className="mt-4 text-center text-xs text-bolt-elements-textSecondary">
        Remembered it?{' '}
        <Link to="/login" className="underline" style={{ color: '#5eead4' }}>
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
