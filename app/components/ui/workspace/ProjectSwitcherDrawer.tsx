import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from '@remix-run/react';
import { motion, useTransform } from 'framer-motion';
import { animateDrawer, drawerProgress, drawerWidth } from '~/lib/stores/drawerMotion';
import { toast } from 'react-toastify';
import { db, getAll, deleteChatCompletely, getSnapshot, type ChatHistoryItem } from '~/lib/persistence';
import { chatId } from '~/lib/persistence';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { binDates, partitionPinned } from '~/components/sidebar/date-binning';
import { ChatItemMenu } from '~/components/sidebar/ChatItemMenu';
import { renameChat, setChatPinned } from '~/lib/persistence/chatActions';
import { useLongPress } from '~/lib/hooks/useLongPress';
import { useProjectScope } from '~/lib/hooks/useProjectScope';
import { ProjectsSection } from '~/components/sidebar/ProjectsSection';
import { ProjectSheet, type MemoryMode } from '~/components/sidebar/ProjectSheet';
import {
  activeFolderIdStore,
  createFolder,
  deleteFolder,
  foldersStore,
  loadFolders,
  moveChatToFolder,
  renameFolder,
  setFolderInstructions,
  setFolderMemoryMode,
  type Folder,
} from '~/lib/stores/folders';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { sidebarModeStore, setSidebarMode, SIDEBAR_QUICK_ACTIONS, type SidebarMode } from '~/lib/stores/sidebar';
import { ProfileMenu } from '~/components/ui/ProfileMenu';

type ProjectStatus = 'saved' | 'generating' | 'interrupted';

interface ProjectItem extends ChatHistoryItem {
  status: ProjectStatus;
}

