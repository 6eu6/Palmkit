import { atom } from 'nanostores';

/**
 * Desktop sidebar (chat history) visibility.
 *
 * The sidebar is a fixed 340px panel. When open on desktop it must PUSH the
 * chat + workbench layout (via the `--sidebar-width` CSS variable consumed in
 * variables.scss and BaseChat) — previously it overlapped the composer and the
 * workbench, hiding half the chat input under it.
 *
 * Default: open on desktop (sm+), closed on mobile (the hamburger opens the
 * ProjectSwitcherDrawer there instead).
 */
export const sidebarOpenStore = atom<boolean>(typeof window !== 'undefined' ? window.innerWidth >= 640 : false);

export function toggleSidebar(value?: boolean) {
  sidebarOpenStore.set(value ?? !sidebarOpenStore.get());
}

export type SidebarMode = 'chat' | 'work' | 'code';

/**
 * Which workspace the sidebar (and a new session) is scoped to.
 * - `code` — build apps / dev sessions (Palmkit's default and, for now, the
 *   only fully-wired flow).
 * - `chat` — plain conversation (no build/preview).
 * - `work` — tasks / scheduled runs.
 * The Chat/Work/Code segmented control at the top of the sidebar drives this;
 * it swaps the quick-action set and (once chats carry a mode) filters the list.
 */
function modeFromPath(): SidebarMode {
  if (typeof window === 'undefined') {
    return 'code';
  }

  const first = window.location.pathname.split('/')[1];

  return first === 'chat' || first === 'work' || first === 'code' ? first : 'code';
}

/*
 * Seeded from the URL rather than hardcoded to 'code'. The store is the single
 * input to the sidebar's mode filter AND (for brand-new chats) to the mode a
 * conversation is created with, so a first render that disagrees with the
 * address bar would show the wrong tab's history and could stamp a new chat
 * with the wrong tab.
 */
export const sidebarModeStore = atom<SidebarMode>(modeFromPath());

export function setSidebarMode(mode: SidebarMode) {
  sidebarModeStore.set(mode);
}

export interface SidebarQuickAction {
  label: string;
  icon: string;
  href?: string;
}

/**
 * Quick actions under the Chat/Work/Code control, one set per mode — shared by
 * the desktop sidebar and the mobile drawer so they stay identical. Items with
 * an `href` navigate; the rest are placeholders for later phases ("Soon").
 */
export const SIDEBAR_QUICK_ACTIONS: Record<SidebarMode, SidebarQuickAction[]> = {
  chat: [
    { label: 'Agents', icon: 'i-ph:robot' },
    { label: 'Context', icon: 'i-ph:squares-four' },
  ],
  work: [
    { label: 'Context', icon: 'i-ph:squares-four' },
    { label: 'Scheduled', icon: 'i-ph:clock' },
  ],
  code: [
    { label: 'Context', icon: 'i-ph:squares-four' },
    { label: 'My Builds', icon: 'i-ph:clock-counter-clockwise', href: '/builds' },
    { label: 'Extensions', icon: 'i-ph:puzzle-piece' },
  ],
};

/** Keep the CSS layout variable in sync with the store (and viewport size). */
export function syncSidebarLayoutVar() {
  if (typeof document === 'undefined') {
    return;
  }

  const isDesktop = window.innerWidth >= 640;
  const open = sidebarOpenStore.get();
  document.documentElement.style.setProperty('--sidebar-width', open && isDesktop ? '340px' : '0px');
}
