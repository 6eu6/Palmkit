import { useEffect, useState } from 'react';
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
  onSubmit: (name: string, memoryMode: MemoryMode) => Promise<void>;
}

/**
 * The New project / Project settings sheet.
 *
 * Rises from the bottom on phones and centres on desktop. The memory choice
 * is presented up front rather than buried, because it is the one setting
 * that changes what the model can see — see `app/lib/.server/memory/scope.ts`
 * for where it actually takes effect.
 */
export function ProjectSheet({ open, onClose, folder, movingLabel, onSubmit }: ProjectSheetProps) {
  const editing = Boolean(folder);
  const [name, setName] = useState('');
  const [memoryMode, setMemoryMode] = useState<MemoryMode>('default');
  const [busy, setBusy] = useState(false);

  // Reset to the project's current values every time the sheet opens.
  useEffect(() => {
    if (open) {
      setName(folder?.name ?? '');
      setMemoryMode(folder?.memoryMode ?? 'default');
      setBusy(false);
    }
  }, [open, folder]);

  const submit = async () => {
    if (busy || !name.trim()) {
      return;
    }

    setBusy(true);

    try {
      await onSubmit(name, memoryMode);
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
                  'fixed z-[1201] flex flex-col bg-white dark:bg-neutral-900',

                  // phone: bottom sheet · desktop: centred card
                  'inset-x-0 bottom-0 max-h-[92vh] rounded-t-3xl',
                  'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[440px]',
                  'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl',
                  'shadow-2xl',
                )}
                initial={{ y: '100%', opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '100%', opacity: 0.6 }}
                transition={{ type: 'spring', damping: 34, stiffness: 340 }}
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
              >
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3.5 dark:border-neutral-800">
                  <span className="w-9" />
                  <RadixDialog.Title className="text-[17px] font-semibold text-gray-900 dark:text-white">
                    {editing ? 'Project settings' : 'New project'}
                  </RadixDialog.Title>
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition active:scale-95 hover:bg-gray-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    <span className="i-ph:x h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 pb-5 pt-4">
                  {!editing && (
                    <p className="mb-4 text-center text-[14px] leading-relaxed text-gray-500 dark:text-gray-400">
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
                    className="w-full rounded-2xl bg-gray-100 px-4 py-3.5 text-[15px] text-gray-900 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-gray-300 dark:bg-neutral-800 dark:text-white dark:focus:ring-neutral-600"
                  />

                  <div className="mt-5">
                    <div className="mb-2 text-[13px] font-medium text-gray-500 dark:text-gray-400">Memory</div>
                    <div className="flex flex-col gap-2">
                      {MEMORY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setMemoryMode(opt.value)}
                          aria-pressed={memoryMode === opt.value}
                          className={classNames(
                            'rounded-2xl border px-4 py-3 text-left transition',
                            memoryMode === opt.value
                              ? 'border-blue-500 ring-1 ring-blue-500/40 dark:border-blue-400'
                              : 'border-gray-200 hover:border-gray-300 dark:border-neutral-700 dark:hover:border-neutral-600',
                          )}
                        >
                          <div className="text-[15px] font-medium text-gray-900 dark:text-white">{opt.title}</div>
                          <div className="mt-0.5 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
                            {opt.blurb}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-100 px-5 py-4 dark:border-neutral-800">
                  <button
                    onClick={() => void submit()}
                    disabled={busy || !name.trim()}
                    className={classNames(
                      'w-full rounded-full py-3.5 text-[16px] font-medium transition',
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
