import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useState, type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * One settings surface, with pages that slide in over each other.
 *
 * Settings used to be two unrelated things: an account sheet whose "Settings"
 * row opened a completely separate thirteen-tab panel somewhere else on
 * screen. Opening settings from settings, into a different shape, in a
 * different place. A page stack keeps everything in the one sheet the user
 * already opened — going deeper slides in, and Back slides out.
 */

export interface SettingsPage {
  id: string;
  title: string;
  render: (nav: SettingsNav) => ReactNode;
}

export interface SettingsNav {
  push: (page: SettingsPage) => void;
  pop: () => void;
  close: () => void;
}

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;

  /** The page shown when the sheet opens. */
  root: SettingsPage;
}

export function SettingsSheet({ open, onClose, root }: SettingsSheetProps) {
  const [stack, setStack] = useState<SettingsPage[]>([]);

  const close = useCallback(() => {
    onClose();

    /*
     * Reset AFTER the exit animation, or the sheet visibly snaps back to the
     * root page on its way out.
     */
    setTimeout(() => setStack([]), 250);
  }, [onClose]);

  const nav: SettingsNav = {
    push: (page) => setStack((s) => [...s, page]),
    pop: () => setStack((s) => s.slice(0, -1)),
    close,
  };

  const current = stack[stack.length - 1] ?? root;
  const depth = stack.length;

  return (
    <RadixDialog.Root open={open} onOpenChange={(v) => !v && close()}>
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

            {/*
              pk-no-fullscreen is required, not decorative: mobile.scss
              stretches every direct div child of a [role=dialog] to 100dvh,
              which would make each row of this sheet a screen tall.
            */}
            <RadixDialog.Content asChild>
              <motion.div
                className={classNames(
                  'pk-no-fullscreen fixed inset-x-0 bottom-0 z-[1201] flex h-[88vh] flex-col overflow-hidden',
                  'rounded-t-3xl bg-palmkit-elements-background-depth-2 shadow-2xl',
                  'sm:inset-x-auto sm:bottom-[6vh] sm:left-1/2 sm:h-[84vh] sm:w-[480px] sm:-translate-x-1/2 sm:rounded-3xl',
                )}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 36, stiffness: 380 }}
              >
                <div className="relative flex shrink-0 items-center px-3 pb-2 pt-4">
                  <div className="absolute left-1/2 top-2.5 h-1 w-9 -translate-x-1/2 rounded-full bg-palmkit-elements-borderColor sm:hidden" />

                  {/*
                    Back appears beside the title only once there is somewhere
                    to go back to.
                  */}
                  {depth > 0 ? (
                    <button
                      onClick={nav.pop}
                      aria-label="Back"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-palmkit-elements-textSecondary transition active:scale-90"
                    >
                      <span className="i-ph:caret-left h-5 w-5" />
                    </button>
                  ) : (
                    <span className="h-9 w-9 shrink-0" />
                  )}

                  <RadixDialog.Title className="min-w-0 flex-1 truncate px-1 text-center text-[17px] font-semibold text-palmkit-elements-textPrimary">
                    {current.title}
                  </RadixDialog.Title>

                  <button
                    onClick={close}
                    aria-label="Close settings"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-palmkit-elements-background-depth-1 text-palmkit-elements-textSecondary transition active:scale-90"
                  >
                    <span className="i-ph:x h-4 w-4" />
                  </button>
                </div>

                <div className="relative min-h-0 flex-1">
                  {/*
                    Deeper pages come from the right and leave to the right, so
                    the direction of travel matches the Back button that undoes
                    it.
                  */}
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.div
                      key={current.id}
                      initial={{ x: depth > 0 ? '100%' : 0, opacity: depth > 0 ? 0.6 : 1 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: '100%', opacity: 0.4 }}
                      transition={{ type: 'spring', damping: 34, stiffness: 400 }}
                      className="absolute inset-0 overflow-y-auto overscroll-contain px-4 pb-8"
                      style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}
                    >
                      {current.render(nav)}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

/* ── Shared row / group primitives, so every page looks like the same app ─── */

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      {title && <div className="mb-2 px-1 text-[15px] font-semibold text-palmkit-elements-textTertiary">{title}</div>}
      <div className="overflow-hidden rounded-2xl bg-palmkit-elements-background-depth-1">{children}</div>
    </div>
  );
}

export function SettingsRow({
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
  icon?: string;
  label: string;
  sub?: string;
  onClick?: () => void;
  href?: string;
  submit?: boolean;
  danger?: boolean;
  right?: ReactNode;
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
      {icon && (
        <span className={classNames(icon, 'h-5 w-5 shrink-0', danger ? '' : 'text-palmkit-elements-textSecondary')} />
      )}
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
