/**
 * Task — Task list with status indicators + progress
 * ==================================================
 *
 * Structured display of task lists or workflow progress with
 * collapsible details, status indicators, and progress tracking.
 *
 * <Task
 *   title="Build the project"
 *   status="in_progress"
 *   progress={{ done: 3, total: 5 }}
 *   details="Compiling TypeScript files…"
 * />
 *
 * Status icons (monochrome):
 *   done        → i-ph:check-circle
 *   in_progress → i-ph:circle-notch (spinning)
 *   error       → i-ph:x-circle
 *   pending     → i-ph:circle
 */

import { memo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { Shimmer } from './Shimmer';

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'error';

interface TaskProps {
  title: string;
  status: TaskStatus;
  progress?: { done: number; total: number };
  details?: string;
  children?: ReactNode;
  className?: string;
}

const TASK_ICONS: Record<TaskStatus, string> = {
  done: 'i-ph:check-circle',
  in_progress: 'i-ph:circle-notch',
  error: 'i-ph:x-circle',
  pending: 'i-ph:circle',
};

function TaskImpl({ title, status, progress, details, children, className }: TaskProps) {
  const [expanded, setExpanded] = useState(status === 'in_progress');
  const hasDetails = Boolean(details || children);

  return (
    <div
      className={classNames(
        'rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1',
        className,
      )}
    >
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-palmkit-elements-background-depth-2 transition-colors disabled:cursor-default"
      >
        {hasDetails && (
          <div
            className={classNames(
              'text-sm text-palmkit-elements-textSecondary transition-transform',
              expanded && 'rotate-90',
              'i-ph:caret-right-bold',
            )}
          />
        )}
        <div
          className={classNames(
            'text-sm text-palmkit-elements-textSecondary',
            TASK_ICONS[status],
            status === 'in_progress' && 'animate-spin',
          )}
          style={status === 'in_progress' ? { animationDuration: '1.5s' } : undefined}
        />
        <span className="text-xs text-palmkit-elements-textPrimary flex-1">
          {status === 'in_progress' ? <Shimmer>{title}</Shimmer> : title}
        </span>
        {progress && (
          <span className="text-[10px] text-palmkit-elements-textSecondary">
            {progress.done}/{progress.total}
          </span>
        )}
      </button>

      {/* Progress bar */}
      {progress && (
        <div className="px-3 pb-1">
          <div className="h-0.5 rounded-full bg-palmkit-elements-background-depth-3 overflow-hidden">
            <div
              className="h-full bg-palmkit-elements-textSecondary transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Expandable details */}
      <AnimatePresence>
        {expanded && hasDetails && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-palmkit-elements-borderColor"
          >
            <div className="px-3 py-2 text-xs text-palmkit-elements-textSecondary">
              {details}
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const Task = memo(TaskImpl);
