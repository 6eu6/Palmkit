/**
 * /chat — Chat mode entry point.
 *
 * Sets sidebar mode to 'chat' and renders the chat interface.
 * URL: palmkit.app/chat
 *
 * Chat mode = general Q&A, no file generation, no preview.
 * Tools: web_search, read_url only.
 *
 * NOTE: <Header /> and <Chat /> are rendered by the parent _app.tsx layout
 * route, so they stay mounted across tab switches (no flicker). This route
 * only handles the auth check + loader.
 */

import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Palmkit Chat — Ask anything' },
    { name: 'description', content: 'General chat — ask questions, analyze links, get explanations.' },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  if (authEnabled) {
    const { user, headers } = await getAuthedUser(request, context);
    return json({ authed: Boolean(user), mode: 'chat' as const }, { headers });
  }

  return json({ authed: true, mode: 'chat' as const });
}

export default function ChatRoute() {
  const { authed } = useLoaderData<typeof loader>();

  if (!authed) {
    window.location.href = '/';
    return null;
  }

  /*
   * <Header /> and <Chat /> are rendered by _app.tsx (layout route).
   * This route returns null — the layout's <Outlet /> is just a placeholder.
   * This prevents <Header /> and <ClientOnly> from remounting on tab switch.
   */
  return null;
}
