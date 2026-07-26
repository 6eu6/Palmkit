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

import { Outlet } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';

export default function AppLayout() {
  return (
    <div className="relative flex flex-col h-full w-full bg-palmkit-elements-background-depth-1">
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      <Outlet />
    </div>
  );
}
