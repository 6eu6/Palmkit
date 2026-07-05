import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { toggleSidebar } from '~/lib/stores/sidebar';

/*
 * Design v3 — the header bar is gone. What remains is a transparent overlay
 * strip carrying only a glassy iOS-style hamburger (top-left) and, once a build
 * exists, the workbench actions (top-right). The logo, chat title, Builds link
 * and account menu all live in the sidebar now — nothing chromes the top of the
 * canvas, so the content reads as one clean surface.
 */
const glassButton =
  'pointer-events-auto items-center justify-center h-9 w-9 rounded-xl border border-[var(--pk-glass-border)] ' +
  'bg-[var(--pk-glass-bg)] backdrop-blur-xl backdrop-saturate-150 text-palmkit-elements-textSecondary ' +
  'hover:text-palmkit-elements-textPrimary hover:bg-[var(--pk-glass-bg-hi)] hover:border-[var(--pk-glass-border-hi)] ' +
  'active:scale-95 transition-all shadow-sm';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-logo flex items-start justify-between p-3 sm:p-4">
      {/* glassy hamburger — opens the projects drawer on mobile, toggles the sidebar on desktop.
          Exactly one is shown per breakpoint; the display class must NOT collide with a base
          `flex`, so the base has none and each button sets its own. */}
      <button
        onClick={() => mobileActiveTab.set('projects')}
        className={`${glassButton} flex sm:hidden`}
        aria-label="Menu"
      >
        <div className="i-ph:list text-lg" />
      </button>
      <button onClick={() => toggleSidebar()} className={`${glassButton} hidden sm:flex`} aria-label="Toggle sidebar">
        <div className="i-ph:sidebar-simple text-lg" />
      </button>

      {chat.started && (
        <ClientOnly>
          {() => (
            <div className="pointer-events-auto flex-shrink-0">
              <HeaderActionButtons chatStarted={chat.started} />
            </div>
          )}
        </ClientOnly>
      )}
    </div>
  );
}
