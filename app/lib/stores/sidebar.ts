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

/** Keep the CSS layout variable in sync with the store (and viewport size). */
export function syncSidebarLayoutVar() {
  if (typeof document === 'undefined') {
    return;
  }

  const isDesktop = window.innerWidth >= 640;
  const open = sidebarOpenStore.get();
  document.documentElement.style.setProperty('--sidebar-width', open && isDesktop ? '340px' : '0px');
}
