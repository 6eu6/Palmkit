import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { AccountMenu } from './AccountMenu';

export function Header() {
  const chat = useStore(chatStore);

  const handleMobileMenu = () => {
    // Open the projects/history drawer so users can switch, delete or start projects.
    mobileActiveTab.set('projects');
  };

  return (
    <header
      className={classNames(
        'flex items-center px-3 sm:px-4 h-[var(--header-height)]',
        'transition-all duration-300 ease-out',
        {
          'border-transparent bg-transparent': !chat.started,
          'bg-[var(--palmkit-mobile-surface-bg)] backdrop-blur-xl border-b border-[var(--palmkit-mobile-surface-border)]':
            chat.started,
        },
      )}
    >
      <div className="flex items-center gap-2 z-logo text-palmkit-elements-textPrimary cursor-pointer group">
        <button
          onClick={handleMobileMenu}
          className={classNames(
            'sm:hidden p-1.5 -ml-1 rounded-lg transition-colors',
            'text-[var(--palmkit-mobile-text-secondary)]',
            'hover:bg-[var(--palmkit-mobile-accent-faint)] hover:text-[var(--palmkit-mobile-accent-text)]',
            'active:bg-[var(--palmkit-mobile-accent-faint)] active:text-[var(--palmkit-mobile-accent-text)]',
          )}
          aria-label="Projects and history"
        >
          <div className="i-ph:list text-xl" />
        </button>
        <div className="i-ph:sidebar-simple-duotone text-xl opacity-60 group-hover:opacity-100 transition-opacity duration-200 hidden sm:block" />
        <a
          href="/"
          className="flex items-center transition-transform duration-200 group-hover:scale-[1.03]"
          aria-label="Palmkit home"
        >
          {/* Palmkit wordmark logo — light/dark variants */}
          <img src="/palmkit-logo-light.png" alt="Palmkit" className="h-7 w-auto select-none dark:hidden" />
          <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-7 w-auto select-none hidden dark:block" />
        </a>
      </div>
      {chat.started && (
        <span className="flex-1 px-3 sm:px-4 truncate text-center text-xs sm:text-sm font-medium text-[var(--palmkit-mobile-text-secondary)]">
          <ClientOnly>{() => <ChatDescription />}</ClientOnly>
        </span>
      )}
      <div className={classNames('flex items-center gap-2', { 'ml-auto': !chat.started })}>
        {chat.started && (
          <ClientOnly>
            {() => (
              <div className="flex-shrink-0">
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            )}
          </ClientOnly>
        )}
        <ClientOnly>{() => <AccountMenu />}</ClientOnly>
      </div>
    </header>
  );
}
