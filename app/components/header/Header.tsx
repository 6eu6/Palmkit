import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { animateDrawer } from '~/lib/stores/drawerMotion';
import { toggleSidebar } from '~/lib/stores/sidebar';

/*
 * Design v3 — the header bar is gone. What remains is a transparent overlay
 * strip carrying only a glassy iOS-style hamburger (top-left) and, once a build
 * exists, the workbench actions (top-right). The logo, chat title, Builds link
 * and account menu all live in the sidebar now — nothing chromes the top of the
 * canvas, so the content reads as one clean surface.
 *
 * The hamburger uses a true iOS frosted-glass treatment: a translucent fill,
 * heavy backdrop blur + saturation, a hairline border, a 1px specular highlight
 * along the top inside edge (the "lit" rim that makes frosted glass read as a
 * physical pane), and a soft drop shadow so it lifts off the canvas.
 */
const glassButton =
  'pointer-events-auto items-center justify-center h-11 w-11 rounded-[14px] border border-[var(--pk-glass-border)] ' +
  'bg-[var(--pk-glass-bg)] backdrop-blur-2xl backdrop-saturate-[1.8] text-palmkit-elements-textSecondary ' +
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55),inset_0_-1px_0_0_rgba(0,0,0,0.05),inset_0_0_12px_0_rgba(255,255,255,0.06),0_8px_24px_-8px_rgba(0,0,0,0.32)] ' +
  'hover:text-palmkit-elements-textPrimary hover:bg-[var(--pk-glass-bg-hi)] hover:border-[var(--pk-glass-border-hi)] ' +
  'active:scale-[0.92] transition-all duration-200 select-none [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]';

export function Header() {
  const chat = useStore(chatStore);

  /*
   * The inline safe-area padding keeps the glass chrome clear of the Dynamic
   * Island / notch and rounded corners (viewport-fit=cover exposes the insets).
   */
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-logo flex items-start justify-between p-3 sm:p-4"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
      }}
    >
      {/* glassy hamburger — opens the projects drawer on mobile, toggles the sidebar on desktop.
          Exactly one is shown per breakpoint; the display class must NOT collide with a base
          `flex`, so the base has none and each button sets its own. */}
      {/*
        Opens the drawer two ways on purpose.

        Setting the store is what the rest of the app reacts to, but a store
        write is a no-op when the value is already the one being written — so
        if anything ever leaves `mobileActiveTab` on 'projects' while the panel
        is visually shut, this button would do literally nothing, and the only
        way out would be reloading the page. Driving the motion value as well
        makes the tap unconditional: whatever state the app is in, pressing
        Menu opens the drawer. Both land on the same target, so they cannot
        disagree.
      */}
      <button
        onClick={() => {
          mobileActiveTab.set('projects');
          animateDrawer(1);
        }}
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
