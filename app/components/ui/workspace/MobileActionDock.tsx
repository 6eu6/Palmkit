import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { mobileActiveTab, type MobileTab } from '~/lib/stores/mobile';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';

/**
 * MobileActionDock — Premium mobile bottom navigation
 *
 * 5 tabs: Chat, Preview, Code, Terminal, Settings
 * Dark glass surface with CSS custom properties, purple accent system, Phosphor icons.
 * Safe-area aware. Uses design tokens from variables.scss.
 */

const DOCK_ITEMS: { id: MobileTab; label: string; icon: string; iconActive: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'i-ph:chat-circle-text', iconActive: 'i-ph:chat-circle-text-bold' },
  { id: 'preview', label: 'Preview', icon: 'i-ph:play', iconActive: 'i-ph:play-bold' },
  { id: 'files', label: 'Code', icon: 'i-ph:code', iconActive: 'i-ph:code-bold' },
  { id: 'actions', label: 'Terminal', icon: 'i-ph:terminal-window', iconActive: 'i-ph:terminal-window-bold' },
  { id: 'settings', label: 'Settings', icon: 'i-ph:gear-six', iconActive: 'i-ph:gear-six-bold' },
];

export const MobileActionDock = memo(() => {
  const activeTab = useStore(mobileActiveTab);

  const handleTabChange = useCallback((tab: MobileTab) => {
    mobileActiveTab.set(tab);

    switch (tab) {
      case 'chat':
        chatStore.setKey('showChat', true);
        workbenchStore.showWorkbench.set(false);
        break;
      case 'preview':
        chatStore.setKey('showChat', false);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('preview');
        break;
      case 'files':
        chatStore.setKey('showChat', false);
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('code');
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
          const isActive = activeTab === item.id;

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
