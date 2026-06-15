import { useStore } from '@nanostores/react';
import { Form } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { authEnabledStore, authUserStore, openAuthModal } from '~/lib/stores/auth';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { useSettingsStore } from '~/lib/stores/settings';
import { classNames } from '~/utils/classNames';

/**
 * Header account control: a "Log in" button when signed out, or an avatar with
 * a dropdown (Profile / Log out) when signed in. Hidden when auth isn't
 * configured on the server.
 */
export function AccountMenu() {
  const user = useStore(authUserStore);
  const authEnabled = useStore(authEnabledStore);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);

    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!authEnabled) {
    return null;
  }

  if (!user) {
    return (
      <button
        onClick={openAuthModal}
        className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6234bb 100%)' }}
      >
        <span className="i-ph:sign-in text-sm" />
        Log in
      </button>
    );
  }

  const label = user.name || user.email?.split('@')[0] || 'Account';
  const initial = label.charAt(0).toUpperCase();

  const openProfile = () => {
    setOpen(false);
    mobileActiveTab.set('settings');
    useSettingsStore.getState().openSettings();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full transition-transform active:scale-95"
        aria-label="Account"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={label}
            className="w-8 h-8 rounded-full object-cover border border-[var(--bolt-mobile-surface-border)]"
          />
        ) : (
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6234bb 100%)' }}
          >
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-xl border shadow-xl overflow-hidden z-[60]"
          style={{
            background: 'var(--bolt-mobile-surface-bg, #0e0e16)',
            borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.18))',
            animation: 'fade-in-scale 0.16s ease forwards',
          }}
        >
          <div className="px-3.5 py-3 border-b border-[var(--bolt-mobile-surface-border)]">
            <p className="text-sm font-medium text-bolt-elements-textPrimary truncate">{label}</p>
            {user.email && <p className="text-xs text-bolt-elements-textSecondary truncate">{user.email}</p>}
          </div>

          <button
            onClick={openProfile}
            className={classNames(
              'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-bolt-elements-textPrimary',
              'hover:bg-bolt-elements-bg-depth-3 transition-colors',
            )}
          >
            <span className="i-ph:user-circle text-base text-bolt-elements-textSecondary" />
            Profile &amp; settings
          </button>

          <Form method="post" action="/logout">
            <button
              type="submit"
              className={classNames(
                'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-400',
                'hover:bg-bolt-elements-bg-depth-3 transition-colors',
              )}
            >
              <span className="i-ph:sign-out text-base" />
              Log out
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}
