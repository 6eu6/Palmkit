/**
 * Checkpoint — Conversation restore point
 * ========================================
 *
 * A visual marker for conversation history points that allows
 * restoring the chat to a previous state.
 *
 * <Checkpoint
 *   label="After initial plan"
 *   timestamp="2 min ago"
 *   onRestore={() => rewind(messageId)}
 * />
 *
 * Monochrome: subtle dashed border, small icon. No bright colors.
 * Icon: i-ph:bookmark-simple for the marker.
 */

import { memo } from 'react';
import { classNames } from '~/utils/classNames';

interface CheckpointProps {
  label: string;
  timestamp?: string;
  onRestore?: () => void;
  className?: string;
}

function CheckpointImpl({ label, timestamp, onRestore, className }: CheckpointProps) {
  return (
    <div
      className={classNames(
        'flex items-center gap-2 px-3 py-1.5 border border-dashed border-palmkit-elements-borderColor rounded-md bg-palmkit-elements-background-depth-1',
        className,
      )}
    >
      <div className="i-ph:bookmark-simple text-sm text-palmkit-elements-textSecondary" />
      <span className="text-xs text-palmkit-elements-textSecondary flex-1">{label}</span>
      {timestamp && <span className="text-[10px] text-palmkit-elements-textSecondary">{timestamp}</span>}
      {onRestore && (
        <button
          onClick={onRestore}
          title="Restore to this point"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-2 transition-colors"
        >
          <div className="i-ph:arrow-u-up-left text-sm" />
          Restore
        </button>
      )}
    </div>
  );
}

export const Checkpoint = memo(CheckpointImpl);
