import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useCallback, type ReactNode } from 'react';
import { useDismissOnScroll } from '~/lib/hooks/useDismissOnScroll';
import { classNames } from '~/utils/classNames';
import type { Folder } from '~/lib/stores/folders';

export interface ChatItemMenuProps {
  /** Controlled — long-press opens the same menu the ⋯ button does. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pinned: boolean;
  onPin: () => void;
  onRename: () => void;

  /** Projects to offer in the submenu. */
  folders: Folder[];

  /** Which project the conversation is in now, so it can be ticked. */
  currentFolderId?: string;

  /** `undefined` removes it from every project. */
  onMoveToProject: (folderId: string | undefined) => void;
  onCreateProjectAndMove: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;

  /** The ⋯ button. Rendered as the anchor so the menu is positioned on it. */
  trigger: ReactNode;
}

function Item({
  icon,
  label,
  onSelect,
  danger,
  disabled,
  hint,
}: {
  icon: string;
  label: string;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={classNames(
        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] outline-none cursor-pointer select-none',
        'transition-colors',
        disabled
          ? 'text-gray-400 dark:text-gray-600 cursor-default'
          : danger
            ? 'text-red-600 dark:text-red-400 data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-900/20'
            : 'text-gray-700 dark:text-gray-200 data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-neutral-800',
      )}
    >
      <span className={classNames(icon, 'h-4 w-4 shrink-0')} />
      <span className="flex-1">{label}</span>
      {hint && (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-neutral-800 dark:text-gray-500">
          {hint}
        </span>
      )}
    </DropdownMenu.Item>
  );
}

/**
 * Per-conversation actions, shared by the desktop sidebar and the mobile
 * drawer so both offer exactly the same set.
 *
 * Replaces the old row of bare icons, which was revealed on hover only — a
 * touch screen has no hover, so on a phone the row had no visible actions at
 * all. Now there is a permanent ⋯ button, and on touch a long-press on the
 * row opens the same menu.
 */
export function ChatItemMenu({
  open,
  onOpenChange,
  pinned,
  onPin,
  onRename,
  folders,
  currentFolderId,
  onMoveToProject,
  onCreateProjectAndMove,
  onDelete,
  onDuplicate,
  onExport,
  trigger,
}: ChatItemMenuProps) {
  /*
   * The menu is positioned once, against the ⋯ it opened from. Scroll the list
   * and it stays pinned where it was, floating over an unrelated conversation,
   * so it has to go away instead of following the finger.
   */
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useDismissOnScroll(open, close, '[role="menu"]');

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className={classNames(
            'z-[1100] min-w-[210px] rounded-xl p-1.5',
            'bg-white dark:bg-neutral-900',
            'border border-gray-200 dark:border-neutral-700',
            'shadow-xl shadow-black/10',
          )}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <Item
            icon={pinned ? 'i-ph:push-pin-slash' : 'i-ph:push-pin'}
            label={pinned ? 'Unpin' : 'Pin'}
            onSelect={onPin}
          />
          <Item icon="i-ph:pencil-simple" label="Rename" onSelect={onRename} />

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger
              className={classNames(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] outline-none cursor-pointer select-none',
                'text-gray-700 transition-colors dark:text-gray-200',
                'data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-neutral-800',
              )}
            >
              <span className="i-ph:folder-simple h-4 w-4 shrink-0" />
              <span className="flex-1">Move to project</span>
              <span className="i-ph:caret-right h-3.5 w-3.5 shrink-0 opacity-60" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                sideOffset={4}
                collisionPadding={12}
                className={classNames(
                  'z-[1100] max-h-[320px] min-w-[200px] overflow-y-auto rounded-xl p-1.5',
                  'bg-white dark:bg-neutral-900',
                  'border border-gray-200 dark:border-neutral-700',
                  'shadow-xl shadow-black/10',
                )}
              >
                <Item
                  icon={currentFolderId ? 'i-ph:circle' : 'i-ph:check-circle-fill'}
                  label="No project"
                  onSelect={() => onMoveToProject(undefined)}
                />
                {folders.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-neutral-800" />}
                {folders.map((folder) => (
                  <Item
                    key={folder.id}
                    icon={currentFolderId === folder.id ? 'i-ph:check-circle-fill' : 'i-ph:circle'}
                    label={folder.name}
                    onSelect={() => onMoveToProject(folder.id)}
                  />
                ))}
                <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-neutral-800" />
                <Item icon="i-ph:plus" label="New project…" onSelect={onCreateProjectAndMove} />
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {(onDuplicate || onExport) && (
            <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-neutral-800" />
          )}
          {onDuplicate && <Item icon="i-ph:copy" label="Duplicate" onSelect={onDuplicate} />}
          {onExport && <Item icon="i-ph:download-simple" label="Export" onSelect={onExport} />}

          <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-neutral-800" />
          <Item icon="i-ph:trash" label="Delete" onSelect={onDelete} danger />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
