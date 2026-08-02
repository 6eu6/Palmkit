import { useStore } from '@nanostores/react';
import { Form } from '@remix-run/react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useState } from 'react';
import { authUserStore } from '~/lib/stores/auth';
import { profileStore } from '~/lib/stores/profile';
import { themeStore, toggleTheme } from '~/lib/stores/theme';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { useSettingsStore } from '~/lib/stores/settings';
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

/**
 * One tappable line inside a grouped card.
 *
 * Grouped cards with hairline separators between the rows — not around them —
 * are the shape iOS settings has trained everyone to read: the card says
 * "these belong together", the separator says "this is a different one".
 */
function Row({
  icon,
  label,
  sub,
  onClick,
  href,
  submit,
  danger,
  right,
  chevron,
  first,
}: {
  icon: string;
  label: string;
  sub?: string;
  onClick?: () => void;
  href?: string;
  submit?: boolean;
  danger?: boolean;
  right?: React.ReactNode;
  chevron?: boolean;
  first?: boolean;
}) {
  const cls = classNames(
    'flex w-full items-center gap-3.5 px-4 text-left transition-colors',
    sub ? 'py-3' : 'py-3.5',
    danger
      ? 'text-red-500 active:bg-red-500/10'
      : 'text-palmkit-elements-textPrimary active:bg-black/5 dark:active:bg-white/5',
    first ? '' : 'border-t border-palmkit-elements-borderColor/60',
  );

  const inner = (
    <>
      <span className={classNames(icon, 'h-5 w-5 shrink-0', danger ? '' : 'text-palmkit-elements-textSecondary')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px]">{label}</span>
        {sub && <span className="block truncate text-[13px] text-palmkit-elements-textTertiary">{sub}</span>}
      </span>
      {right}
      {chevron && <span className="i-ph:caret-right h-4 w-4 shrink-0 text-palmkit-elements-textTertiary" />}
    </>
  );

  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }

  return (
    <button type={submit ? 'submit' : 'button'} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function Group({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      {title && <div className="mb-2 px-1 text-[15px] font-semibold text-palmkit-elements-textTertiary">{title}</div>}
      <div className="overflow-hidden rounded-2xl bg-palmkit-elements-background-depth-1">{children}</div>
    </div>
  );
}

interface ProfileMenuProps {
  /**
   * `icon` renders just a frosted gear — for the drawer, where the control
   * floats over the conversation list instead of sitting in a footer row.
   */
  variant?: 'row' | 'icon';
}

/**
 * The account control, and the sheet it opens.
 *
 * The sheet rises from the bottom and takes most of the screen rather than
 * hanging off the button as a small popover. Everything account-related is one
 * scrollable page of grouped rows, which is what a phone has room to read —
 * a 260px popover anchored to a corner had to abbreviate every label and still
 * ran off the edge.
 */
export function ProfileMenu({ variant = 'row' }: ProfileMenuProps = {}) {
  const authUser = useStore(authUserStore);
  const profile = useStore(profileStore);
  const theme = useStore(themeStore);
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const displayName = profile?.username || authUser?.email?.split('@')[0] || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  const close = useCallback(() => {
    setOpen(false);
    setConfirmingDelete(false);
  }, []);

  const openSettings = () => {
    close();
    mobileActiveTab.set('settings');
    useSettingsStore.getState().openSettings();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <RadixDialog.Trigger asChild>
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
      </RadixDialog.Trigger>

      <AnimatePresence>
        {open && (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-[1200] bg-black/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            </RadixDialog.Overlay>
            {/* pk-no-fullscreen is required, not decorative: mobile.scss
                stretches every direct div child of a [role=dialog] to 100dvh,
                which would make each row of this sheet a screen tall. */}
            <RadixDialog.Content asChild>
              <motion.div
                className={classNames(
                  'pk-no-fullscreen fixed inset-x-0 bottom-0 z-[1201] flex h-[88vh] flex-col',
                  'rounded-t-3xl bg-palmkit-elements-background-depth-2 shadow-2xl',
                  'sm:inset-x-auto sm:left-1/2 sm:h-[80vh] sm:w-[460px] sm:-translate-x-1/2 sm:rounded-3xl sm:bottom-[10vh]',
                )}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 36, stiffness: 380 }}
              >
                <RadixDialog.Title className="sr-only">Account and settings</RadixDialog.Title>

                <div className="relative flex items-center justify-end px-4 pb-2 pt-4">
                  <div className="absolute left-1/2 top-2.5 h-1 w-9 -translate-x-1/2 rounded-full bg-palmkit-elements-borderColor sm:hidden" />
                  <button
                    onClick={close}
                    aria-label="Close"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-palmkit-elements-background-depth-1 text-palmkit-elements-textSecondary transition active:scale-90"
                  >
                    <span className="i-ph:x h-4 w-4" />
                  </button>
                </div>

                <div
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8"
                  style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className="mb-7 flex flex-col items-center">
                    <span className="flex h-20 w-20 items-center justify-center rounded-full bg-palmkit-elements-background-depth-3 text-[24px] font-semibold text-palmkit-elements-textPrimary">
                      {initials}
                    </span>
                    <div className="mt-3 text-[20px] font-semibold text-palmkit-elements-textPrimary">
                      {displayName}
                    </div>
                  </div>

                  <Group title="Account">
                    {authUser?.email && <Row first icon="i-ph:envelope-simple" label="Email" sub={authUser.email} />}
                    <Row
                      first={!authUser?.email}
                      icon="i-ph:plus-square"
                      label="Subscription"
                      right={<span className="text-[15px] text-palmkit-elements-textTertiary">Free</span>}
                    />
                  </Group>

                  <Group title="Preferences">
                    <Row first icon="i-ph:sliders-horizontal" label="Settings" chevron onClick={openSettings} />
                    <Row
                      icon={theme === 'dark' ? 'i-ph:moon' : 'i-ph:sun'}
                      label="Appearance"
                      onClick={toggleTheme}
                      right={<span className="text-[15px] capitalize text-palmkit-elements-textTertiary">{theme}</span>}
                    />
                  </Group>

                  <Group title="Data">
                    <Row first icon="i-ph:download-simple" label="Export my data" chevron href="/api/account/export" />
                  </Group>

                  <Group>
                    <Form method="post" action="/logout">
                      <Row first submit icon="i-ph:sign-out" label="Log out" />
                    </Form>
                    {!confirmingDelete ? (
                      <Row icon="i-ph:trash" label="Delete account" danger onClick={() => setConfirmingDelete(true)} />
                    ) : (
                      <div className="border-t border-palmkit-elements-borderColor/60 px-4 py-3.5">
                        <p className="mb-3 text-[13px] leading-relaxed text-palmkit-elements-textTertiary">
                          Permanently deletes your account, projects and stored key. Cannot be undone.
                        </p>
                        <div className="flex gap-2">
                          <Form method="post" action="/api/account/delete" className="flex-1">
                            <button
                              type="submit"
                              className="h-11 w-full rounded-full bg-red-600 text-[15px] font-semibold text-white transition active:scale-[0.98]"
                            >
                              Delete
                            </button>
                          </Form>
                          <button
                            onClick={() => setConfirmingDelete(false)}
                            className="h-11 flex-1 rounded-full bg-palmkit-elements-background-depth-3 text-[15px] font-semibold text-palmkit-elements-textPrimary transition active:scale-[0.98]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </Group>
                </div>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
