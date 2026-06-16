import { memo } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * RestoreSnapshotCard
 *
 * Shows restored workspace state after refresh.
 * States: restoring, restored, interrupted-restored, restore-failed.
 * Uses mobile design system tokens for consistent styling.
 *
 * Usage:
 *   <RestoreSnapshotCard status="restoring" />
 *   <RestoreSnapshotCard status="restored" wasInterrupted />
 */

export type RestoreSnapshotStatus = 'restoring' | 'restored' | 'interrupted-restored' | 'restore-failed';

interface RestoreSnapshotCardProps {
  /** Current restore status */
  status: RestoreSnapshotStatus;

  /** Whether the generation was interrupted */
  wasInterrupted?: boolean;

  /** Optional timestamp of the snapshot */
  snapshotTime?: string;
  className?: string;
}

const STATUS_CONFIG: Record<
  RestoreSnapshotStatus,
  { icon: string; title: string; description: string; colorClass: string; animate?: boolean }
> = {
  restoring: {
    icon: 'i-ph:arrow-counter-clockwise',
    title: 'Restoring workspace',
    description: 'Recovering your last session...',
    colorClass: 'border-[rgba(139,92,246,0.2)] bg-[var(--palmkit-mobile-accent-faint)]',
    animate: true,
  },
  restored: {
    icon: 'i-ph:check-circle',
    title: 'Workspace restored',
    description: 'Your session has been recovered successfully.',
    colorClass: 'border-[rgba(74,222,128,0.2)] bg-[var(--palmkit-mobile-success-muted)]',
  },
  'interrupted-restored': {
    icon: 'i-ph:arrow-counter-clockwise',
    title: 'Session recovered',
    description: 'The last generation was interrupted. Your progress has been saved and restored.',
    colorClass: 'border-[rgba(251,191,36,0.2)] bg-[var(--palmkit-mobile-warning-muted)]',
  },
  'restore-failed': {
    icon: 'i-ph:warning-circle',
    title: 'Restore failed',
    description: 'Could not recover your last session. Starting fresh.',
    colorClass: 'border-[rgba(248,113,113,0.2)] bg-[var(--palmkit-mobile-error-muted)]',
  },
};

const ICON_COLOR: Record<RestoreSnapshotStatus, string> = {
  restoring: 'text-[var(--palmkit-mobile-accent-text)]',
  restored: 'text-[var(--palmkit-mobile-success)]',
  'interrupted-restored': 'text-[var(--palmkit-mobile-warning)]',
  'restore-failed': 'text-[var(--palmkit-mobile-error)]',
};

export const RestoreSnapshotCard = memo(
  ({ status, wasInterrupted, snapshotTime, className }: RestoreSnapshotCardProps) => {
    const effectiveStatus = wasInterrupted && status === 'restored' ? 'interrupted-restored' : status;
    const config = STATUS_CONFIG[effectiveStatus];

    return (
      <div
        className={classNames(
          'flex items-start gap-3 px-4 py-3 rounded-[var(--palmkit-radius-xl)] border',
          'transition-all duration-[var(--palmkit-duration-moderate)] ease-out',
          config.colorClass,
          className,
        )}
        role="alert"
        aria-live="polite"
      >
        {/* Status icon */}
        <div
          className={classNames(
            'w-8 h-8 rounded-[var(--palmkit-radius-sm)] flex items-center justify-center shrink-0 mt-0.5',
            'bg-[var(--palmkit-mobile-surface-bg)]',
            ICON_COLOR[effectiveStatus],
            config.animate && 'animate-pulse',
          )}
        >
          <div className={classNames(config.icon, 'text-lg')} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--palmkit-mobile-text-primary)]">{config.title}</h3>
            {config.animate && (
              <div className="w-3 h-3 rounded-full border-2 border-[var(--palmkit-mobile-accent-faint)] border-t-[var(--palmkit-mobile-accent-text)] animate-spin" />
            )}
          </div>
          <p className="text-xs text-[var(--palmkit-mobile-text-secondary)] mt-0.5 leading-relaxed">
            {config.description}
          </p>
          {snapshotTime && (
            <p className="text-[10px] text-[var(--palmkit-mobile-text-tertiary)] mt-1 font-mono">
              Snapshot from {snapshotTime}
            </p>
          )}
        </div>
      </div>
    );
  },
);

RestoreSnapshotCard.displayName = 'RestoreSnapshotCard';
