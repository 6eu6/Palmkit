import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import type { Folder } from '~/lib/stores/folders';

interface ProjectsSectionProps {
  folders: Folder[];

  /**
   * Conversations per project IN THE CURRENT TAB, so the count matches what
   *  clicking the project actually shows.
   */
  counts: Record<string, number>;
  activeFolderId?: string;
  onSelect: (folderId: string | undefined) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (folder: Folder, name: string) => Promise<void>;
  onDelete: (folder: Folder) => void;
  compact?: boolean;
}

/**
 * The Projects list, above the conversation list.
 *
 * A project groups conversations across all three tabs; selecting one narrows
 * the conversation list below without changing which tab you are in. That is
 * why the count shown is per-tab — it has to agree with what you see when you
 * click it, otherwise "12" next to a project that then shows 3 rows reads as
 * a bug.
 */
export function ProjectsSection({
  folders,
  counts,
  activeFolderId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  compact = false,
}: ProjectsSectionProps) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await onCreate(draft);
      setDraft('');
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async (e: React.FormEvent, folder: Folder) => {
    e.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await onRename(folder, draft);
      setRenamingId(null);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  const rowText = compact ? 'text-[14px]' : 'text-sm';

  return (
    <div className={compact ? 'px-3 pt-3' : 'px-4 pb-1'}>
      <div className="flex items-center justify-between pb-1.5">
        <div
          className={classNames(
            'font-medium text-gray-600 dark:text-gray-400',
            compact ? 'px-2 text-[11px] font-semibold uppercase tracking-wider dark:text-gray-600' : 'text-sm',
          )}
        >
          Projects
        </div>
        <button
          onClick={() => {
            setRenamingId(null);
            setDraft('');
            setCreating((v) => !v);
          }}
          aria-label="New project"
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
        >
          <span className="i-ph:plus h-3.5 w-3.5" />
        </button>
      </div>

      {creating && (
        <form onSubmit={submitCreate} className="mb-1 flex items-center gap-1.5">
          <input
            autoFocus
            value={draft}
            placeholder="Project name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setCreating(false);
                setDraft('');
              }
            }}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:ring-1 focus:ring-gray-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
          />
          <button type="submit" aria-label="Create project" className="i-ph:check h-4 w-4 shrink-0 text-gray-500" />
        </form>
      )}

      <div className="flex flex-col gap-0.5">
        {/* "All conversations" — the way back out of a project. */}
        <button
          onClick={() => onSelect(undefined)}
          className={classNames(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
            rowText,
            activeFolderId === undefined
              ? 'bg-gray-100 font-medium text-gray-900 dark:bg-neutral-800 dark:text-white'
              : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/70',
          )}
        >
          <span className="i-ph:chats-circle h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="flex-1 truncate">All conversations</span>
        </button>

        {folders.map((folder) =>
          renamingId === folder.id ? (
            <form key={folder.id} onSubmit={(e) => submitRename(e, folder)} className="flex items-center gap-1.5">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setRenamingId(null);
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] text-gray-900 outline-none focus:ring-1 focus:ring-gray-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
              />
              <button
                type="submit"
                aria-label="Save project name"
                className="i-ph:check h-4 w-4 shrink-0 text-gray-500"
              />
            </form>
          ) : (
            <div key={folder.id} className="group/folder relative flex items-center">
              <button
                onClick={() => onSelect(folder.id)}
                className={classNames(
                  'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                  rowText,
                  activeFolderId === folder.id
                    ? 'bg-gray-100 font-medium text-gray-900 dark:bg-neutral-800 dark:text-white'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/70',
                )}
              >
                <span className="i-ph:folder-simple h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-600">
                  {counts[folder.id] ?? 0}
                </span>
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setDraft(folder.name);
                  setRenamingId(folder.id);
                }}
                aria-label={`Rename project ${folder.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-60 transition hover:bg-gray-200/70 hover:text-gray-700 group-hover/folder:opacity-100 dark:hover:bg-neutral-700/70 dark:hover:text-gray-200"
              >
                <span className="i-ph:pencil-simple h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onDelete(folder)}
                aria-label={`Delete project ${folder.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-60 transition hover:bg-red-50 hover:text-red-500 group-hover/folder:opacity-100 dark:hover:bg-red-900/20"
              >
                <span className="i-ph:trash h-3.5 w-3.5" />
              </button>
            </div>
          ),
        )}

        {folders.length === 0 && !creating && (
          <p className="px-2.5 py-1 text-[12px] text-gray-400 dark:text-gray-600">
            No projects yet — group related conversations with +
          </p>
        )}
      </div>
    </div>
  );
}
