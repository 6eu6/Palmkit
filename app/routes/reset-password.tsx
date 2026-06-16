import { type ActionFunctionArgs, type LoaderFunctionArgs, type MetaFunction, json, redirect } from '@remix-run/cloudflare';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { AuthButton, AuthInput, AuthLayout } from '~/components/auth/AuthLayout';
import { getAuthedUser, getSupabaseServerClient } from '~/lib/auth/supabase.server';

type ResetPasswordActionData = { error: string };

export const meta: MetaFunction = () => [{ title: 'Set a new password — Palmkit' }];

/**
 * Arrived here from the reset email via /auth/callback (which exchanged the
 * recovery code for a session). If there's no session, the link expired.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, headers } = await getAuthedUser(request, context);

  if (!user) {
    return redirect('/forgot-password?expired=1', { headers });
  }

  return new Response(null, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const formData = await request.formData();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const { supabase, headers } = getSupabaseServerClient(request, context);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect('/forgot-password?expired=1', { headers });
  }

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters.' } satisfies ResetPasswordActionData, { status: 400, headers });
  }

  if (password !== confirm) {
    return json({ error: 'Passwords do not match.' } satisfies ResetPasswordActionData, { status: 400, headers });
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return json({ error: error.message } satisfies ResetPasswordActionData, { status: 400, headers });
  }

  return redirect('/?passwordReset=1', { headers });
}

export default function ResetPassword() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password for your account.">
      <Form method="post" className="flex flex-col gap-3">
        <AuthInput
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
        />
        <AuthInput
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Re-enter password"
        />

        {'error' in (actionData ?? {}) && actionData?.error ? <p className="text-xs text-red-400">{actionData.error}</p> : null}

        <AuthButton disabled={busy}>{busy ? 'Saving…' : 'Update password'}</AuthButton>
      </Form>

      <p className="mt-4 text-center text-xs text-palmkit-elements-textSecondary">
        <Link to="/login" className="underline" style={{ color: '#5eead4' }}>
          Back to log in
        </Link>
      </p>
    </AuthLayout>
  );
}
