/**
 * / — Root route.
 *
 * - Logged OUT: shows marketing landing page.
 * - Logged IN: redirects to /chat (default tab).
 *
 * The redirect happens server-side in the loader for instant navigation
 * (no flash of the chat UI before redirect).
 */

import { json, redirect, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { Landing } from '~/components/landing/Landing';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Palmkit — build web apps from your phone' },
    {
      name: 'description',
      content: 'Palmkit — build, preview and export AI-generated web apps right from your phone.',
    },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  if (authEnabled) {
    const { user, headers } = await getAuthedUser(request, context);

    // Logged IN → redirect to /chat immediately (server-side, no flash)
    if (user) {
      return redirect('/chat', { headers });
    }

    // Logged OUT → show landing page
    return json({ authed: false }, { headers });
  }

  // No auth configured → redirect to /chat
  return redirect('/chat');
}

export default function Index() {
  const { authed } = useLoaderData<typeof loader>();

  if (!authed) {
    return <Landing />;
  }

  /*
   * This should never render — the loader redirects logged-in users.
   * But just in case, show the landing.
   */
  return <Landing />;
}
