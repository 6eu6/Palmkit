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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmingDelete(false);
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
        style={{ background: 'linear-gradient(135deg, #00A8B5 0%, #008C97 100%)' }}
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
            className="w-8 h-8 rounded-full object-cover border border-[var(--palmkit-mobile-surface-border)]"
          />
        ) : (
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #00A8B5 0%, #008C97 100%)' }}
          >
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-xl border shadow-xl overflow-hidden z-[60]"
          style={{
            background: 'var(--palmkit-mobile-surface-bg, #0e0e16)',
            borderColor: 'var(--palmkit-mobile-surface-border, rgba(255, 255, 255, 0.18))',
            animation: 'fade-in-scale 0.16s ease forwards',
          }}
        >
          <div className="px-3.5 py-3 border-b border-[var(--palmkit-mobile-surface-border)]">
            <p className="text-sm font-medium text-palmkit-elements-textPrimary truncate">{label}</p>
            {user.email && <p className="text-xs text-palmkit-elements-textSecondary truncate">{user.email}</p>}
          </div>

          <button
            onClick={openProfile}
            className={classNames(
              'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-palmkit-elements-textPrimary',
              'hover:bg-palmkit-elements-bg-depth-3 transition-colors',
            )}
          >
            <span className="i-ph:user-circle text-base text-palmkit-elements-textSecondary" />
            Profile &amp; settings
          </button>

          <a
            href="/api/account/export"
            className={classNames(
              'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-palmkit-elements-textPrimary',
              'hover:bg-palmkit-elements-bg-depth-3 transition-colors',
            )}
          >
            <span className="i-ph:download-simple text-base text-palmkit-elements-textSecondary" />
            Export my data
          </a>

          <Form method="post" action="/logout">
            <button
              type="submit"
              className={classNames(
                'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-palmkit-elements-textPrimary',
                'hover:bg-palmkit-elements-bg-depth-3 transition-colors',
              )}
            >
              <span className="i-ph:sign-out text-base text-palmkit-elements-textSecondary" />
              Log out
            </button>
          </Form>

          <div className="border-t border-[var(--palmkit-mobile-surface-border)]">
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <span className="i-ph:trash text-base" />
                Delete account
              </button>
            ) : (
              <div className="px-3.5 py-3">
                <p className="text-xs text-palmkit-elements-textSecondary mb-2.5 leading-relaxed">
                  This permanently deletes your account, projects, and stored key. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Form method="post" action="/api/account/delete" className="flex-1">
                    <button
                      type="submit"
                      className="w-full h-8 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-500 transition-colors"
                    >
                      Delete permanently
                    </button>
                  </Form>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="flex-1 h-8 rounded-lg text-xs font-medium text-palmkit-elements-textPrimary bg-palmkit-elements-bg-depth-3 hover:bg-palmkit-elements-bg-depth-2 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
