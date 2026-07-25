/**
 * Reasoning — AI thinking display
 * ===============================
 *
 * Automatically opens during streaming, closes when finished.
 * Uses Shimmer for the "Thinking…" label while active.
 *
 * <Reasoning isStreaming={true} steps={[{ text: "Let me analyze…" }]} />
 *
 * Behavior:
 *   - isStreaming=true  → expanded, shows "Thinking…" with shimmer
 *   - isStreaming=false → auto-collapses after 2s, shows "Thought process (N steps)"
 *   - User can toggle expand/collapse anytime
 *
 * Monochrome: background-depth-1, border, textSecondary. No accent colors.
 */

import { memo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { Shimmer } from './Shimmer';

export interface ReasoningStep {
  text: string;

  /** Optional: timestamp or duration for this step. */
  duration?: number;
}

interface ReasoningProps {
  isStreaming?: boolean;
  steps: ReasoningStep[];
  className?: string;
}

function ReasoningImpl({ isStreaming = false, steps, className }: ReasoningProps) {
  const [expanded, setExpanded] = useState(isStreaming);

  // Auto-expand when streaming starts, auto-collapse 2s after it ends
  useEffect(() => {
    if (isStreaming) {
      setExpanded(true);
      return undefined;
    }

    const t = setTimeout(() => setExpanded(false), 2000);

    return () => clearTimeout(t);
  }, [isStreaming]);

  if (steps.length === 0 && !isStreaming) {
    return null;
  }

  const totalText = steps
    .map((s) => s.text)
    .join('\n\n')
    .trim();

  if (!totalText && !isStreaming) {
    return null;
  }

  return (
    <div className={classNames('mb-3', className)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md bg-palmkit-elements-background-depth-1 border border-palmkit-elements-borderColor text-left hover:bg-palmkit-elements-background-depth-2 transition-colors"
      >
        <div
          className={classNames(
            'text-sm text-palmkit-elements-textSecondary transition-transform',
            expanded && 'rotate-90',
            'i-ph:caret-right-bold',
          )}
        />
        <div className="i-ph:brain text-sm text-palmkit-elements-textSecondary" />
        <span className="text-xs font-medium text-palmkit-elements-textSecondary flex-1">
          {isStreaming ? (
            <Shimmer>Thinking…</Shimmer>
          ) : (
            `Thought process (${steps.length} step${steps.length === 1 ? '' : 's'})`
          )}
        </span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-2 text-xs leading-relaxed text-palmkit-elements-textSecondary whitespace-pre-wrap border-l-2 border-palmkit-elements-borderColor ml-2 mt-1 max-h-64 overflow-y-auto">
              {totalText || (isStreaming ? '…' : '')}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const Reasoning = memo(ReasoningImpl);
