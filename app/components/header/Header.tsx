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
          'bg-[var(--bolt-mobile-surface-bg)] backdrop-blur-xl border-b border-[var(--bolt-mobile-surface-border)]':
            chat.started,
        },
      )}
    >
      <div className="flex items-center gap-2 z-logo text-bolt-elements-textPrimary cursor-pointer group">
        <button
          onClick={handleMobileMenu}
          className={classNames(
            'sm:hidden p-1.5 -ml-1 rounded-lg transition-colors',
            'text-[var(--bolt-mobile-text-secondary)]',
            'hover:bg-[var(--bolt-mobile-accent-faint)] hover:text-[var(--bolt-mobile-accent-text)]',
            'active:bg-[var(--bolt-mobile-accent-faint)] active:text-[var(--bolt-mobile-accent-text)]',
          )}
          aria-label="Projects and history"
        >
          <div className="i-ph:list text-xl" />
        </button>
        <div className="i-ph:sidebar-simple-duotone text-xl opacity-60 group-hover:opacity-100 transition-opacity duration-200 hidden sm:block" />
        <a href="/" className="flex items-center gap-2" aria-label="Pocketforge home">
          {/* Brand mark: lightning glyph in a violet gradient chip */}
          <span
            className="flex items-center justify-center w-7 h-7 rounded-[9px] text-white transition-transform duration-200 group-hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, var(--bolt-mobile-accent) 0%, #6234bb 100%)',
              boxShadow: '0 2px 10px rgba(139, 92, 246, 0.35)',
            }}
          >
            <span className="i-ph:lightning-fill text-base" />
          </span>
          {/* Wordmark */}
          <span className="text-[17px] sm:text-lg font-semibold tracking-tight leading-none select-none">
            <span className="text-[var(--bolt-mobile-text-primary)]">Pocket</span>
            <span className="text-[var(--bolt-mobile-accent-text)]">forge</span>
          </span>
        </a>
      </div>
      {chat.started && (
        <>
          <span className="flex-1 px-3 sm:px-4 truncate text-center text-xs sm:text-sm font-medium text-[var(--bolt-mobile-text-secondary)]">
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
