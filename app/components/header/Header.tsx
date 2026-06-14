import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { mobileActiveTab } from '~/lib/stores/mobile';

export function Header() {
  const chat = useStore(chatStore);

  const handleMobileMenu = () => {
    mobileActiveTab.set('settings');
  };

  return (
    <header
      className={classNames(
        'flex items-center px-3 sm:px-4 h-[var(--header-height)]',
        'transition-all duration-300 ease-out',
        {
          'border-transparent bg-transparent': !chat.started,
          'border-b border-bolt-elements-borderColor bg-bolt-elements-bg-depth-1/80 backdrop-blur-xl': chat.started,
        },
      )}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer group">
        <button
          onClick={handleMobileMenu}
          className="sm:hidden p-1.5 -ml-1 rounded-lg hover:bg-bolt-elements-item-backgroundActive transition-colors"
          aria-label="Open menu"
        >
          <div className="i-ph:list text-xl text-bolt-elements-textSecondary" />
        </button>
        <div className="i-ph:sidebar-simple-duotone text-xl opacity-60 group-hover:opacity-100 transition-opacity duration-200 hidden sm:block" />
        <a href="/" className="flex items-center">
          <img
            src="/logo-light-styled.png"
            alt="logo"
            className="h-6 sm:h-7 inline-block dark:hidden transition-transform duration-200 group-hover:scale-105"
          />
          <img
            src="/logo-dark-styled.png"
            alt="logo"
            className="h-6 sm:h-7 inline-block hidden dark:block transition-transform duration-200 group-hover:scale-105"
          />
        </a>
      </div>
      {chat.started && (
        <>
          <span className="flex-1 px-3 sm:px-4 truncate text-center text-xs sm:text-sm font-medium text-bolt-elements-textSecondary">
            <ClientOnly>{() => <ChatDescription />}</ClientOnly>
          </span>
          <ClientOnly>
            {() => (
              <div className="flex-shrink-0">
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            )}
          </ClientOnly>
        </>
      )}
    </header>
  );
}
