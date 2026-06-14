import { atom } from 'nanostores';

/**
 * Mobile shell active tab state.
 *
 * Why a separate atom instead of deriving from chatStore/workbenchStore?
 * - The desktop layout and mobile shell share the same store instances.
 * - We need a mobile-specific "which tab is highlighted" state that
 *   is independent of the desktop showChat/showWorkbench toggles.
 * - On mobile, the active tab drives the store values (chat hidden/shown,
 *   workbench view changed). On desktop, the stores drive the layout.
 * - This atom has no effect on desktop because the MobileBottomTabs
 *   component is hidden via CSS (sm:hidden).
 */
export type MobileTab = 'chat' | 'preview' | 'files' | 'actions' | 'projects' | 'settings';

export const mobileActiveTab = atom<MobileTab>('chat');
