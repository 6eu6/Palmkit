/**
 * Queue — Queued messages + todos display
 * =======================================
 *
 * A comprehensive queue component for displaying message lists,
 * todos, and collapsible task sections.
 *
 * <Queue title="7 Queued" count={7}>
 *   <Queue.Item text="How do I set up the project?" status="pending" />
 *   <Queue.Item text="What is the roadmap for v2?" status="in_progress" />
 * </Queue>
 *
 * Monochrome: all items use depth-1 background, textSecondary for status.
 */

import { memo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';

export type QueueItemStatus = 'pending' | 'in_progress' | 'done';

interface QueueProps {
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
}

const ITEM_ICONS: Record<QueueItemStatus, string> = {
  done: 'i-ph:check-circle',
  in_progress: 'i-ph:circle-notch',
  pending: 'i-ph:circle',
};

function QueueImpl({ title, count, children, className }: QueueProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className={classNames(
        'rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1',
        className,
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-palmkit-elements-background-depth-2 transition-colors"
      >
        <div
          className={classNames(
            'text-sm text-palmkit-elements-textSecondary transition-transform',
            expanded && 'rotate-90',
            'i-ph:caret-right-bold',
          )}
        />
        <div className="i-ph:list-numbers text-sm text-palmkit-elements-textSecondary" />
        <span className="text-xs font-medium text-palmkit-elements-textPrimary flex-1">{title}</span>
        {count !== undefined && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-palmkit-elements-background-depth-2 text-palmkit-elements-textSecondary">
            {count}
          </span>
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface QueueItemProps {
  text: string;
  status?: QueueItemStatus;
  onClick?: () => void;
}

function QueueItemImpl({ text, status = 'pending', onClick }: QueueItemProps) {
  return (
    <div
      onClick={onClick}
      className={classNames(
        'flex items-center gap-2 py-1.5 px-2 rounded text-xs ai-slide-in',
        onClick && 'cursor-pointer hover:bg-palmkit-elements-background-depth-2 transition-colors',
      )}
    >
      <div
        className={classNames(
          'text-sm text-palmkit-elements-textSecondary',
          ITEM_ICONS[status],
          status === 'in_progress' && 'animate-spin',
        )}
        style={status === 'in_progress' ? { animationDuration: '1.5s' } : undefined}
      />
      <span
        className={classNames(
          'flex-1',
          status === 'done' ? 'text-palmkit-elements-textSecondary line-through' : 'text-palmkit-elements-textPrimary',
        )}
      >
        {text}
      </span>
    </div>
  );
}

export const Queue = Object.assign(memo(QueueImpl), {
  Item: memo(QueueItemImpl),
});
