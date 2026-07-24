/**
 * StreamStatusBar — bottom status bar showing live stream state.
 *
 * Compact one-liner with:
 *   [icon] [status text]              [duration] [tokens] [progress %]
 *
 * Replaces the old "Analysing Request / Code Files Selected / Generating
 * Response" noise — those are now in the ActivityPanel, not the chat thread.
 *
 * States:
 *   - idle:        hidden
 *   - streaming:   spinner + "Streaming response..."
 *   - building:    hammer + "Building · X files"
 *   - complete:    check + "Completed · Xs · Y tokens"
 *   - cancelled:   stop + "Cancelled · Xs"
 *   - error:       x + "Error: ..."
 */

import { memo, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { streamStatusStore } from '~/lib/stream/stores';
import { StreamIcon } from '~/components/icons/stream/StreamIcon';
import { classNames } from '~/utils/classNames';

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);

  return `${m}m ${s}s`;
}

function StreamStatusBarImpl() {
  const status = useStore(streamStatusStore);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [visible, setVisible] = useState(true);

  // Tick every 100ms while active
  useEffect(() => {
    if (!status.active || !status.startedAt) {
      setElapsedMs(0);
      return undefined;
    }

    const interval = setInterval(() => {
      setElapsedMs(Date.now() - (status.startedAt ?? 0));
    }, 100);

    return () => clearInterval(interval);
  }, [status.active, status.startedAt]);

  // Show end-state for 4 seconds after completion, then hide
  useEffect(() => {
    if (status.endedAt) {
      setVisible(true);

      const t = setTimeout(() => setVisible(false), 4000);

      return () => clearTimeout(t);
    }

    setVisible(true);

    return undefined;
  }, [status.endedAt]);

  // Hide when idle with no recent activity
  if (!status.active && !status.endedAt) {
    return null;
  }

  if (!visible) {
    return null;
  }

  const duration = status.endedAt && status.startedAt ? status.endedAt - status.startedAt : elapsedMs;

  const isComplete = status.endReason === 'complete';
  const isError = status.endReason === 'error' || status.endReason === 'timeout';
  const isCancelled = status.endReason === 'cancelled';

  const iconColorClass = isComplete
    ? 'text-palmkit-elements-button-success-text'
    : isError
      ? 'text-palmkit-elements-button-danger-text'
      : isCancelled
        ? 'text-palmkit-elements-textSecondary'
        : status.active
          ? 'text-palmkit-elements-textPrimary'
          : 'text-palmkit-elements-textSecondary';

  return (
    <div
      className={classNames(
        'flex items-center gap-2 px-4 py-1.5 border-t border-palmkit-elements-borderColor',
        'bg-palmkit-elements-background-depth-1 text-xs',
        'transition-opacity duration-300',
      )}
      role="status"
      aria-live="polite"
    >
      {/* Icon */}
      <StreamIcon
        name={status.icon}
        size={12}
        className={classNames(status.active && 'animate-spin', iconColorClass)}
      />

      {/* Status text */}
      <span className="text-palmkit-elements-textSecondary truncate flex-1">
        {status.text || (status.active ? 'Working...' : status.endReason || '')}
        {status.errorMessage && (
          <span className="text-palmkit-elements-button-danger-text ml-1">{status.errorMessage}</span>
        )}
      </span>

      {/* Progress bar (if provided) */}
      {status.progress !== undefined && status.progress > 0 && status.progress < 100 && (
        <div className="w-16 h-1 rounded-full bg-palmkit-elements-background-depth-3 overflow-hidden">
          <div
            className="h-full bg-palmkit-elements-button-primary-background transition-all duration-200"
            style={{ width: `${status.progress}%` }}
          />
        </div>
      )}

      {/* Duration */}
      {duration > 0 && (
        <span className="text-palmkit-elements-textTertiary tabular-nums">{formatDuration(duration)}</span>
      )}

      {/* Token count (if available) */}
      {status.stats?.tokenCount !== undefined && status.stats.tokenCount > 0 && (
        <span className="text-palmkit-elements-textTertiary tabular-nums">
          {status.stats.tokenCount.toLocaleString()} tok
        </span>
      )}
    </div>
  );
}

export const StreamStatusBar = memo(StreamStatusBarImpl);
