import { Link, useParams } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import { type ChatHistoryItem } from '~/lib/persistence';
import WithTooltip from '~/components/ui/Tooltip';
import { useEditChatDescription } from '~/lib/hooks';
import { useLongPress } from '~/lib/hooks/useLongPress';
import { useCallback, useState } from 'react';
import { Checkbox } from '~/components/ui/Checkbox';
import { ChatItemMenu } from './ChatItemMenu';

interface HistoryItemProps {
  item: ChatHistoryItem;
  onDelete?: () => void;
  onDuplicate?: (id: string) => void;
  onTogglePin?: (item: ChatHistoryItem) => void;
  onMoveToProject?: (item: ChatHistoryItem) => void;
  exportChat: (id?: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
}

export function HistoryItem({
  item,
  onDelete,
  onDuplicate,
  onTogglePin,
  onMoveToProject,
  exportChat,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: HistoryItemProps) {
  const { id: urlId } = useParams();
  const isActiveChat = urlId === item.urlId;
  const [menuOpen, setMenuOpen] = useState(false);

  const { editing, handleChange, handleBlur, handleSubmit, handleKeyDown, currentDescription, toggleEditMode } =
    useEditChatDescription({
      initialDescription: item.description,
      customChatId: item.id,
      syncWithGlobalStore: isActiveChat,
    });

  const { handlers: longPress, consumedClick } = useLongPress(() => setMenuOpen(true));

  const handleItemClick = useCallback(
    (e: React.MouseEvent) => {
      // Swallow the click a long-press synthesises, so it doesn't also navigate.
      if (consumedClick()) {
        e.preventDefault();
        e.stopPropagation();

        return;
      }

      if (selectionMode) {
        e.preventDefault();
        e.stopPropagation();
        onToggleSelection?.(item.id);
      }
    },
    [selectionMode, item.id, onToggleSelection, consumedClick],
  );

  const handleCheckboxChange = useCallback(() => {
    onToggleSelection?.(item.id);
  }, [item.id, onToggleSelection]);

  return (
    <div
      className={classNames(
        'group rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/80 dark:hover:bg-gray-800/30 overflow-hidden flex justify-between items-center px-3 py-2 transition-colors',
        { 'text-gray-900 dark:text-white bg-gray-50/80 dark:bg-gray-800/30': isActiveChat },
        { 'cursor-pointer': selectionMode },
      )}
      onClick={selectionMode ? handleItemClick : undefined}
      {...longPress}
    >
      {selectionMode && (
        <div className="flex items-center mr-2" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            id={`select-${item.id}`}
            checked={isSelected}
            onCheckedChange={handleCheckboxChange}
            className="h-4 w-4"
          />
        </div>
      )}

      {editing ? (
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            className="flex-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-500/50"
            autoFocus
            value={currentDescription}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            className="i-ph:check h-4 w-4 text-gray-500 hover:text-gray-600 transition-colors"
            onMouseDown={handleSubmit}
          />
        </form>
      ) : (
        <Link
          to={`/${item.mode || 'code'}/${item.urlId}`}
          className="flex w-full relative truncate block"
          onClick={handleItemClick}
        >
          {item.pinned && (
            <span
              className="i-ph:push-pin-fill mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500"
              aria-label="Pinned"
            />
          )}
          <WithTooltip tooltip={currentDescription}>
            <span className="truncate pr-8">{currentDescription}</span>
          </WithTooltip>
          <div className="absolute right-0 top-0 bottom-0 flex items-center bg-transparent">
            {/*
              Always visible — dimmed at rest, full strength on hover or while
              its menu is open. The actions used to be hover-only, which left
              touch devices with no way to reach them at all; keeping the ⋯
              permanently on screen is what makes them discoverable.
            */}
            <ChatItemMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              pinned={Boolean(item.pinned)}
              onPin={() => onTogglePin?.(item)}
              onRename={toggleEditMode}
              onMoveToProject={() => onMoveToProject?.(item)}
              onDelete={() => onDelete?.()}
              onDuplicate={onDuplicate ? () => onDuplicate(item.id) : undefined}
              onExport={() => exportChat(item.id)}
              trigger={
                <button
                  type="button"
                  aria-label={`Actions for ${currentDescription}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className={classNames(
                    'flex h-7 w-7 items-center justify-center rounded-md transition-opacity',
                    'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200',
                    'hover:bg-gray-200/70 dark:hover:bg-neutral-700/70',
                    menuOpen ? 'opacity-100' : 'opacity-60 group-hover:opacity-100',
                  )}
                >
                  <span className="i-ph:dots-three-outline-fill h-4 w-4" />
                </button>
              }
            />
          </div>
        </Link>
      )}
    </div>
  );
}