interface ProjectSwitcherDrawerProps {
  open: boolean;
  onClose: () => void;
}

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
  folders,
  onMoveToProject,
  onCreateProjectAndMove,
}: {
  item: ProjectItem;
  onOpen: (item: ChatHistoryItem) => void;
  onDelete: (item: ChatHistoryItem) => void;
  onTogglePin: (item: ChatHistoryItem) => void;
  onRenamed: () => void;
  formatTime: (t: string) => string;
  folders: Folder[];
  onMoveToProject: (item: ChatHistoryItem, folderId: string | undefined) => void;
  onCreateProjectAndMove: (item: ChatHistoryItem) => void;
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
        folders={folders}
        currentFolderId={item.folderId}
        onMoveToProject={(folderId) => onMoveToProject(item, folderId)}
        onCreateProjectAndMove={() => onCreateProjectAndMove(item)}
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
  const [pendingMoveItem, setPendingMoveItem] = useState<ChatHistoryItem | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<Folder | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetFolder, setSheetFolder] = useState<Folder | undefined>(undefined);
  const mode = useStore(sidebarModeStore);
  const folders = useStore(foldersStore);
  const activeFolderId = useStore(activeFolderIdStore);
  const { selectFolder } = useProjectScope();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery('');
  }, []);

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
      const folderId = activeFolderIdStore.get();

      const withStatus: ProjectItem[] = await Promise.all(
        chats
          .filter(
            (item) =>
              item.urlId &&
              item.description &&
              (item.mode || 'code') === currentMode &&
              (folderId === undefined || item.folderId === folderId),
          )
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
  }, [open, mode, activeFolderId, loadProjects]);

  useEffect(() => {
    if (open && db) {
      loadFolders(db);
    }
  }, [open]);

  /*
   * Push the app surface aside while the drawer is open (see `.pk-app-shell`
   * in index.scss) — the X / Twitter pattern: the conversation slides right
   * and stays partly visible instead of being covered over.
   *
   * Driven through a data attribute on <html> rather than React state,
   * because the shell is a SIBLING of this drawer in the route layout. It has
   * to be a sibling: a transform makes an element the containing block for
   * `position: fixed` descendants, so a drawer nested inside the shell would
   * be pushed along by the very transform it is causing.
   */
  useEffect(() => {
    const root = document.documentElement;

    if (open) {
      root.dataset.pkDrawer = 'open';
    } else {
      delete root.dataset.pkDrawer;
    }

    return () => {
      delete root.dataset.pkDrawer;
    };
  }, [open]);

  /*
   * Opening a project on a phone should also SHOW it — the drawer is covering
   * the very composer the project just scoped, so it slides away with the
   * selection. Leaving it open would make the tap look like it did nothing.
   */
  const openFolder = useCallback(
    (folderId: string | undefined) => {
      selectFolder(folderId);
      onClose();
    },
    [selectFolder, onClose],
  );

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const item of projects) {
      if (item.folderId) {
        counts[item.folderId] = (counts[item.folderId] ?? 0) + 1;
      }
    }

    return counts;
  }, [projects]);

  const handleMoveToProject = useCallback(
    async (item: ChatHistoryItem, folderId: string | undefined) => {
      if (!db) {
        return;
      }

      try {
        await moveChatToFolder(db, item.id, folderId);
        await loadProjects();

        const name = folderId ? folders.find((f) => f.id === folderId)?.name : undefined;
        toast.success(name ? `Moved to ${name}` : 'Removed from project');
      } catch (error) {
        console.error('Failed to move conversation:', error);
        toast.error('Failed to move conversation');
      }
    },
    [folders, loadProjects],
  );

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setSheetFolder(undefined);
    setPendingMoveItem(null);
  }, []);

  /**
   * Create or update a project from the sheet. When it was opened from a
   * conversation's "New project…", the conversation is filed into the new
   * project in the same step.
   */
  const submitSheet = useCallback(
    async (name: string, memoryMode: MemoryMode, instructions: string) => {
      if (!db) {
        return;
      }

      try {
        if (sheetFolder) {
          await renameFolder(db, sheetFolder.id, name);
          await setFolderMemoryMode(db, sheetFolder.id, memoryMode);
          await setFolderInstructions(db, sheetFolder.id, instructions);
          toast.success('Project updated');
        } else {
          const folder = await createFolder(db, name, memoryMode, instructions);

          if (folder && pendingMoveItem) {
            await moveChatToFolder(db, pendingMoveItem.id, folder.id);
            await loadProjects();
            toast.success(`Moved to ${folder.name}`);
          } else {
            toast.success('Project created');
          }
        }

        closeSheet();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save project');
      }
    },
    [sheetFolder, pendingMoveItem, loadProjects, closeSheet],
  );

  const handleOpenProject = (item: ChatHistoryItem) => {
    /*
     * ROOT FIX: Use the chat's mode for the URL prefix instead of
     * hardcoding '/chat/'. A chat saved in /work mode should open at
     * /work/<id>, not /chat/<id> — otherwise the URL-sync effect in
     * Chat.client.tsx resets sidebarMode to 'chat', corrupting the
     * chat's mode and making it appear in the wrong tab.
     */
    const mode = item.mode || 'code';

    // Carry the project through — see HistoryItem for why.
    const scope = item.folderId ? `?project=${item.folderId}` : '';
    navigate(`/${mode}/${item.urlId || item.id}${scope}`);
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

  const trimmedQuery = query.trim().toLowerCase();

  /**
   * Search runs over the conversations the drawer is already showing, so it
   * stays inside the current tab and the current project — the same scope
   * every other list in here uses. A hit that belongs to another tab would be
   * unreachable without silently switching tabs under the user.
   */
  const visible = useMemo(
    () =>
      trimmedQuery
        ? projects.filter((item) => (item.description || '').toLowerCase().includes(trimmedQuery))
        : projects,
    [projects, trimmedQuery],
  );

  /*
   * Pinned first, then the usual date bins — except while searching, where a
   * flat list of hits is the answer to the question being asked. Splitting six
   * results across "Today / Yesterday / Last 30 days" buries them.
   */
  const sections = useMemo(() => {
    if (trimmedQuery) {
      return visible.length ? [{ category: `${visible.length} found`, items: visible }] : [];
    }

    const { pinned, rest } = partitionPinned(visible);

    return [...(pinned.length ? [{ category: 'Pinned', items: pinned }] : []), ...binDates(rest)];
  }, [visible, trimmedQuery]);

  const handleNewProject = () => {
    /*
     * Stay in the current tab AND in the current project. `navigate('/')` sent
     * the user back to the landing route, which silently dropped both — a new
     * conversation started from inside a project would have been created
     * outside it.
     */
    navigate(activeFolderId ? `/${mode}?project=${activeFolderId}` : `/${mode}`);
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

  /*
   * The drawer stays MOUNTED and is positioned from `drawerProgress`, rather
   * than being conditionally rendered with its own entry animation. A
   * drag-to-open has to be able to pull a panel that already exists — if it
   * mounted on open there would be nothing under the finger to pull, and the
   * gesture could only ever be a fling that triggers a separate animation.
   */
  const width = typeof window === 'undefined' ? 300 : drawerWidth();

  /*
   * The drawer barely moves — it sits UNDER the conversation and is revealed
   * as that slides away, which is what the reference does. A small counter
   * translate gives the parallax that stops the two layers looking glued
   * together; sliding the panel the full width made it race the conversation.
   */
  const x = useTransform(drawerProgress, [0, 1], [-width * 0.18, 0]);

  /* Dimmed while it is still covered, lifting to full strength as it appears. */
  const dim = useTransform(drawerProgress, [0, 1], [0.45, 0]);
  const pointerEvents = useTransform(drawerProgress, (v) => (v > 0.02 ? 'auto' : 'none'));

  // Keep the panel in step when open/close comes from a button rather than a drag.
  useEffect(() => {
    animateDrawer(open ? 1 : 0);

    /*
     * The panel stays mounted, so a search left running would still be there
     * — and still filtering — the next time it opens, which reads as "half my
     * conversations are gone".
     */
    if (!open) {
      closeSearch();
    }
  }, [open, closeSearch]);

  return (
    <>
      {
        <>
          {/* Drawer — left side panel, themed with the same classes as the
              desktop sidebar.

              z-0 is load-bearing: this panel lives BENEATH the conversation
              and is revealed as that slides away. AppShell is the sheet on
              top, and it has to cover this one completely while closed —
              at rest the drawer is only pulled back by its parallax offset,
              so most of it is still on screen. */}
          <motion.div
            className={classNames('fixed left-0 top-0 bottom-0 z-0 flex flex-col', 'bg-white dark:bg-black')}
            style={{
              x,
              pointerEvents,
              width,
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            {/* Scrim over the drawer while the conversation still covers it. */}
            <motion.div className="pointer-events-none absolute inset-0 z-50 bg-black" style={{ opacity: dim }} />

            {/*
             * Brand + search.
             *
             * Search sits where the close button used to. The drawer already
             * has two ways to dismiss it — drag it back, or tap the strip of
             * conversation still showing — so the corner was spending itself
             * on something the panel could already do, while the one thing it
             * could not do was find a conversation. While the field is open
             * the same button becomes the way out of it.
             */}
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
                onClick={() => (searching ? closeSearch() : setSearching(true))}
                aria-label={searching ? 'Close search' : 'Search conversations'}
                aria-expanded={searching}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition active:scale-95 hover:text-gray-900 dark:hover:text-white"
              >
                <div className={classNames('text-base', searching ? 'i-ph:x' : 'i-ph:magnifying-glass')} />
              </button>
            </div>

            {searching && (
              <div className="px-4 pb-2">
                {/* The field's 16px text size is deliberate: iOS zooms the
                    whole page in when it focuses anything smaller. */}
                <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 dark:bg-neutral-900">
                  <span className="i-ph:magnifying-glass h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                    placeholder="Search conversations"
                    aria-label="Search conversations"
                    className="min-w-0 flex-1 bg-transparent text-[16px] text-palmkit-elements-textPrimary outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                  {query && (
                    <button
                      onClick={() => setQuery('')}
                      aria-label="Clear search"
                      className="i-ph:x-circle-fill h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
                    />
                  )}
                </div>
              </div>
            )}

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
                    to={activeFolderId ? `/${m}?project=${activeFolderId}` : `/${m}`}
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

            {/*
             * Actions and Projects step aside once a query is typed. The
             * results are what the user is looking at now, and on a phone
             * these two blocks push most of them below the fold.
             */}
            {!trimmedQuery && (
              <>
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

                <ProjectsSection
                  compact
                  folders={folders}
                  counts={folderCounts}
                  activeFolderId={activeFolderId}
                  onSelect={openFolder}
                  onNew={() => {
                    setSheetFolder(undefined);
                    setPendingMoveItem(null);
                    setSheetOpen(true);
                  }}
                  onOpenSettings={(folder) => {
                    setSheetFolder(folder);
                    setPendingMoveItem(null);
                    setSheetOpen(true);
                  }}
                  onDelete={setPendingDeleteFolder}
                />
              </>
            )}

            {/* Recent list */}
            <div className="mt-1 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
              {visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-600">
                  <div
                    className={classNames(
                      'mb-3 text-4xl opacity-40',
                      trimmedQuery ? 'i-ph:magnifying-glass' : 'i-ph:chats-circle',
                    )}
                  />
                  <p className="px-6 text-center text-sm">
                    {trimmedQuery ? `No conversations match “${query.trim()}”` : 'Nothing here yet'}
                  </p>
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
                        folders={folders}
                        onMoveToProject={handleMoveToProject}
                        onCreateProjectAndMove={(item) => {
                          setPendingMoveItem(item);
                          setSheetFolder(undefined);
                          setSheetOpen(true);
                        }}
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

          <ProjectSheet
            open={sheetOpen}
            folder={sheetFolder}
            movingLabel={sheetFolder ? undefined : (pendingMoveItem?.description ?? undefined)}
            onClose={closeSheet}
            onSubmit={submitSheet}
          />

          <DialogRoot open={pendingDeleteFolder !== null}>
            <Dialog onBackdrop={() => setPendingDeleteFolder(null)} onClose={() => setPendingDeleteFolder(null)}>
              <div className="p-6 bg-white dark:bg-gray-950">
                <DialogTitle className="text-gray-900 dark:text-white">Delete project?</DialogTitle>
                <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                  <p>
                    <span className="font-medium text-gray-900 dark:text-white">{pendingDeleteFolder?.name}</span> will
                    be removed. Its conversations are <span className="font-medium">not</span> deleted — they go back to
                    the main list.
                  </p>
                </DialogDescription>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                <DialogButton type="secondary" onClick={() => setPendingDeleteFolder(null)}>
                  Cancel
                </DialogButton>
                <DialogButton
                  type="danger"
                  onClick={async () => {
                    const folder = pendingDeleteFolder;
                    setPendingDeleteFolder(null);

                    if (!db || !folder) {
                      return;
                    }

                    try {
                      const detached = await deleteFolder(db, folder.id);
                      selectFolder(undefined);
                      await loadProjects();
                      toast.success(
                        detached > 0
                          ? `Project deleted — ${detached} conversation${detached === 1 ? '' : 's'} kept`
                          : 'Project deleted',
                      );
                    } catch (error) {
                      console.error('Failed to delete project:', error);
                      toast.error('Failed to delete project');
                    }
                  }}
                >
                  Delete project
                </DialogButton>
              </div>
            </Dialog>
          </DialogRoot>

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
      }
    </>
  );
});

ProjectSwitcherDrawer.displayName = 'ProjectSwitcherDrawer';
