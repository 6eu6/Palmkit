import { useStore } from '@nanostores/react';
import { Form } from '@remix-run/react';
import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { authUserStore } from '~/lib/stores/auth';
import { profileStore } from '~/lib/stores/profile';
import { themeStore, toggleTheme } from '~/lib/stores/theme';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { useSettingsStore } from '~/lib/stores/settings';
import { classNames } from '~/utils/classNames';

/**
 * ProfileMenu — the account control that lives in the sidebar/drawer footer.
 *
 * Clicking the profile row opens a clean popover with everything account-related
 * in one place: settings, appearance (theme), data export, sign out and delete.
 * Shared by the desktop sidebar and the mobile drawer so both behave the same.
 */
function Row({
  icon,
  label,
  onClick,
  href,
  danger,
  right,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  const cls = classNames(
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
    danger
      ? 'text-red-400 hover:bg-red-500/10'
      : 'text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
  );
  const inner = (
    <>
      <span className={classNames(icon, 'shrink-0 text-base', danger ? '' : 'text-palmkit-elements-textSecondary')} />
      <span className="flex-1">{label}</span>
      {right}
    </>
  );

  return href ? (
    <a href={href} className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

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

export function ProfileMenu({ variant = 'row' }: ProfileMenuProps = {}) {
  const authUser = useStore(authUserStore);
  const profile = useStore(profileStore);
  const theme = useStore(themeStore);
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const displayName = profile?.username || authUser?.email?.split('@')[0] || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  const openSettings = () => {
    setOpen(false);
    mobileActiveTab.set('settings');
    useSettingsStore.getState().openSettings();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);

        if (!v) {
          setConfirmingDelete(false);
        }
      }}
    >
      <Popover.Trigger asChild>
        {variant === 'icon' ? (
          <button
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
          <button className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 transition active:bg-gray-50 dark:active:bg-neutral-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-[13px] font-semibold text-gray-700 dark:bg-neutral-800 dark:text-gray-200">
              {initials}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[14px] font-medium text-gray-900 dark:text-white">
                {displayName}
              </span>
              <span className="block text-[11px] text-gray-400 dark:text-gray-500">Free</span>
            </span>
            <span className="i-ph:caret-up-down text-gray-400 dark:text-gray-500" />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align={variant === 'icon' ? 'start' : 'start'}
          sideOffset={8}
          collisionPadding={8}
          className="pk-no-fullscreen z-[9999] w-[260px] rounded-2xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 p-1.5 shadow-2xl"
        >
          {/* Account header */}
          <div className="flex items-center gap-2.5 px-2 py-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-palmkit-elements-background-depth-3 text-[13px] font-semibold text-palmkit-elements-textPrimary">
              {initials}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-palmkit-elements-textPrimary">{displayName}</div>
              {authUser?.email && (
                <div className="truncate text-[11px] text-palmkit-elements-textTertiary">{authUser.email}</div>
              )}
            </div>
          </div>

          <div className="my-1 h-px bg-palmkit-elements-borderColor/70" />

          <Row icon="i-ph:gear-six" label="Settings" onClick={openSettings} />
          <Row
            icon={theme === 'dark' ? 'i-ph:moon' : 'i-ph:sun'}
            label="Appearance"
            onClick={toggleTheme}
            right={
              <span className="rounded-md bg-palmkit-elements-background-depth-3 px-1.5 py-0.5 text-[10px] font-medium capitalize text-palmkit-elements-textSecondary">
                {theme}
              </span>
            }
          />
          <Row icon="i-ph:download-simple" label="Export my data" href="/api/account/export" />

          <div className="my-1 h-px bg-palmkit-elements-borderColor/70" />

          <Form method="post" action="/logout">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-palmkit-elements-textPrimary transition-colors hover:bg-palmkit-elements-item-backgroundActive"
            >
              <span className="i-ph:sign-out shrink-0 text-base text-palmkit-elements-textSecondary" />
              <span className="flex-1">Log out</span>
            </button>
          </Form>

          {!confirmingDelete ? (
            <Row icon="i-ph:trash" label="Delete account" danger onClick={() => setConfirmingDelete(true)} />
          ) : (
            <div className="px-2 py-2">
              <p className="mb-2 text-[11px] leading-relaxed text-palmkit-elements-textTertiary">
                Permanently deletes your account, projects and stored key. Cannot be undone.
              </p>
              <div className="flex gap-2">
                <Form method="post" action="/api/account/delete" className="flex-1">
                  <button
                    type="submit"
                    className="h-8 w-full rounded-lg bg-red-600 text-[12px] font-medium text-white transition-colors hover:bg-red-500"
                  >
                    Delete
                  </button>
                </Form>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="h-8 flex-1 rounded-lg bg-palmkit-elements-background-depth-3 text-[12px] font-medium text-palmkit-elements-textPrimary transition-colors hover:bg-palmkit-elements-item-backgroundActive"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
