/**
 * /chat — Chat mode entry point.
 *
 * Sets sidebar mode to 'chat' and renders the chat interface.
 * URL: palmkit.app/chat
 *
 * Chat mode = general Q&A, no file generation, no preview.
 * Tools: web_search, read_url only.
 */

import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
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
    // Redirect to landing if not logged in
    window.location.href = '/';
    return null;
  }

  return (
    <div className="relative flex flex-col h-full w-full bg-palmkit-elements-background-depth-1">
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
