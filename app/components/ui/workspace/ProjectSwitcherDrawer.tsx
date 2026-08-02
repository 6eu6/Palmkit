import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from '@remix-run/react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { db, getAll, deleteChatCompletely, getSnapshot, type ChatHistoryItem } from '~/lib/persistence';
import { chatId } from '~/lib/persistence';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { binDates, partitionPinned } from '~/components/sidebar/date-binning';
import { ChatItemMenu } from '~/components/sidebar/ChatItemMenu';
import { renameChat, setChatPinned } from '~/lib/persistence/chatActions';
import { useLongPress } from '~/lib/hooks/useLongPress';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { sidebarModeStore, setSidebarMode, SIDEBAR_QUICK_ACTIONS, type SidebarMode } from '~/lib/stores/sidebar';
import { ProfileMenu } from '~/components/ui/ProfileMenu';

/**
 * ProjectSwitcherDrawer
 *
 * Premium mobile project list drawer with dark developer-tool aesthetic.
 * - Animated gradient accent line at top
 * - New Project button with full gradient
 * - Date-binned project list with status badges
 * - Mobile-friendly delete (visible on press)
 * - Safe-area support
 *
 * Usage:
 *   <ProjectSwitcherDrawer open={open} onClose={onClose} />
 */

type ProjectStatus = 'saved' | 'generating' | 'interrupted';

interface ProjectItem extends ChatHistoryItem {
  status: ProjectStatus;
}

interface ProjectSwitcherDrawerProps {
  open: boolean;
  onClose: () => void;
}

/*
 * Slide in from the LEFT as a side drawer (standard mobile navigation
 * pattern). It previously rose from the bottom of the screen like an action
 * sheet, which read as broken for a hamburger-triggered history menu.
 */
const DRAWER_VARIANTS = {
  hidden: { x: '-100%' },
  visible: { x: 0 },
  exit: { x: '-100%' },
};

const OVERLAY_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

/**
 * One conversation row in the mobile drawer.
 *
 * Carries the same action set as the desktop sidebar: a permanent ⋯ button,
 * and a long-press anywhere on the row opens the same menu — the two gestures
 * a phone user expects. Renaming happens inline, in place of the title.
 */
