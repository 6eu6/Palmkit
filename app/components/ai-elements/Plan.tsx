/**
 * Plan — AI execution plan with shimmer + collapsible
 * ===================================================
 *
 * Displays an AI-generated execution plan with streaming support
 * and shimmer animations on incomplete items.
 *
 * <Plan
 *   title="Rewrite AI Elements to SolidJS"
 *   steps={[
 *     { text: "Analyze current components", status: "done" },
 *     { text: "Create SolidJS primitives", status: "in_progress" },
 *     { text: "Migrate each component", status: "pending" },
 *   ]}
 *   isStreaming={true}
 * />
 *
 * Status icons (all monochrome):
 *   done       → i-ph:check-circle
 *   in_progress → i-ph:circle-notch (spinning)
 *   pending    → i-ph:circle (hollow)
 */

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { Shimmer } from './Shimmer';

export interface PlanStep {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

interface PlanProps {
  title: string;
  steps: PlanStep[];
  isStreaming?: boolean;
  className?: string;
}

const STEP_ICONS = {
  done: 'i-ph:check-circle',
  in_progress: 'i-ph:circle-notch',
  pending: 'i-ph:circle',
} as const;

function PlanImpl({ title, steps, isStreaming = false, className }: PlanProps) {
  const [expanded, setExpanded] = useState(true);
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const totalCount = steps.length;

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
        <div className="i-ph:list-checks text-sm text-palmkit-elements-textSecondary" />
        <span className="text-xs font-medium text-palmkit-elements-textPrimary flex-1">
          {isStreaming ? <Shimmer>{title}</Shimmer> : title}
        </span>
        <span className="text-[10px] text-palmkit-elements-textSecondary">
          {doneCount}/{totalCount}
        </span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5">
              {steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2 ai-slide-in">
                  <div
                    className={classNames(
                      'mt-0.5 text-sm text-palmkit-elements-textSecondary',
                      STEP_ICONS[step.status],
                      step.status === 'in_progress' && 'animate-spin',
                    )}
                    style={step.status === 'in_progress' ? { animationDuration: '1.5s' } : undefined}
                  />
                  <span
                    className={classNames(
                      'text-xs',
                      step.status === 'done'
                        ? 'text-palmkit-elements-textSecondary line-through'
                        : 'text-palmkit-elements-textPrimary',
                    )}
                  >
                    {step.status === 'in_progress' ? <Shimmer>{step.text}</Shimmer> : step.text}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const Plan = memo(PlanImpl);
