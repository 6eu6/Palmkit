/**
 * Pathless layout route — wraps all /chat, /work, /code routes.
 *
 * ROOT FIX for "page flickers / reloads when switching tabs":
 * Previously each route (chat.tsx, work.tsx, code.tsx) rendered its own
 * <Header /> + <ClientOnly>{() => <Chat />}</ClientOnly>. When the user
 * switched tabs, Remix unmounted the old route and mounted the new one —
 * causing <Header /> and <ClientOnly> to remount, which produced the
 * "white flash" / flicker.
 *
 * By moving <Header /> and <ClientOnly> into this pathless layout route,
 * they stay mounted across tab switches. Only the inner <Chat> component
 * (which has a `key` based on the URL) remounts — and even that is
 * intentional, since each tab needs its own chat state.
 *
 * The <Outlet /> renders the matched child route (chat.tsx, work.tsx,
 * code.tsx) which now returns null (the layout handles all rendering).
 */

import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Outlet, useLoaderData } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

/*
 * Layout loader — runs for ALL /chat, /work, /code routes (and their $id
 * children). Returns the same shape as the child loaders so that
 * useLoaderData() in useChatHistory (which destructures `id`) works
 * correctly whether the URL is /chat or /chat/<id>.
 *
 * Without this loader, useLoaderData() returns null in the layout context,
 * and `const { id } = useLoaderData()` throws "Cannot destructure property
 * 'id' of null".
 */
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  let authed = true;
  let headers = new Headers();

  if (authEnabled) {
    const { user, headers: h } = await getAuthedUser(request, context);
    headers = h;
    authed = Boolean(user);
  }

  /*
   * `id` comes from the child route's params (e.g. /chat/:id → id is set).
   * For /chat (no id), params.id is undefined — which is correct.
   */
  return json({ id: params.id ?? undefined, authed }, { headers });
}

export default function AppLayout() {
  // Consume the loader data so it's available to the layout's children
  // (Header, Chat) via useLoaderData() in their own hooks.
  useLoaderData<typeof loader>();

  return (
    <div className="relative flex flex-col h-full w-full bg-palmkit-elements-background-depth-1">
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      <Outlet />
    </div>
  );
}
