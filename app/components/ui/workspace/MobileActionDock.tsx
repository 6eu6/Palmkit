import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { mobileActiveTab, WORKSPACE_TABS, type MobileTab } from '~/lib/stores/mobile';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';

/**
 * MobileActionDock — Premium mobile bottom navigation
 *
 * Two primary tabs: Chat and Workspace. The Workspace tab opens the workbench,
 * whose own top slider switches file / diff / preview and whose toolbar toggles
 * the terminal — so a single button covers the whole IDE surface. Settings and
 * Projects live in the header (menu + account), not the bottom bar.
 *
 * Dark glass surface with CSS custom properties, purple accent, Phosphor icons.
 */

const DOCK_ITEMS: { id: MobileTab; label: string; icon: string; iconActive: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'i-ph:chat-circle-text', iconActive: 'i-ph:chat-circle-text-bold' },
  { id: 'workspace', label: 'App', icon: 'i-ph:play-circle', iconActive: 'i-ph:play-circle-bold' },
];

export const MobileActionDock = memo(() => {
  const activeTab = useStore(mobileActiveTab);

  /*
   * Design v2: while the user stays in Chat during a build, a pulsing accent
   * dot on the App tab signals "there is something to look at" the moment
   * project files exist — instead of yanking them out of the conversation.
   */
  const files = useStore(workbenchStore.files);
  const hasFiles = Object.values(files ?? {}).some((d) => d?.type === 'file');

  const handleTabChange = useCallback((tab: MobileTab) => {
    mobileActiveTab.set(tab);

    switch (tab) {
      case 'chat':
        chatStore.setKey('showChat', true);
        workbenchStore.showWorkbench.set(false);

        /*
         * Terminal has its own tab — don't leave it open behind the others,
         * where it just eats half the screen with the E2B "shell in cloud" note.
         */
        workbenchStore.toggleTerminal(false);
        break;
      case 'workspace':
        /*
         * The single Workspace tab. Open the workbench and keep whatever view
         * the user was last on (file / diff / preview) via its own slider;
         * default to the code view so a build streams in visibly. The terminal
         * is reached from the workbench toolbar, not forced open here.
         */
        chatStore.setKey('showChat', false);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.toggleTerminal(false);

        /*
         * Keep whatever view the user (or the auto-preview) was last on.
         * The old "no previews → force code" check read the legacy
         * WebContainer previews store, which is always empty on the E2B
         * path — so it kicked users OFF the running preview back to code.
         */
        break;
      case 'preview':
        chatStore.setKey('showChat', false);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('preview');
        workbenchStore.toggleTerminal(false);
        break;
      case 'files':
        chatStore.setKey('showChat', false);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('code');
        workbenchStore.toggleTerminal(false);
        break;
      case 'actions':
        chatStore.setKey('showChat', false);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('code');
        workbenchStore.toggleTerminal(true);
        break;
      case 'settings':
        break;
      case 'projects':
        break;
    }
  }, []);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 sm:hidden backdrop-blur-2xl"
      style={{
        background: 'var(--palmkit-mobile-surface-bg-elevated)',
        borderTop: '1px solid var(--palmkit-mobile-surface-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Top accent gradient line with shimmer */}
      <div
        className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent 5%, var(--palmkit-gradient-start) 30%, var(--palmkit-gradient-mid) 50%, var(--palmkit-gradient-end) 70%, transparent 95%)',
          animation: 'accentLineShimmer 3s ease-in-out infinite',
        }}
      />

      <div className="flex items-center justify-around px-1 pt-1.5 pb-1.5">
        {DOCK_ITEMS.map((item) => {
          const isActive = item.id === 'workspace' ? WORKSPACE_TABS.includes(activeTab) : activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className="relative flex flex-col items-center justify-center flex-1 min-w-[48px] min-h-[48px] rounded-xl outline-none active:scale-[0.9]"
              style={{
                background: 'transparent',
                WebkitAppearance: 'none',
                appearance: 'none',
                border: 'none',
                transition: `transform var(--palmkit-duration-fast) var(--palmkit-ease-default)`,
                color: isActive ? 'var(--palmkit-mobile-text-accent)' : 'var(--palmkit-mobile-text-tertiary)',
              }}
              aria-label={item.label}
              aria-pressed={isActive}
            >
              {/* Active background pill */}
              {isActive && (
                <motion.div
                  className="absolute inset-1 rounded-lg"
                  style={{
                    background: 'var(--palmkit-mobile-accent-muted)',
                    boxShadow: 'var(--palmkit-shadow-accent)',
                  }}
                  layoutId="dockActivePill"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}

              {/* Icon */}
              <div className="relative z-1">
                <div
                  className={`${isActive ? item.iconActive : item.icon} text-[20px]`}
                  style={{
                    transition: `all var(--palmkit-duration-fast) var(--palmkit-ease-default)`,
                    ...(isActive && {
                      filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.4))',
                    }),
                  }}
                />
                {/* Pulsing "something to see" dot on App while user is in Chat */}
                {item.id === 'workspace' && !isActive && hasFiles && (
                  <span
                    className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full"
                    style={{
                      background: 'var(--pk-accent)',
                      boxShadow: '0 0 6px var(--pk-accent)',
                      animation: 'dockIndicatorPulse 2s ease-in-out infinite',
                    }}
                  />
                )}
              </div>

              {/* Label */}
              <span
                className="relative z-1 text-[10px] mt-0.5 leading-tight font-medium tracking-tight"
                style={{
                  color: isActive ? 'var(--palmkit-mobile-accent-text)' : 'var(--palmkit-mobile-text-tertiary)',
                  transition: `color var(--palmkit-duration-fast) var(--palmkit-ease-default)`,
                }}
              >
                {item.label}
              </span>

              {/* Active indicator dot with pulse animation */}
              {isActive && (
                <motion.div
                  className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                  style={{
                    background: 'var(--palmkit-gradient-mid)',
                    boxShadow: '0 0 6px rgba(229, 229, 229, 0.5)',
                    animation: 'dockIndicatorPulse 2s ease-in-out infinite',
                  }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

MobileActionDock.displayName = 'MobileActionDock';
