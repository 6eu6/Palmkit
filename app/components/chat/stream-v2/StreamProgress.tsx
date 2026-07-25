/**
 * StreamProgress — Monochrome progress indicator (v2)
 * ====================================================
 *
 * Shows the current stream phase as a subtle progress bar.
 * Uses Shimmer for the phase label while streaming.
 *
 * Monochrome: single bar using textSecondary. No colored phases.
 * Icon changes per phase (all Phosphor, all textSecondary).
 */

import { memo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { sidebarModeStore } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';
import { Shimmer } from '~/components/ai-elements/Shimmer';

interface StreamProgressProps {
  isStreaming: boolean;
  phase?: string;
  status?: 'in-progress' | 'complete' | 'error';
}

function getPhaseIcon(phase: string, mode: string): string {
  const lower = (phase || '').toLowerCase();

  if (lower.includes('error') || lower.includes('fail')) {
    return 'i-ph:x-circle';
  }

  if (lower.includes('complete') || lower.includes('done')) {
    return 'i-ph:check-circle';
  }

  if (lower.includes('orchestrat') || lower.includes('plan')) {
    return 'i-ph:strategy';
  }

  if (lower.includes('valid')) {
    return 'i-ph:check-square';
  }

  if (lower.includes('summary') || lower.includes('context')) {
    return 'i-ph:magnifying-glass';
  }

  if (lower.includes('tool') || lower.includes('search')) {
    return 'i-ph:wrench';
  }

  if (lower.includes('build') || lower.includes('response')) {
    return mode === 'code' ? 'i-ph:hammer' : 'i-ph:pencil-simple';
  }

  return 'i-ph:brain';
}

function getPhaseLabel(phase: string, mode: string): string {
  const lower = (phase || '').toLowerCase();

  if (lower.includes('error') || lower.includes('fail')) {
    return 'Error';
  }

  if (lower.includes('complete') || lower.includes('done')) {
    return 'Complete';
  }

  if (mode === 'code') {
    if (lower.includes('orchestrat') || lower.includes('plan')) {
      return 'Planning';
    }

    if (lower.includes('valid')) {
      return 'Validating';
    }

    if (lower.includes('summary') || lower.includes('context')) {
      return 'Analyzing context';
    }

    if (lower.includes('build') || lower.includes('response')) {
      return 'Building';
    }

    return 'Building';
  }

  if (lower.includes('tool') || lower.includes('search')) {
    return 'Working with tools';
  }

  if (lower.includes('response') || lower.includes('generat')) {
    return 'Generating';
  }

  return 'Thinking';
}

function StreamProgressImpl({ isStreaming, phase, status = 'in-progress' }: StreamProgressProps) {
  const sidebarMode = useStore(sidebarModeStore);
  const [visible, setVisible] = useState(false);
  const [autoProgress, setAutoProgress] = useState(0);

  useEffect(() => {
    if (!isStreaming) {
      setAutoProgress(100);

      const t = setTimeout(() => setVisible(false), 2500);

      return () => clearTimeout(t);
    }

    setVisible(true);
    setAutoProgress(5);

    const interval = setInterval(() => {
      setAutoProgress((prev) => {
        const remaining = 90 - prev;
        return Math.min(prev + Math.max(0.5, remaining * 0.05), 90);
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isStreaming]);

  if (!visible && !isStreaming) {
    return null;
  }

  const icon = getPhaseIcon(phase || '', sidebarMode);
  const label = getPhaseLabel(phase || '', sidebarMode);
  const barProgress = autoProgress;
  const isError = status === 'error';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="sticky top-0 z-10 px-3 py-1.5 bg-palmkit-elements-background-depth-2/80 backdrop-blur-sm border-b border-palmkit-elements-borderColor"
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className={classNames(
                'text-sm text-palmkit-elements-textSecondary',
                icon,
                isStreaming && !isError && 'animate-spin',
              )}
              style={isStreaming && !isError ? { animationDuration: '2s' } : undefined}
            />
            <span className="text-xs font-medium text-palmkit-elements-textSecondary">
              {isStreaming ? <Shimmer>{label}</Shimmer> : label}
            </span>
            <span className="ml-auto text-[10px] text-palmkit-elements-textSecondary">{Math.round(barProgress)}%</span>
          </div>

          {/* Progress bar — monochrome */}
          <div className="h-0.5 rounded-full bg-palmkit-elements-background-depth-3 overflow-hidden">
            <motion.div
              className={classNames(
                'h-full rounded-full transition-colors',
                isError ? 'bg-palmkit-elements-textPrimary' : 'bg-palmkit-elements-textSecondary',
              )}
              initial={{ width: '0%' }}
              animate={{ width: `${barProgress}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const StreamProgress = memo(StreamProgressImpl);
