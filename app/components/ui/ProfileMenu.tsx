import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { authUserStore } from '~/lib/stores/auth';
import { profileStore } from '~/lib/stores/profile';
import { PalmkitSettings } from '~/components/settings/PalmkitSettings';
import { classNames } from '~/utils/classNames';

/**
 * iOS-style frosted glass: translucent fill, heavy blur + saturation, a
 * hairline border and a 1px specular rim along the top inside edge — the lit
 * edge is what makes frosted glass read as a physical pane rather than a
 * flat tint. Shared with the header's controls so every floating control in
 * the app is cut from the same material.
 */
export const GLASS_SURFACE =
  'border border-[var(--pk-glass-border)] bg-[var(--pk-glass-bg)] backdrop-blur-2xl backdrop-saturate-[1.8] ' +
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5),inset_0_-1px_0_0_rgba(0,0,0,0.05),inset_0_0_14px_0_rgba(255,255,255,0.07),0_8px_22px_-6px_rgba(0,0,0,0.28)]';

interface ProfileMenuProps {
  /**
   * `icon` renders just a frosted gear — for the drawer, where the control
   * floats over the conversation list instead of sitting in a footer row.
   */
  variant?: 'row' | 'icon';
}

/**
 * The button that opens settings.
 *
 * Nothing more: the sheet it opens owns every page, so this file no longer
 * carries a duplicate copy of the account rows that the settings root already
 * renders.
 */
export function ProfileMenu({ variant = 'row' }: ProfileMenuProps = {}) {
  const authUser = useStore(authUserStore);
  const profile = useStore(profileStore);
  const [open, setOpen] = useState(false);

  const displayName = profile?.username || authUser?.email?.split('@')[0] || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <>
      {variant === 'icon' ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="Settings and account"
          className={classNames(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-palmkit-elements-textSecondary',
            'transition active:scale-90 hover:text-palmkit-elements-textPrimary',
            GLASS_SURFACE,
          )}
        >
          <span className="i-ph:gear-six h-5 w-5" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          aria-label="Settings and account"
          className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 transition active:bg-gray-50 dark:active:bg-neutral-900"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-[13px] font-semibold text-gray-700 dark:bg-neutral-800 dark:text-gray-200">
            {initials}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[14px] font-medium text-gray-900 dark:text-white">{displayName}</span>
            <span className="block text-[11px] text-gray-400 dark:text-gray-500">Free</span>
          </span>
          <span className="i-ph:caret-up-down text-gray-400 dark:text-gray-500" />
        </button>
      )}

      <PalmkitSettings open={open} onClose={() => setOpen(false)} />
    </>
  );
}
