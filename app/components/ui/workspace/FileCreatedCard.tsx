import { memo } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * FileCreatedCard
 *
 * Shows when AI creates or updates a file.
 * Contains file icon, filename, path, status.
 * Uses mobile design system tokens for consistent styling.
 *
 * Usage:
 *   <FileCreatedCard filename="App.tsx" path="src/" status="created" />
 *   <FileCreatedCard filename="index.ts" path="src/routes/" status="updated" language="typescript" />
 */

export type FileCreatedStatus = 'created' | 'updated' | 'error' | 'pending';

interface FileCreatedCardProps {
  /** File name with extension */
  filename: string;

  /** Directory path */
  path?: string;

  /** File status */
  status?: FileCreatedStatus;

  /** Programming language for icon selection */
  language?: string;

  /** Show pulse animation on update */
  pulse?: boolean;

  /** Compact mode — single line */
  compact?: boolean;
  className?: string;

  /** Click handler */
  onClick?: () => void;
}

const STATUS_CONFIG: Record<FileCreatedStatus, { icon: string; colorClass: string; label: string }> = {
  created: {
    icon: 'i-ph:plus-circle',
    colorClass: 'text-[var(--palmkit-mobile-success)]',
    label: 'Created',
  },
  updated: {
    icon: 'i-ph:pencil-simple',
    colorClass: 'text-[var(--palmkit-mobile-accent-text)]',
    label: 'Updated',
  },
  error: {
    icon: 'i-ph:warning-circle',
    colorClass: 'text-[var(--palmkit-mobile-error)]',
    label: 'Error',
  },
  pending: {
    icon: 'i-ph:clock',
    colorClass: 'text-[var(--palmkit-mobile-text-tertiary)]',
    label: 'Pending',
  },
};

/** Map file extension to Phosphor icon */
function getFileIcon(filename: string, _language?: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const iconMap: Record<string, string> = {
    ts: 'i-ph:file-code',
    tsx: 'i-ph:file-code',
    js: 'i-ph:file-code',
    jsx: 'i-ph:file-code',
    html: 'i-ph:file-code',
    css: 'i-ph:file-code',
    scss: 'i-ph:file-code',
    json: 'i-ph:brackets-curly',
    md: 'i-ph:file-text',
    py: 'i-ph:file-code',
    rs: 'i-ph:file-code',
    go: 'i-ph:file-code',
    svg: 'i-ph:image',
    png: 'i-ph:image',
    jpg: 'i-ph:image',
    gif: 'i-ph:image',
    yaml: 'i-ph:file-text',
    yml: 'i-ph:file-text',
    toml: 'i-ph:file-text',
    env: 'i-ph:lock-simple',
    sh: 'i-ph:terminal',
    bash: 'i-ph:terminal',
  };

  return iconMap[ext] || 'i-ph:file';
}

export const FileCreatedCard = memo(
  ({
    filename,
    path,
    status = 'created',
    language,
    pulse = false,
    compact = false,
    className,
    onClick,
  }: FileCreatedCardProps) => {
    const statusConfig = STATUS_CONFIG[status];
    const fileIcon = getFileIcon(filename, language);

    if (compact) {
      return (
        <div
          className={classNames(
            'inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--palmkit-radius-sm)]',
            'bg-[var(--palmkit-mobile-surface-bg)] border border-[var(--palmkit-mobile-surface-border-subtle)]',
            'text-xs',
            onClick && 'cursor-pointer hover:bg-[var(--palmkit-mobile-accent-faint)] transition-colors',
            pulse && 'animate-pulse-glow',
            className,
          )}
          onClick={onClick}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : undefined}
        >
          <div className={classNames(fileIcon, 'text-sm text-[var(--palmkit-mobile-text-secondary)] shrink-0')} />
          <span className="text-[var(--palmkit-mobile-text-primary)] font-mono truncate max-w-[120px]">{filename}</span>
          <div className={classNames(statusConfig.icon, 'text-xs shrink-0', statusConfig.colorClass)} />
        </div>
      );
    }

    return (
      <div
        className={classNames(
          'flex items-center gap-3 px-3 py-2.5 rounded-[var(--palmkit-radius-md)]',
          'bg-[var(--palmkit-mobile-surface-bg)] border border-[var(--palmkit-mobile-surface-border-subtle)]',
          'transition-all duration-[var(--palmkit-duration-normal)]',
          onClick && 'cursor-pointer hover:bg-[var(--palmkit-mobile-accent-faint)] active:scale-[0.98]',
          pulse && 'animate-pulse-glow',
          status === 'error' && 'border-[rgba(248,113,113,0.2)]',
          className,
        )}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {/* File icon */}
        <div
          className={classNames(
            'w-8 h-8 rounded-[var(--palmkit-radius-sm)] flex items-center justify-center shrink-0',
            'bg-[var(--palmkit-mobile-accent-faint)] border border-[var(--palmkit-mobile-surface-border-subtle)]',
            status === 'created' && 'text-[var(--palmkit-mobile-success)]',
            status === 'updated' && 'text-[var(--palmkit-mobile-accent-text)]',
            status === 'error' && 'text-[var(--palmkit-mobile-error)]',
            status === 'pending' && 'text-[var(--palmkit-mobile-text-tertiary)]',
          )}
        >
          <div className={classNames(fileIcon, 'text-base')} />
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--palmkit-mobile-text-primary)] truncate font-mono">
              {filename}
            </span>
            <div className={classNames(statusConfig.icon, 'text-xs shrink-0', statusConfig.colorClass)} />
          </div>
          {path && (
            <div className="text-[10px] text-[var(--palmkit-mobile-text-tertiary)] font-mono truncate mt-0.5">
              {path}
            </div>
          )}
        </div>

        {/* Status label */}
        <span
          className={classNames(
            'text-[10px] font-medium px-1.5 py-0.5 rounded-[var(--palmkit-radius-xs)]',
            'bg-[var(--palmkit-mobile-accent-faint)]',
            statusConfig.colorClass,
          )}
        >
          {statusConfig.label}
        </span>
      </div>
    );
  },
);

FileCreatedCard.displayName = 'FileCreatedCard';