function DrawerChatRow({
  item,
  onOpen,
  onDelete,
  onTogglePin,
  onRenamed,
  formatTime,
}: {
  item: ProjectItem;
  onOpen: (item: ChatHistoryItem) => void;
  onDelete: (item: ChatHistoryItem) => void;
  onTogglePin: (item: ChatHistoryItem) => void;
  onRenamed: () => void;
  formatTime: (t: string) => string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.description ?? '');
  const { handlers: longPress, consumedClick } = useLongPress(() => setMenuOpen(true));

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!db) {
      return;
    }

    const result = await renameChat(db, item.id, draft);

    if (!result.ok) {
      toast.error(result.error ?? 'Failed to rename conversation');
      return;
    }

    setEditing(false);
    toast.success('Conversation renamed');
    onRenamed();
  };

  if (editing) {
    return (
      <form onSubmit={submitRename} className="flex items-center gap-2 px-2.5 py-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[14px] text-gray-900 outline-none focus:ring-1 focus:ring-gray-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
        />
        <button type="submit" onMouseDown={submitRename} className="i-ph:check h-5 w-5 shrink-0 text-gray-500" />
      </form>
    );
  }

  return (
    <div className="group relative flex items-center" {...longPress}>
      <button
        onClick={(e) => {
          if (consumedClick()) {
            e.preventDefault();
            return;
          }

          onOpen(item);
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-2 pl-2.5 pr-1 text-left transition active:bg-gray-50 dark:active:bg-neutral-900"
      >
        {item.pinned ? (
          <span className="i-ph:push-pin-fill h-3 w-3 shrink-0 text-gray-400 dark:text-gray-500" />
        ) : (
          <span
            className={classNames(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              item.status === 'generating'
                ? 'animate-pulse bg-blue-400'
                : item.status === 'interrupted'
                  ? 'bg-amber-400'
                  : 'bg-gray-300 dark:bg-gray-600',
            )}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-[14px] text-palmkit-elements-textPrimary">
          {item.description || 'Untitled'}
        </span>
        <span className="shrink-0 text-[11px] text-palmkit-elements-textTertiary">{formatTime(item.timestamp)}</span>
      </button>
      <ChatItemMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        pinned={Boolean(item.pinned)}
        onPin={() => onTogglePin(item)}
        onRename={() => {
          setDraft(item.description ?? '');
          setEditing(true);
        }}
        onMoveToProject={() => undefined}
        onDelete={() => onDelete(item)}
        trigger={
          <button
            aria-label={`Actions for ${item.description || 'conversation'}`}
            onClick={(e) => e.stopPropagation()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-400 transition active:scale-95 active:bg-gray-100 dark:text-gray-500 dark:active:bg-neutral-800"
          >
            <div className="i-ph:dots-three-outline-fill text-base" />
          </button>
        }
      />
    </div>
  );
}

export const ProjectSwitcherDrawer = memo(({ open, onClose }: ProjectSwitcherDrawerProps) => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<ChatHistoryItem | null>(null);
  const mode = useStore(sidebarModeStore);

  const loadProjects = useCallback(async () => {
    if (!db) {
      return;
    }

    try {
      const dbInstance = db;
      const chats = await getAll(dbInstance);

      /*
       * Scope the list to the active tab, exactly like the desktop sidebar.
       * Without this filter the drawer listed EVERY conversation under all
       * three tabs, which is what made Chat/Work/Code look like they shared a
       * single history on phones. Records written before the mode column
       * existed default to 'code'.
       */
      const currentMode = sidebarModeStore.get();

      const withStatus: ProjectItem[] = await Promise.all(
        chats
          .filter((item) => item.urlId && item.description && (item.mode || 'code') === currentMode)
          .map(async (item) => {
            let status: ProjectStatus = 'saved';

            try {
              const snapshot = await getSnapshot(dbInstance, item.id);

              if (snapshot && snapshot.files && Object.keys(snapshot.files).length > 0) {
                const lastMsg = item.messages[item.messages.length - 1];

                if (lastMsg?.role === 'assistant' && lastMsg.content) {
                  const hasArtifact = lastMsg.content.includes('<palmkitArtifact');
                  const hasClose = lastMsg.content.includes('</palmkitArtifact>');

                  if (hasArtifact && !hasClose) {
                    status = 'interrupted';
                  }
                }
              }
            } catch {
              // ignore snapshot errors
            }

            return { ...item, status };
          }),
      );

      withStatus.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setProjects(withStatus);
    } catch (error) {
      toast.error('Failed to load projects');
      console.error(error);
    }
  }, []);

  /*
   * Reload on open AND whenever the tab changes — the drawer stays mounted
   * while the user taps Chat/Work/Code, so without `mode` in the dependency
   * list it would keep showing the previous tab's conversations.
   */
  useEffect(() => {
    if (open) {
      loadProjects();
    }
  }, [open, mode, loadProjects]);

  // Escape closes the drawer (it used to trap the user until they found the X).
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleOpenProject = (item: ChatHistoryItem) => {
    /*
     * ROOT FIX: Use the chat's mode for the URL prefix instead of
     * hardcoding '/chat/'. A chat saved in /work mode should open at
     * /work/<id>, not /chat/<id> — otherwise the URL-sync effect in
     * Chat.client.tsx resets sidebarMode to 'chat', corrupting the
     * chat's mode and making it appear in the wrong tab.
     */
    const mode = item.mode || 'code';
    const targetUrl = item.urlId ? `/${mode}/${item.urlId}` : `/${mode}/${item.id}`;
    navigate(targetUrl);
    onClose();
  };

  /*
   * Deleting goes through `deleteChatCompletely` — the same path the desktop
   * sidebar uses. The old local-only `deleteById` left the account-synced copy
   * in Supabase, so the chat reappeared on the next sync, and it also left the
   * snapshot, the locked-file entries and the running sandbox behind.
   */
  const handleConfirmDelete = async () => {
    const item = pendingDelete;
    setPendingDelete(null);

    if (!db || !item) {
      return;
    }

    const wasActive = chatId.get() === item.id;

    try {
      await deleteChatCompletely(db, item.id);
      toast.success('Conversation deleted');

      if (wasActive) {
        // Hard navigation so the chat/workbench stores start clean.
        window.location.pathname = `/${item.mode || 'code'}`;
      } else {
        await loadProjects();
      }
    } catch (error) {
      toast.error('Failed to delete conversation');
      console.error(error);
      await loadProjects();
    }
  };

  const handleTogglePin = useCallback(
    async (item: ChatHistoryItem) => {
      if (!db) {
        return;
      }

      try {
        await setChatPinned(db, item.id, !item.pinned);
        await loadProjects();
      } catch (error) {
        console.error('Failed to change pin state:', error);
        toast.error('Failed to pin conversation');
      }
    },
    [loadProjects],
  );

  /** Pinned section on top, then the usual date bins over what's left. */
  const sections = useMemo(() => {
    const { pinned, rest } = partitionPinned(projects);

    return [...(pinned.length ? [{ category: 'Pinned', items: pinned }] : []), ...binDates(rest)];
  }, [projects]);

  const handleNewProject = () => {
    navigate('/');
    onClose();
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    }

    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }

    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }

    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }

    return date.toLocaleDateString();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[998] bg-black/60 backdrop-blur-sm"
            variants={OVERLAY_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Drawer — left side panel, themed with the same classes as the desktop sidebar */}
          <motion.div
            className={classNames(
              'fixed left-0 top-0 bottom-0 z-[999] flex flex-col w-[85%] max-w-[340px]',
              'bg-white dark:bg-black border-r border-gray-200 dark:border-neutral-800',
              'rounded-r-2xl shadow-2xl',
            )}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            variants={DRAWER_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.9, right: 0 }}
            onDragEnd={(_e, info) => {
              /*
               * Design v2 touch spec: the panel follows the finger; a swipe
               * past 35% width OR a fast fling (>0.5 px/ms) closes it.
               */
              if (info.offset.x < -110 || info.velocity.x < -500) {
                onClose();
              }
            }}
          >
            {/* Brand + close */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <img src="/palmkit-mark.png" alt="" className="h-7 w-7 select-none dark:hidden pointer-events-none" />
                <img
                  src="/palmkit-mark-ondark.png"
                  alt=""
                  className="hidden h-7 w-7 select-none dark:block pointer-events-none"
                />
                <span className="text-[15px] font-semibold text-palmkit-elements-textPrimary">Palmkit</span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition active:scale-95 hover:text-gray-900 dark:hover:text-white"
              >
                <div className="i-ph:x text-base" />
              </button>
            </div>

            {/*
             * Chat / Work / Code segmented control.
             *
             * Uses Remix <Link> for SPA navigation — no full page reload, no
             * flicker, no "white flash" between tab switches. The URL changes
             * instantly and Remix swaps only the route's content, keeping the
             * sidebar and layout mounted.
             *
             * setSidebarMode is called onClick for instant visual feedback
             * (the active pill slides to the new tab) before Remix's route
             * transition completes.
             */}
            <div className="px-4">
              <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-neutral-900">
                {(['chat', 'work', 'code'] as SidebarMode[]).map((m) => (
                  <Link
                    key={m}
                    to={`/${m}`}
                    onClick={() => setSidebarMode(m)}
                    className={classNames(
                      'flex-1 rounded-lg py-1.5 text-[13px] font-semibold capitalize transition-all text-center',
                      mode === m
                        ? 'bg-white text-gray-900 shadow-sm dark:bg-neutral-800 dark:text-white'
                        : 'text-gray-400 dark:text-gray-500',
                    )}
                  >
                    {m}
                  </Link>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-0.5 px-3 pt-3">
              <button
                onClick={handleNewProject}
                className="flex w-full items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5 text-[14px] font-medium text-gray-900 transition active:bg-gray-100 dark:bg-neutral-900 dark:text-white dark:active:bg-neutral-800"
              >
                <span className="i-ph:plus-circle text-lg text-gray-500 dark:text-gray-400" />
                {mode === 'code' ? 'New Session' : 'New Chat'}
              </button>
              {SIDEBAR_QUICK_ACTIONS[mode].map((a) =>
                a.href ? (
                  <a
                    key={a.label}
                    href={a.href}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-gray-700 transition active:bg-gray-50 dark:text-gray-300 dark:active:bg-neutral-900"
                  >
                    <span className={classNames(a.icon, 'text-lg text-gray-400 dark:text-gray-500')} />
                    {a.label}
                  </a>
                ) : (
                  <button
                    key={a.label}
                    onClick={() => toast.info(`${a.label} — coming soon`)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] text-gray-700 transition active:bg-gray-50 dark:text-gray-300 dark:active:bg-neutral-900"
                  >
                    <span className={classNames(a.icon, 'text-lg text-gray-400 dark:text-gray-500')} />
                    <span className="flex-1">{a.label}</span>
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-neutral-800 dark:text-gray-500">
                      Soon
                    </span>
                  </button>
                ),
              )}
            </div>

            {/* Recent list */}
            <div className="mt-1 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-600">
                  <div className="i-ph:chats-circle mb-3 text-4xl opacity-40" />
                  <p className="text-sm">Nothing here yet</p>
                </div>
              ) : (
                sections.map(({ category, items }) => (
                  <div key={category} className="mb-1">
                    <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600">
                      {category}
                    </div>
                    {(items as ProjectItem[]).map((item) => (
                      <DrawerChatRow
                        key={item.id}
                        item={item}
                        onOpen={handleOpenProject}
                        onDelete={setPendingDelete}
                        onTogglePin={handleTogglePin}
                        onRenamed={loadProjects}
                        formatTime={formatTime}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Profile footer — opens settings / theme / account */}
            <div className="mt-auto border-t border-gray-100 px-3 py-3 dark:border-neutral-800">
              <ProfileMenu />
            </div>
          </motion.div>

          {/* Deletion is irreversible and wipes the cloud copy too, so it
              always goes through a confirmation step. */}
          <DialogRoot open={pendingDelete !== null}>
            <Dialog onBackdrop={() => setPendingDelete(null)} onClose={() => setPendingDelete(null)}>
              <div className="p-6 bg-white dark:bg-gray-950">
                <DialogTitle className="text-gray-900 dark:text-white">Delete conversation?</DialogTitle>
                <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                  <p>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {pendingDelete?.description || 'Untitled'}
                    </span>{' '}
                    will be removed from this device and from your account, along with its files. This cannot be undone.
                  </p>
                </DialogDescription>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                <DialogButton type="secondary" onClick={() => setPendingDelete(null)}>
                  Cancel
                </DialogButton>
                <DialogButton type="danger" onClick={handleConfirmDelete}>
                  Delete
                </DialogButton>
              </div>
            </Dialog>
          </DialogRoot>
        </>
      )}
    </AnimatePresence>
  );
});

ProjectSwitcherDrawer.displayName = 'ProjectSwitcherDrawer';
