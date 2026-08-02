import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from '@remix-run/react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { ControlPanel } from '~/components/@settings/core/ControlPanel';
import { HelpButton } from '~/components/ui/SettingsButton';
import { Button } from '~/components/ui/Button';
import { db, deleteChatCompletely, getAll, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { cubicEasingFn } from '~/utils/easings';
import { HistoryItem } from './HistoryItem';
import { binDates, partitionPinned } from './date-binning';
import { setChatPinned } from '~/lib/persistence/chatActions';
import { ProjectsSection } from './ProjectsSection';
import { ProjectSheet, type MemoryMode } from './ProjectSheet';
import {
  activeFolderIdStore,
  createFolder,
  deleteFolder,
  foldersStore,
  loadFolders,
  moveChatToFolder,
  renameFolder,
  setFolderMemoryMode,
  type Folder,
} from '~/lib/stores/folders';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { profileStore } from '~/lib/stores/profile';
import { authUserStore } from '~/lib/stores/auth';
import {
  sidebarOpenStore,
  syncSidebarLayoutVar,
  sidebarModeStore,
  setSidebarMode,
  SIDEBAR_QUICK_ACTIONS,
  type SidebarMode,
} from '~/lib/stores/sidebar';
import { ConnectorsPanel } from './ConnectorsPanel';

/*
 * Open/close animates a TRANSFORM, not `left`, and no longer cross-fades.
 *
 * The previous variants animated `left` from -340px to 0 while also animating
 * `opacity` 0 → 1. Animating `left` re-runs layout on every frame, and the
 * opacity ramp meant the panel was painted semi-transparent over the chat
 * behind it — together they produced the flicker the user sees each time the
 * sidebar opens or closes. `x` is compositor-only, so the panel slides in one
 * smooth pass at full opacity.
 *
 * `visibility` still flips so the closed panel can't be tabbed into or steal
 * pointer events — delayed by the slide duration so the panel stays painted
 * while it animates out, and applied immediately when it animates in.
 */
const menuVariants = {
  closed: {
    x: '-100%',
    visibility: 'hidden',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
      visibility: { delay: 0.2 },
    },
  },
  open: {
    x: 0,
    visibility: 'visible',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent =
  | { type: 'delete'; item: ChatHistoryItem }
  | { type: 'bulkDelete'; items: ChatHistoryItem[] }
  | null;

function CurrentDateTime() {
  const [dateTime, setDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/50">
      <div className="h-4 w-4 i-ph:clock opacity-80" />
      <div className="flex gap-2">
        <span>{dateTime.toLocaleDateString()}</span>
        <span>{dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

export const Menu = () => {
  const { duplicateCurrentChat, exportChat } = useChatHistory();
  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ChatHistoryItem[]>([]);

  /*
   * The sidebar's open state lives in a shared store so the Header toggle can
   * drive it. On desktop it defaults to open and PUSHES the layout via the
   * `--sidebar-width` CSS variable (see syncSidebarLayoutVar) — previously the
   * fixed panel simply overlapped the composer and workbench. On mobile it
   * stays closed (the hamburger opens the ProjectSwitcherDrawer instead).
   */
  const open = useStore(sidebarOpenStore);
  const setOpen = (v: boolean) => sidebarOpenStore.set(v);

  useEffect(() => {
    syncSidebarLayoutVar();

    const onResize = () => syncSidebarLayoutVar();
    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'mcp' | 'github' | undefined>(undefined);
  const [isConnectorsOpen, setIsConnectorsOpen] = useState(false);
  const profile = useStore(profileStore);
  const authUser = useStore(authUserStore);
  const mode = useStore(sidebarModeStore);
  const folders = useStore(foldersStore);
  const activeFolderId = useStore(activeFolderIdStore);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectionMode, setSelectionMode] = useState(false);
  const [pendingMoveItem, setPendingMoveItem] = useState<ChatHistoryItem | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<Folder | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetFolder, setSheetFolder] = useState<Folder | undefined>(undefined);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  const { filteredItems: filteredList, handleSearchChange } = useSearchFilter({
    items: list,
    searchFields: ['description'],
  });

  /** Pinned section on top, then the usual date bins over what's left. */
  const sections = useMemo(() => {
    const { pinned, rest } = partitionPinned(filteredList);

    return [...(pinned.length ? [{ category: 'Pinned', items: pinned }] : []), ...binDates(rest)];
  }, [filteredList]);

  const loadEntries = useCallback(() => {
    void db;

    /*
     * Filter conversations by the current sidebar mode (chat/work/code).
     * Existing conversations without a mode default to 'code' (backward compat).
     */
    const filterByMode = (list: ChatHistoryItem[]) => {
      const currentMode = sidebarModeStore.get();

      /*
       * Two independent filters. `mode` is which TAB the conversation lives
       * in; `folderId` is which PROJECT it belongs to. A project spans all
       * three tabs, so scoping to one never overrides the tab filter — you
       * see that project's conversations for the tab you are on.
       */
      const folderId = activeFolderIdStore.get();

      return list.filter(
        (item) =>
          item.urlId &&
          item.description &&
          (item.mode || 'code') === currentMode &&
          (folderId === undefined || item.folderId === folderId),
      );
    };

    if (db) {
      getAll(db)
        .then((list) => filterByMode(list))
        .then(setList)
        .catch((error) => toast.error(error.message));

      return;
    }

    import('~/lib/persistence/db')
      .then(({ openDatabase }) => openDatabase())
      .then((dbInstance) => {
        if (!dbInstance) {
          return undefined;
        }

        return getAll(dbInstance).then((list) => setList(filterByMode(list)));
      })
      .catch((error) => toast.error(error.message));
  }, [db]);

  const deleteChat = useCallback(async (id: string): Promise<void> => {
    if (!db) {
      throw new Error('Database not available');
    }

    // Shared with the mobile drawer — see deleteChatCompletely for what it clears.
    await deleteChatCompletely(db, id);
  }, []);

  const deleteItem = useCallback(
    (event: React.UIEvent, item: ChatHistoryItem) => {
      event.preventDefault();
      event.stopPropagation();

      // Log the delete operation to help debugging
      console.log('Attempting to delete chat:', { id: item.id, description: item.description });

      deleteChat(item.id)
        .then(() => {
          toast.success('Chat deleted successfully', {
            position: 'bottom-right',
            autoClose: 3000,
          });

          // Always refresh the list
          loadEntries();

          if (chatId.get() === item.id) {
            // hard page navigation to clear the stores
            console.log('Navigating away from deleted chat');
            window.location.pathname = '/';
          }
        })
        .catch((error) => {
          console.error('Failed to delete chat:', error);
          toast.error('Failed to delete conversation', {
            position: 'bottom-right',
            autoClose: 3000,
          });

          // Still try to reload entries in case data has changed
          loadEntries();
        });
    },
    [loadEntries, deleteChat],
  );

  const deleteSelectedItems = useCallback(
    async (itemsToDeleteIds: string[]) => {
      if (!db || itemsToDeleteIds.length === 0) {
        console.log('Bulk delete skipped: No DB or no items to delete.');
        return;
      }

      console.log(`Starting bulk delete for ${itemsToDeleteIds.length} chats`, itemsToDeleteIds);

      let deletedCount = 0;
      const errors: string[] = [];
      const currentChatId = chatId.get();
      let shouldNavigate = false;

      // Process deletions sequentially using the shared deleteChat logic
      for (const id of itemsToDeleteIds) {
        try {
          await deleteChat(id);
          deletedCount++;

          if (id === currentChatId) {
            shouldNavigate = true;
          }
        } catch (error) {
          console.error(`Error deleting chat ${id}:`, error);
          errors.push(id);
        }
      }

      // Show appropriate toast message
      if (errors.length === 0) {
        toast.success(`${deletedCount} chat${deletedCount === 1 ? '' : 's'} deleted successfully`);
      } else {
        toast.warning(`Deleted ${deletedCount} of ${itemsToDeleteIds.length} chats. ${errors.length} failed.`, {
          autoClose: 5000,
        });
      }

      // Reload the list after all deletions
      await loadEntries();

      // Clear selection state
      setSelectedItems([]);
      setSelectionMode(false);

      // Navigate if needed
      if (shouldNavigate) {
        console.log('Navigating away from deleted chat');
        window.location.pathname = '/';
      }
    },
    [deleteChat, loadEntries, db],
  );

  const closeDialog = () => {
    setDialogContent(null);
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);

    if (selectionMode) {
      // If turning selection mode OFF, clear selection
      setSelectedItems([]);
    }
  };

  const toggleItemSelection = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const newSelectedItems = prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id];
      console.log('Selected items updated:', newSelectedItems);

      return newSelectedItems; // Return the new array
    });
  }, []); // No dependencies needed

  const handleBulkDeleteClick = useCallback(() => {
    if (selectedItems.length === 0) {
      toast.info('Select at least one chat to delete');
      return;
    }

    const selectedChats = list.filter((item) => selectedItems.includes(item.id));

    if (selectedChats.length === 0) {
      toast.error('Could not find selected chats');
      return;
    }

    setDialogContent({ type: 'bulkDelete', items: selectedChats });
  }, [selectedItems, list]); // Keep list dependency

  const selectAll = useCallback(() => {
    const allFilteredIds = filteredList.map((item) => item.id);
    setSelectedItems((prev) => {
      const allFilteredAreSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => prev.includes(id));

      if (allFilteredAreSelected) {
        // Deselect only the filtered items
        const newSelectedItems = prev.filter((id) => !allFilteredIds.includes(id));
        console.log('Deselecting all filtered items. New selection:', newSelectedItems);

        return newSelectedItems;
      } else {
        // Select all filtered items, adding them to any existing selections
        const newSelectedItems = [...new Set([...prev, ...allFilteredIds])];
        console.log('Selecting all filtered items. New selection:', newSelectedItems);

        return newSelectedItems;
      }
    });
  }, [filteredList]); // Depends only on filteredList

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    loadEntries();

    /*
     * KEEP THE LIST FRESH. The desktop sidebar is persistently open, so the
     * old "load once when opened" behavior meant new chats never appeared
     * ("No previous conversations" while three builds were running). Re-read
     * on window focus and on a light poll while open.
     */
    const onFocus = () => loadEntries();
    window.addEventListener('focus', onFocus);

    const interval = setInterval(loadEntries, 15_000);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [open, loadEntries]);

  /*
   * Reload conversations when sidebar mode changes (chat/work/code)
   * Small delay ensures the store has updated before filtering
   */
  useEffect(() => {
    const timer = setTimeout(() => loadEntries(), 100);

    return () => clearTimeout(timer);
  }, [mode, activeFolderId, loadEntries]);

  /*
   * The URL owns the project scope, not component state — so it survives a
   * reload, a tab switch, and opening a conversation inside the project.
   */
  useEffect(() => {
    activeFolderIdStore.set(searchParams.get('project') ?? undefined);
  }, [searchParams]);

  useEffect(() => {
    if (db) {
      loadFolders(db);
    }
  }, []);

  const selectFolder = useCallback(
    (folderId: string | undefined) => {
      const params = new URLSearchParams(window.location.search);

      if (folderId) {
        params.set('project', folderId);
      } else {
        params.delete('project');
      }

      const qs = params.toString();
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: true, preventScrollReset: true });
    },
    [navigate],
  );

  /** Counts are per-tab, matching what selecting the project will show. */
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const item of list) {
      if (item.folderId) {
        counts[item.folderId] = (counts[item.folderId] ?? 0) + 1;
      }
    }

    return counts;
  }, [list]);

  const handleMoveToProject = useCallback(
    async (item: ChatHistoryItem, folderId: string | undefined) => {
      if (!db) {
        return;
      }

      try {
        await moveChatToFolder(db, item.id, folderId);
        loadEntries();

        const name = folderId ? folders.find((f) => f.id === folderId)?.name : undefined;
        toast.success(name ? `Moved to ${name}` : 'Removed from project');
      } catch (error) {
        console.error('Failed to move conversation:', error);
        toast.error('Failed to move conversation');
      }
    },
    [folders, loadEntries],
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
    async (name: string, memoryMode: MemoryMode) => {
      if (!db) {
        return;
      }

      try {
        if (sheetFolder) {
          await renameFolder(db, sheetFolder.id, name);
          await setFolderMemoryMode(db, sheetFolder.id, memoryMode);
          toast.success('Project updated');
        } else {
          const folder = await createFolder(db, name, memoryMode);

          if (folder && pendingMoveItem) {
            await moveChatToFolder(db, pendingMoveItem.id, folder.id);
            loadEntries();
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
    [sheetFolder, pendingMoveItem, loadEntries, closeSheet],
  );

  const handleCreateProjectAndMove = useCallback(async (item: ChatHistoryItem) => {
    if (!db) {
      return;
    }

    setPendingMoveItem(item);
  }, []);

  // Exit selection mode when sidebar is closed
  useEffect(() => {
    if (!open && selectionMode) {
      /*
       * Don't clear selection state anymore when sidebar closes
       * This allows the selection to persist when reopening the sidebar
       */
      console.log('Sidebar closed, preserving selection state');
    }
  }, [open, selectionMode]);

  /*
   * The old mobile hover-to-open (mousemove at the left edge) is gone: mobile
   * uses the hamburger → ProjectSwitcherDrawer, and on desktop the Header
   * toggle + persistent panel replace edge-hovering.
   */

  /*
   * Pinning is per-tab by construction: a conversation has exactly one mode,
   * so it only appears in that one tab's list and the flag can only ever
   * reorder it there.
   */
  const handleTogglePin = useCallback(
    async (item: ChatHistoryItem) => {
      if (!db) {
        return;
      }

      try {
        await setChatPinned(db, item.id, !item.pinned);
        loadEntries();
      } catch (error) {
        console.error('Failed to change pin state:', error);
        toast.error('Failed to pin conversation');
      }
    },
    [loadEntries],
  );

  const handleDuplicate = async (id: string) => {
    await duplicateCurrentChat(id);
    loadEntries(); // Reload the list after duplication
  };

  const handleSettingsClick = () => {
    setSettingsTab(undefined);
    setIsSettingsOpen(true);
    setOpen(false);
  };

  const openConnections = (tab: 'mcp' | 'github') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  const handleSettingsClose = () => {
    setIsSettingsOpen(false);
  };

  const setDialogContentWithLogging = useCallback((content: DialogContent) => {
    console.log('Setting dialog content:', content);
    setDialogContent(content);
  }, []);

  /*
   * `initial={open ? 'open' : 'closed'}` (rather than a constant "closed")
   * keeps the panel from replaying its slide-in on mount: it starts in
   * whatever state the store says it is already in. `animate` still drives
   * the real open/close transitions.
   *
   * This alone was not enough while the sidebar lived inside the keyed
   * <ChatImpl> subtree — a tab switch unmounted it, and a fresh mount has no
   * DOM to keep. It is now rendered by PersistentChrome, outside that subtree,
   * so a tab switch does not touch it at all.
   */
  return (
    <>
      <motion.div
        ref={menuRef}
        initial={open ? 'open' : 'closed'}
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        style={{ width: '340px', left: 0 }}
        className={classNames(
          'flex selection-accent flex-col side-menu fixed top-0 h-full rounded-r-2xl',
          'bg-white dark:bg-black border-r border-palmkit-elements-borderColor',
          'shadow-sm text-sm',
          isSettingsOpen ? 'z-40' : 'z-sidebar',
        )}
      >
        {/* Left padding clears the floating glass sidebar-toggle that overlays
            the top-left corner, so the brand mark isn't hidden behind it. */}
        <div className="h-12 flex items-center justify-between pl-14 pr-3 border-b border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-black rounded-tr-2xl">
          <div className="flex items-center gap-2">
            <img src="/palmkit-mark.png" alt="" className="w-6 h-6 object-contain dark:hidden" />
            <img src="/palmkit-mark-ondark.png" alt="" className="hidden w-6 h-6 object-contain dark:block" />
            <span className="font-semibold text-sm text-gray-900 dark:text-white">Palmkit</span>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton onClick={() => window.open('https://palmkit.app/', '_blank')} />
            <ThemeSwitch />
          </div>
        </div>
        <CurrentDateTime />
        <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
          <div className="p-4 space-y-3">
            {/*
             * Chat / Work / Code — navigates to the corresponding route.
             *
             * Uses Remix <Link> for SPA navigation — no full page reload, no
             * flicker. The URL changes instantly and Remix swaps only the
             * route's content while keeping the sidebar/layout mounted.
             *
             * setSidebarMode is called onClick for instant visual feedback
             * (active pill slides) before Remix's route transition completes.
             */}
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

            {/* Primary action (label varies by mode) + selection toggle. */}
            <div className="flex gap-2">
              <a
                href={activeFolderId ? `/${mode}?project=${activeFolderId}` : `/${mode}`}
                className="flex-1 flex gap-2 items-center bg-gray-50 dark:bg-gray-500/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-500/20 rounded-lg px-4 py-2 transition-colors"
              >
                <span className="inline-block i-ph:plus-circle h-4 w-4" />
                <span className="text-sm font-medium">{mode === 'code' ? 'New Session' : 'New Chat'}</span>
              </a>
              <button
                onClick={toggleSelectionMode}
                className={classNames(
                  'flex gap-1 items-center rounded-lg px-3 py-2 transition-colors',
                  selectionMode
                    ? 'bg-gray-800 dark:bg-gray-200 text-white border border-gray-700 dark:border-gray-600'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700',
                )}
                aria-label={selectionMode ? 'Exit selection mode' : 'Enter selection mode'}
              >
                <span className={selectionMode ? 'i-ph:x h-4 w-4' : 'i-ph:check-square h-4 w-4'} />
              </button>
            </div>

            {/* Per-tab quick actions. Context opens the Connectors panel;
                My Builds (Code) links to build history; others show 'Soon'. */}
            <div className="flex flex-col gap-0.5">
              {SIDEBAR_QUICK_ACTIONS[mode].map((a) =>
                a.href ? (
                  <a
                    key={a.label}
                    href={a.href}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors"
                  >
                    <span className={classNames(a.icon, 'h-4 w-4 text-gray-500 dark:text-gray-400')} />
                    {a.label}
                  </a>
                ) : a.label === 'Context' ? (
                  <button
                    key={a.label}
                    onClick={() => setIsConnectorsOpen(true)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors text-left"
                  >
                    <span className={classNames(a.icon, 'h-4 w-4 text-gray-500 dark:text-gray-400')} />
                    <span className="flex-1">{a.label}</span>
                  </button>
                ) : (
                  <button
                    key={a.label}
                    onClick={() => toast.info(`${a.label} — coming soon`)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors text-left"
                  >
                    <span className={classNames(a.icon, 'h-4 w-4 text-gray-500 dark:text-gray-400')} />
                    <span className="flex-1">{a.label}</span>
                    <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-600">
                      Soon
                    </span>
                  </button>
                ),
              )}
            </div>
            <div className="relative w-full">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <span className="i-ph:magnifying-glass h-4 w-4 text-gray-400 dark:text-gray-500" />
              </div>
              <input
                className="w-full bg-gray-50 dark:bg-gray-900 relative pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-500/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-800"
                type="search"
                placeholder="Search chats..."
                onChange={handleSearchChange}
                aria-label="Search chats"
              />
            </div>
          </div>
          <ProjectsSection
            folders={folders}
            counts={folderCounts}
            activeFolderId={activeFolderId}
            onSelect={selectFolder}
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

          {/* Connections — MCP tools + service integrations, above the chat list */}
          <div className="px-4 pb-1">
            <div className="text-sm font-medium text-gray-600 dark:text-gray-400 pb-1.5">Connections</div>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => openConnections('mcp')}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors text-left"
              >
                <span className="i-ph:plugs-connected h-4 w-4 text-gray-500 dark:text-gray-400" />
                MCP Tools
              </button>
              <button
                onClick={() => openConnections('github')}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors text-left"
              >
                <span className="i-ph:git-branch h-4 w-4 text-gray-500 dark:text-gray-400" />
                Integrations
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm px-4 py-2 border-t border-gray-100 dark:border-gray-800/50 mt-1">
            <div className="font-medium text-gray-600 dark:text-gray-400">Your Chats</div>
            {selectionMode && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  {selectedItems.length === filteredList.length ? 'Deselect all' : 'Select all'}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDeleteClick}
                  disabled={selectedItems.length === 0}
                >
                  Delete selected
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto px-3 pb-3">
            {filteredList.length === 0 && (
              <div className="px-4 text-gray-500 dark:text-gray-400 text-sm">
                {list.length === 0 ? 'No previous conversations' : 'No matches found'}
              </div>
            )}
            <DialogRoot open={dialogContent !== null}>
              {sections.map(({ category, items }) => (
                <div key={category} className="mt-2 first:mt-0 space-y-1">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 sticky top-0 z-1 bg-white dark:bg-gray-950 px-4 py-1">
                    {category}
                  </div>
                  <div className="space-y-0.5 pr-1">
                    {items.map((item) => (
                      <HistoryItem
                        key={item.id}
                        item={item}
                        exportChat={exportChat}
                        onDelete={() => setDialogContentWithLogging({ type: 'delete', item })}
                        onDuplicate={() => handleDuplicate(item.id)}
                        onTogglePin={handleTogglePin}
                        folders={folders}
                        onMoveToProject={handleMoveToProject}
                        onCreateProjectAndMove={handleCreateProjectAndMove}
                        selectionMode={selectionMode}
                        isSelected={selectedItems.includes(item.id)}
                        onToggleSelection={toggleItemSelection}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
                {dialogContent?.type === 'delete' && (
                  <>
                    <div className="p-6 bg-white dark:bg-gray-950">
                      <DialogTitle className="text-gray-900 dark:text-white">Delete Chat?</DialogTitle>
                      <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                        <p>
                          You are about to delete{' '}
                          <span className="font-medium text-gray-900 dark:text-white">
                            {dialogContent.item.description}
                          </span>
                        </p>
                        <p className="mt-2">Are you sure you want to delete this chat?</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Cancel
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={(event) => {
                          console.log('Dialog delete button clicked for item:', dialogContent.item);
                          deleteItem(event, dialogContent.item);
                          closeDialog();
                        }}
                      >
                        Delete
                      </DialogButton>
                    </div>
                  </>
                )}
                {dialogContent?.type === 'bulkDelete' && (
                  <>
                    <div className="p-6 bg-white dark:bg-gray-950">
                      <DialogTitle className="text-gray-900 dark:text-white">Delete Selected Chats?</DialogTitle>
                      <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                        <p>
                          You are about to delete {dialogContent.items.length}{' '}
                          {dialogContent.items.length === 1 ? 'chat' : 'chats'}:
                        </p>
                        <div className="mt-2 max-h-32 overflow-auto border border-gray-100 dark:border-gray-800 rounded-md bg-gray-50 dark:bg-gray-900 p-2">
                          <ul className="list-disc pl-5 space-y-1">
                            {dialogContent.items.map((item) => (
                              <li key={item.id} className="text-sm">
                                <span className="font-medium text-gray-900 dark:text-white">{item.description}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <p className="mt-3">Are you sure you want to delete these chats?</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Cancel
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={() => {
                          /*
                           * Pass the current selectedItems to the delete function.
                           * This captures the state at the moment the user confirms.
                           */
                          const itemsToDeleteNow = [...selectedItems];
                          console.log('Bulk delete confirmed for', itemsToDeleteNow.length, 'items', itemsToDeleteNow);
                          deleteSelectedItems(itemsToDeleteNow);
                          closeDialog();
                        }}
                      >
                        Delete
                      </DialogButton>
                    </div>
                  </>
                )}
              </Dialog>
            </DialogRoot>
          </div>
          {/* Account card — profile + settings live together at the bottom */}
          <div className="border-t border-gray-200 dark:border-gray-800 p-3">
            <button
              onClick={handleSettingsClick}
              className="w-full flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-800/60 p-2.5 transition-colors text-left"
              aria-label="Open settings and profile"
            >
              <div className="flex items-center justify-center w-9 h-9 overflow-hidden bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-full shrink-0 ring-1 ring-gray-200 dark:ring-gray-700">
                {profile?.avatar ? (
                  <img
                    src={profile.avatar}
                    alt={profile?.username || 'User'}
                    className="w-full h-full object-cover"
                    loading="eager"
                    decoding="sync"
                  />
                ) : (
                  <div className="i-ph:user-fill text-lg" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {profile?.username || authUser?.name || 'Guest User'}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {authUser?.email || 'Settings & profile'}
                </p>
              </div>
              <div className="i-ph:gear-six text-lg text-gray-400 dark:text-gray-500 shrink-0" />
            </button>
          </div>
        </div>
      </motion.div>

      {/* "New project…" from a conversation's Move-to-project submenu:
          create the project and move the conversation in one step. */}
      {/*
        One sheet serves both "New project" and "Project settings", and both
        entry points into creating one — the Projects list and a conversation's
        Move-to-project → New project…
      */}
      <ProjectSheet
        open={sheetOpen}
        folder={sheetFolder}
        movingLabel={sheetFolder ? undefined : (pendingMoveItem?.description ?? undefined)}
        onClose={closeSheet}
        onSubmit={submitSheet}
      />

      {/* Deleting a project keeps its conversations — they return to the
          ungrouped list. The copy says so, because "Delete project" reads
          like it destroys everything inside. */}
      <DialogRoot open={pendingDeleteFolder !== null}>
        <Dialog onBackdrop={() => setPendingDeleteFolder(null)} onClose={() => setPendingDeleteFolder(null)}>
          <div className="p-6 bg-white dark:bg-gray-950">
            <DialogTitle className="text-gray-900 dark:text-white">Delete project?</DialogTitle>
            <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
              <p>
                <span className="font-medium text-gray-900 dark:text-white">{pendingDeleteFolder?.name}</span> will be
                removed. Its conversations are <span className="font-medium">not</span> deleted — they go back to the
                main list.
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
                  loadEntries();
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

      <ControlPanel open={isSettingsOpen} onClose={handleSettingsClose} initialTab={settingsTab} />

      <ConnectorsPanel open={isConnectorsOpen} onClose={() => setIsConnectorsOpen(false)} />
    </>
  );
};
