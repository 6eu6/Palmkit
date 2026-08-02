import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { db, getAll, type ChatHistoryItem } from '~/lib/persistence';
import { sidebarModeStore } from '~/lib/stores/sidebar';
import {
  activeFolderIdStore,
  foldersStore,
  loadFolders,
  renameFolder,
  setFolderInstructions,
  setFolderMemoryMode,
} from '~/lib/stores/folders';
import { ProjectSheet, type MemoryMode } from '~/components/sidebar/ProjectSheet';
import { classNames } from '~/utils/classNames';

/** Conversations listed under the composer before "Show all". */
const COLLAPSED_COUNT = 5;

/**
 * The project workspace — what you land on when you open a project.
 *
 * It replaces the generic "Hi there, what are we building today?" intro with
 * the project's own identity, and it sits directly above the normal composer.
 * That is the whole point: the box you type into here starts a conversation
 * INSIDE the project (see `setMessages`, which seeds a new record with the
 * active project), so a project holds as many conversations as you like rather
 * than being a single long thread.
 *
 * Its conversations are listed underneath, scoped to the current tab — a
 * project spans Chat/Work/Code, but you only ever see the tab you are on, so
 * the list agrees with the sidebar.
 */
export function ProjectHome() {
  const navigate = useNavigate();
  const folders = useStore(foldersStore);
  const activeFolderId = useStore(activeFolderIdStore);
  const mode = useStore(sidebarModeStore);
  const [chats, setChats] = useState<ChatHistoryItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const folder = useMemo(() => folders.find((f) => f.id === activeFolderId), [folders, activeFolderId]);

  useEffect(() => {
    if (db && !folders.length) {
      void loadFolders(db);
    }
  }, [folders.length]);

  const load = useCallback(async () => {
    if (!db || !activeFolderId) {
      setChats([]);
      return;
    }

    try {
      const all = await getAll(db);
      const currentMode = sidebarModeStore.get();

      setChats(
        all
          .filter(
            (item) =>
              item.urlId &&
              item.description &&
              item.folderId === activeFolderId &&
              (item.mode || 'code') === currentMode,
          )
          .toSorted((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
      );
    } catch (error) {
      console.error('Failed to load project conversations', error);
    }
  }, [activeFolderId]);

  useEffect(() => {
    void load();
  }, [load, mode]);

  // Reset the disclosure state when moving between projects.
  useEffect(() => {
    setExpanded(false);
    setShowInstructions(false);
  }, [activeFolderId]);

  /*
   * A project id in the URL that matches no project — a deleted project, or a
   * link opened on a device that hasn't synced yet. Render nothing rather than
   * an empty shell, so the normal intro shows instead.
   */
  if (!folder) {
    return null;
  }

  const visible = expanded ? chats : chats.slice(0, COLLAPSED_COUNT);
  const projectOnly = folder.memoryMode === 'project_only';

  const saveSettings = async (name: string, memoryMode: MemoryMode, instructions: string) => {
    if (!db) {
      return;
    }

    try {
      await renameFolder(db, folder.id, name);
      await setFolderMemoryMode(db, folder.id, memoryMode);
      await setFolderInstructions(db, folder.id, instructions);
      setSheetOpen(false);
      toast.success('Project updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save project');
    }
  };

  return (
    <div className="mx-auto w-full max-w-chat px-4 pt-10 sm:pt-16 lg:pt-20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-palmkit-elements-background-depth-2">
          <span
            className={classNames(
              'h-6 w-6 text-palmkit-elements-textSecondary',
              projectOnly ? 'i-ph:folder-lock' : 'i-ph:folder-simple',
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-palmkit-elements-textPrimary sm:text-3xl">
            {folder.name}
          </h1>
          <p className="mt-1 text-sm text-palmkit-elements-textSecondary">
            {chats.length === 0
              ? 'No conversations yet — start one below.'
              : `${chats.length} conversation${chats.length === 1 ? '' : 's'} in ${mode}`}
            {projectOnly && ' · private memory'}
          </p>
        </div>
        <button
          onClick={() => setSheetOpen(true)}
          aria-label="Project settings"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-palmkit-elements-textTertiary transition hover:bg-palmkit-elements-background-depth-2 hover:text-palmkit-elements-textPrimary"
        >
          <span className="i-ph:sliders-horizontal h-5 w-5" />
        </button>
      </div>

      {/* The standing brief. Collapsed to two lines by default — it is context
          for the model, not something you need to re-read every time. */}
      {folder.instructions ? (
        <button
          onClick={() => setShowInstructions((v) => !v)}
          aria-expanded={showInstructions}
          className="mt-4 w-full rounded-2xl bg-palmkit-elements-background-depth-2 px-4 py-3 text-left transition hover:brightness-95"
        >
          <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-palmkit-elements-textTertiary">
            <span className="i-ph:list-bullets h-3.5 w-3.5" />
            Instructions
            <span
              className={classNames(
                'ml-auto h-3.5 w-3.5 transition',
                showInstructions ? 'i-ph:caret-up' : 'i-ph:caret-down',
              )}
            />
          </div>
          <p
            className={classNames(
              'mt-1.5 whitespace-pre-wrap text-[14px] leading-snug text-palmkit-elements-textSecondary',
              showInstructions ? '' : 'line-clamp-2',
            )}
          >
            {folder.instructions}
          </p>
        </button>
      ) : (
        <button
          onClick={() => setSheetOpen(true)}
          className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-dashed border-palmkit-elements-borderColor px-4 py-3 text-left text-[14px] text-palmkit-elements-textTertiary transition hover:text-palmkit-elements-textSecondary"
        >
          <span className="i-ph:list-bullets h-4 w-4 shrink-0" />
          Add instructions so Palmkit knows what this project is
        </button>
      )}

      {chats.length > 0 && (
        <div className="mt-5">
          <div className="px-1 pb-1 text-[12px] font-medium uppercase tracking-wide text-palmkit-elements-textTertiary">
            Conversations
          </div>
          <div className="flex flex-col">
            {visible.map((chat) => (
              <button
                key={chat.id}
                onClick={() => navigate(`/${chat.mode || 'code'}/${chat.urlId || chat.id}?project=${folder.id}`)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-palmkit-elements-background-depth-2"
              >
                <span
                  className={classNames(
                    'h-4 w-4 shrink-0 text-palmkit-elements-textTertiary',
                    chat.pinned ? 'i-ph:push-pin-fill' : 'i-ph:chat-circle',
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-[15px] text-palmkit-elements-textPrimary">
                  {chat.description || 'Untitled'}
                </span>
                <span className="shrink-0 text-[12px] text-palmkit-elements-textTertiary">
                  {new Date(chat.timestamp).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>

          {chats.length > COLLAPSED_COUNT && (
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-1 rounded-xl px-3 py-2 text-[14px] text-palmkit-elements-textSecondary transition hover:bg-palmkit-elements-background-depth-2"
            >
              {expanded ? 'Show less' : `Show all ${chats.length}`}
            </button>
          )}
        </div>
      )}

      <ProjectSheet open={sheetOpen} folder={folder} onClose={() => setSheetOpen(false)} onSubmit={saveSettings} />
    </div>
  );
}
