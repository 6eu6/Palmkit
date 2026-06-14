import { useStore } from '@nanostores/react';
import { memo, useCallback } from 'react';
import { mobileActiveTab, type MobileTab } from '~/lib/stores/mobile';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';

const tabs: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'i-ph:chat-circle-text' },
  { id: 'preview', label: 'Preview', icon: 'i-ph:play' },
  { id: 'files', label: 'Code', icon: 'i-ph:code' },
  { id: 'projects', label: 'History', icon: 'i-ph:clock-counter-clockwise' },
  { id: 'settings', label: 'Settings', icon: 'i-ph:gear-six' },
];

export const MobileBottomTabs = memo(() => {
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
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around sm:hidden
        bg-bolt-elements-bg-depth-1/90 backdrop-blur-xl
        border-t border-bolt-elements-borderColor"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={classNames(
              'flex flex-col items-center justify-center py-2 px-3 min-w-[56px] min-h-[48px] transition-all duration-200 outline-none relative',
              isActive
                ? 'text-bolt-elements-button-primary-text'
                : 'text-bolt-elements-textTertiary active:text-bolt-elements-textSecondary',
            )}
            aria-label={tab.label}
            aria-pressed={isActive}
          >
            {isActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded-full bg-gradient-to-r from-[var(--bolt-gradient-start)] to-[var(--bolt-gradient-end)]" />
            )}
            <div
              className={classNames(tab.icon, 'text-[20px] transition-transform duration-200', isActive && 'scale-110')}
            />
            <span
              className={classNames(
                'text-[10px] mt-0.5 leading-tight font-medium transition-colors duration-200',
                isActive ? 'text-bolt-elements-button-primary-text' : 'text-bolt-elements-textTertiary',
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
});

MobileBottomTabs.displayName = 'MobileBottomTabs';
