import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { mobileActiveTab, type MobileTab } from '~/lib/stores/mobile';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';

/**
 * MobileActionDock
 *
 * Polished mobile dock replacing MobileBottomTabs.
 * 5 actions: Chat, Preview, Files, Actions, Settings
 * Dark glass background, purple glow active state, safe-area aware.
 *
 * Usage:
 *   <MobileActionDock />
 */

const DOCK_ITEMS: { id: MobileTab; label: string; icon: string; iconActive: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'i-ph:chat-circle-text', iconActive: 'i-ph:chat-circle-text-bold' },
  { id: 'preview', label: 'Preview', icon: 'i-ph:play', iconActive: 'i-ph:play-bold' },
  { id: 'files', label: 'Code', icon: 'i-ph:code', iconActive: 'i-ph:code-bold' },
  { id: 'actions', label: 'Actions', icon: 'i-ph:terminal', iconActive: 'i-ph:terminal-bold' },
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
      case 'projects':
        break;
      case 'settings':
        break;
    }
  }, []);

  return (
    <div
      className={classNames(
        'fixed bottom-0 left-0 right-0 z-50 sm:hidden',

        // Dark translucent glass — works for both themes
        'bg-[#0f0f18]/85 dark:bg-[#0a0a0f]/90',
        'backdrop-blur-2xl',

        // Subtle purple-tinted border
        'border-t border-[rgba(139,92,246,0.12)] dark:border-[rgba(139,92,246,0.15)]',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Top gradient glow line — purple accent */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 5%, var(--bolt-gradient-start) 30%, var(--bolt-gradient-mid) 50%, var(--bolt-gradient-end) 70%, transparent 95%)',
          opacity: 0.4,
        }}
      />

      <div className="flex items-center justify-around px-1 pt-1.5 pb-1.5">
        {DOCK_ITEMS.map((item) => {
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={classNames(
                'relative flex flex-col items-center justify-center',
                'min-w-[48px] min-h-[44px]',
                'rounded-xl transition-all duration-200 outline-none',
                'active:scale-90',
                isActive
                  ? 'text-purple-400 dark:text-purple-300'
                  : 'text-gray-500 dark:text-gray-500 active:text-gray-400 dark:active:text-gray-400',
              )}
              aria-label={item.label}
              aria-pressed={isActive}
            >
              {/* Active background pill — dark glass with purple tint */}
              {isActive && (
                <motion.div
                  className="absolute inset-1 rounded-lg"
                  style={{
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(168,85,247,0.08))',
                    boxShadow: '0 0 12px rgba(139,92,246,0.08)',
                  }}
                  layoutId="dockActivePill"
                  transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                />
              )}

              {/* Icon */}
              <div className="relative z-1">
                <div
                  className={classNames(
                    isActive ? item.iconActive : item.icon,
                    'text-[18px] transition-all duration-200',
                    isActive && 'drop-shadow-[0_0_8px_rgba(139,92,246,0.4)]',
                  )}
                />
              </div>

              {/* Label */}
              <span
                className={classNames(
                  'relative z-1 text-[9px] mt-0.5 leading-tight font-medium transition-all duration-200',
                  isActive ? 'text-purple-400 dark:text-purple-300' : 'text-gray-500 dark:text-gray-500',
                )}
              >
                {item.label}
              </span>

              {/* Active indicator dot with glow */}
              {isActive && (
                <motion.div
                  className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                  style={{
                    background: 'var(--bolt-gradient-mid)',
                    boxShadow: '0 0 8px rgba(168,85,247,0.6)',
                  }}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
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
