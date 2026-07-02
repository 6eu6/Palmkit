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
/*
 * The BOTTOM DOCK now shows only two primary destinations — `chat` and
 * `workspace` (the workbench: file / diff / preview / terminal, reached via the
 * workbench's own top slider). `preview` / `files` / `actions` are kept as
 * legacy sub-states some callers still set; they all highlight the Workspace
 * tab. `projects` / `settings` are opened as drawers from the header.
 */
export type MobileTab = 'chat' | 'workspace' | 'preview' | 'files' | 'actions' | 'projects' | 'settings';

/** Tabs that mean "the workbench is showing" — used to highlight the dock. */
export const WORKSPACE_TABS: MobileTab[] = ['workspace', 'preview', 'files', 'actions'];

export const mobileActiveTab = atom<MobileTab>('chat');
