import { useEffect, useState } from 'react';
import { useKeyboardInset } from '~/lib/hooks/useKeyboardInset';
import * as RadixDialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import type { Folder } from '~/lib/stores/folders';

export type MemoryMode = 'default' | 'project_only';

const MEMORY_OPTIONS: Array<{ value: MemoryMode; title: string; blurb: string }> = [
  {
    value: 'default',
    title: 'Default',
    blurb: 'Project can access memories from outside chats, and vice versa.',
  },
  {
    value: 'project_only',
    title: 'Project-only',
    blurb: 'Project can only access its own memories. Its memories are hidden from outside chats.',
  },
];

interface ProjectSheetProps {
  open: boolean;
  onClose: () => void;

  /** Editing an existing project, or undefined when creating one. */
  folder?: Folder;

  /** Extra line shown when the sheet was opened to file a conversation away. */
  movingLabel?: string;
  onSubmit: (name: string, memoryMode: MemoryMode, instructions: string) => Promise<void>;
}

/**
 * The New project / Project settings sheet.
 *
 * Rises from the bottom on phones and centres on desktop. The memory choice
 * is presented up front rather than buried, because it is the one setting
 * that changes what the model can see — see `app/lib/.server/memory/scope.ts`
 * for where it actually takes effect.
 *
 * The `pk-no-fullscreen` class is required, not decorative: mobile.scss
 * stretches every direct div child of a `[role=dialog]` to 100dvh to make the
 * settings modal full-screen. Without opting out, every row of this sheet
 * became a full screen tall.
 */
