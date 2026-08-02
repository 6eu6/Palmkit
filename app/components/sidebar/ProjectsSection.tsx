import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import type { Folder } from '~/lib/stores/folders';

/** How many projects are shown before "See more". */
const COLLAPSED_COUNT = 3;

interface ProjectsSectionProps {
  folders: Folder[];

  /**
   * Conversations per project IN THE CURRENT TAB, so the count matches what
   * selecting the project actually shows.
   */
  counts: Record<string, number>;
  activeFolderId?: string;
  onSelect: (folderId: string | undefined) => void;
  onNew: () => void;
  onOpenSettings: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
  compact?: boolean;
}

/**
 * The Projects list, above the conversation list.
 *
 * A project groups conversations across all three tabs; selecting one narrows
 * the conversation list below without changing which tab you are in. The count
 * shown is therefore per-tab — it has to agree with what you see when you
 * click it, or "12" next to a project that then lists 3 rows reads as a bug.
 *
 * Only the first few projects are listed, with "See more" to expand: the
 * conversation list underneath is the thing people came for, and an unbounded
 * project list would push it off screen.
 */
export function ProjectsSection({
  folders,
  counts,
  activeFolderId,
  onSelect,
  onNew,
  onOpenSettings,
  onDelete,
  compact = false,
}: ProjectsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const hasOverflow = folders.length > COLLAPSED_COUNT;
  const visible = expanded ? folders : folders.slice(0, COLLAPSED_COUNT);
  const rowText = compact ? 'text-[15px]' : 'text-sm';
  const rowPad = compact ? 'px-2.5 py-2.5' : 'px-2.5 py-2';

  return (
    <div className={compact ? 'px-3 pt-3' : 'px-4 pt-1'}>
      <div
        className={classNames(
          'pb-1.5 font-semibold text-gray-900 dark:text-white',
          compact ? 'px-2 text-[17px]' : 'text-[15px]',
        )}
      >
        Projects
      </div>

      <div className="flex flex-col gap-0.5">
        <button
          onClick={onNew}
          className={classNames(
            'flex items-center gap-3 rounded-xl text-left transition-colors',
            rowText,
            rowPad,
            'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-neutral-800/70',
          )}
        >
          <span className="i-ph:folder-simple-plus h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
          <span className="flex-1 truncate">New project</span>
        </button>

        {/* "All conversations" is the way back out of a project, so it only
            earns a row once you are actually inside one. */}
        {activeFolderId && (
          <button
            onClick={() => onSelect(undefined)}
            className={classNames(
              'flex items-center gap-3 rounded-xl text-left transition-colors',
              rowText,
              rowPad,
              'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-neutral-800/70',
            )}
          >
            <span className="i-ph:arrow-u-down-left h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400" />
            <span className="flex-1 truncate">All conversations</span>
          </button>
        )}

        {visible.map((folder) => (
          <div key={folder.id} className="group/folder flex items-center">
            <button
              onClick={() => onSelect(folder.id)}
              className={classNames(
                'flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition-colors',
                rowText,
                rowPad,
                activeFolderId === folder.id
                  ? 'bg-gray-100 font-medium text-gray-900 dark:bg-neutral-800 dark:text-white'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-neutral-800/70',
              )}
            >
              <span
                className={classNames(
                  'h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400',
                  folder.memoryMode === 'project_only' ? 'i-ph:folder-lock' : 'i-ph:folder-simple',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-600">
                {counts[folder.id] ?? 0}
              </span>
            </button>
            <button
              onClick={() => onOpenSettings(folder)}
              aria-label={`Settings for project ${folder.name}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 opacity-60 transition hover:bg-gray-200/70 hover:text-gray-700 group-hover/folder:opacity-100 dark:hover:bg-neutral-700/70 dark:hover:text-gray-200"
            >
              <span className="i-ph:sliders-horizontal h-4 w-4" />
            </button>
            <button
              onClick={() => onDelete(folder)}
              aria-label={`Delete project ${folder.name}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 opacity-60 transition hover:bg-red-50 hover:text-red-500 group-hover/folder:opacity-100 dark:hover:bg-red-900/20"
            >
              <span className="i-ph:trash h-4 w-4" />
            </button>
          </div>
        ))}

        {hasOverflow && (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className={classNames(
              'flex items-center gap-3 rounded-xl text-left transition-colors',
              rowText,
              rowPad,
              'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-neutral-800/70',
            )}
          >
            <span
              className={classNames(
                'h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400',
                expanded ? 'i-ph:caret-up' : 'i-ph:dots-three-outline-fill',
              )}
            />
            <span className="flex-1 truncate">{expanded ? 'See less' : 'See more'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