export function ProjectSheet({ open, onClose, folder, movingLabel, onSubmit }: ProjectSheetProps) {
  /*
   * The sheet sits ON TOP of the on-screen keyboard rather than behind it.
   * `bottom: 0` resolves against the LAYOUT viewport, which a phone keyboard
   * does not shrink — so the action button ended up stranded underneath it,
   * reading as though it were floating in the middle of the screen. Lifting
   * by the visual viewport's inset pins it to the bottom of whatever is
   * actually visible, and it settles back down when the keyboard closes.
   */
  const editing = Boolean(folder);
  const [name, setName] = useState('');
  const [memoryMode, setMemoryMode] = useState<MemoryMode>('default');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const keyboardInset = useKeyboardInset();

  // Reset to the project's current values every time the sheet opens.
  useEffect(() => {
    if (open) {
      setName(folder?.name ?? '');
      setMemoryMode(folder?.memoryMode ?? 'default');
      setInstructions(folder?.instructions ?? '');
      setBusy(false);
    }
  }, [open, folder]);

  const submit = async () => {
    if (busy || !name.trim()) {
      return;
    }

    setBusy(true);

    try {
      await onSubmit(name, memoryMode, instructions);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
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
            <RadixDialog.Content asChild>
              <motion.div
                className={classNames(
                  'pk-no-fullscreen fixed z-[1201] flex flex-col bg-white dark:bg-neutral-900',

                  // phone: bottom sheet · desktop: centred card
                  'inset-x-0 bottom-0 max-h-[92vh] rounded-t-3xl',
                  'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[440px]',
                  'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl',
                  'shadow-2xl',
                )}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 36, stiffness: 380 }}
                style={{
                  bottom: keyboardInset,
                  maxHeight: `calc(92vh - ${keyboardInset}px)`,
                  paddingBottom: keyboardInset ? 0 : 'env(safe-area-inset-bottom, 0px)',
                }}
              >
                {/* Grabber — the affordance that says "this sheet is draggable
                    and dismissible", and visually separates it from the page. */}
                <div className="flex justify-center pt-2.5 sm:hidden">
                  <div className="h-1 w-9 rounded-full bg-gray-300 dark:bg-neutral-700" />
                </div>

                <div className="relative flex items-center justify-center px-4 pb-3 pt-3">
                  <RadixDialog.Title className="text-[17px] font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">
                    {editing ? 'Project settings' : 'New project'}
                  </RadixDialog.Title>
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition active:scale-90 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
                  >
                    <span className="i-ph:x h-4 w-4" />
                  </button>
                </div>

                {/* Only this region scrolls; the header and the action row stay put. */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
                  {!editing && (
                    <p className="mx-auto mb-5 max-w-[300px] text-center text-[14px] leading-[1.45] text-gray-500 dark:text-gray-400">
                      Projects give Palmkit shared context across chats and files, all in one place.
                    </p>
                  )}

                  {movingLabel && (
                    <p className="mb-3 rounded-xl bg-gray-50 px-3 py-2 text-[13px] text-gray-600 dark:bg-neutral-800/60 dark:text-gray-300">
                      <span className="font-medium text-gray-900 dark:text-white">{movingLabel}</span> will be moved
                      into it.
                    </p>
                  )}

                  <input
                    autoFocus
                    value={name}
                    placeholder="Project name"
                    aria-label="Project name"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                    className="w-full rounded-2xl bg-gray-100 px-4 py-3.5 text-[16px] text-gray-900 outline-none transition placeholder:text-gray-400 focus:bg-gray-50 focus:ring-2 focus:ring-gray-900/10 dark:bg-neutral-800 dark:text-white dark:focus:bg-neutral-800 dark:focus:ring-white/15"
                  />

                  <div className="mt-5">
                    <div className="mb-2 px-0.5 text-[13px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Instructions
                    </div>
                    <textarea
                      value={instructions}
                      rows={3}
                      aria-label="Project instructions"
                      placeholder="What is this project, and how should Palmkit behave in it?"
                      onChange={(e) => setInstructions(e.target.value)}
                      className="w-full resize-none rounded-2xl bg-gray-100 px-4 py-3 text-[15px] leading-snug text-gray-900 outline-none transition placeholder:text-gray-400 focus:ring-2 focus:ring-gray-900/10 dark:bg-neutral-800 dark:text-white dark:focus:ring-white/15"
                    />
                    <p className="mt-1.5 px-0.5 text-[12px] leading-snug text-gray-400 dark:text-gray-500">
                      Sent with every conversation in this project, so you only write it once.
                    </p>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 px-0.5 text-[13px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Memory
                    </div>
                    <div className="flex flex-col gap-2">
                      {MEMORY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setMemoryMode(opt.value)}
                          aria-pressed={memoryMode === opt.value}
                          className={classNames(
                            'relative rounded-2xl border px-4 py-3.5 pr-11 text-left transition',
                            memoryMode === opt.value
                              ? 'border-gray-900 bg-gray-50 dark:border-white dark:bg-neutral-800/60'
                              : 'border-gray-200 hover:border-gray-300 dark:border-neutral-700 dark:hover:border-neutral-600',
                          )}
                        >
                          <div className="text-[15px] font-medium text-gray-900 dark:text-white">{opt.title}</div>
                          <div className="mt-1 text-[13px] leading-[1.4] text-gray-500 dark:text-gray-400">
                            {opt.blurb}
                          </div>
                          <span
                            className={classNames(
                              'absolute right-3.5 top-4 h-[18px] w-[18px] shrink-0',
                              memoryMode === opt.value
                                ? 'i-ph:check-circle-fill text-gray-900 dark:text-white'
                                : 'i-ph:circle text-gray-300 dark:text-neutral-600',
                            )}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="px-5 pb-4 pt-1">
                  <button
                    onClick={() => void submit()}
                    disabled={busy || !name.trim()}
                    className={classNames(
                      'w-full rounded-full py-4 text-[16px] font-semibold tracking-[-0.01em] transition',
                      busy || !name.trim()
                        ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-neutral-800 dark:text-neutral-600'
                        : 'bg-gray-900 text-white active:scale-[0.99] hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100',
                    )}
                  >
                    {editing ? 'Done' : 'Create project'}
                  </button>
                </div>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
