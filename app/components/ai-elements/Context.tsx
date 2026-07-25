/**
 * Context — Model usage display
 * ==============================
 *
 * Provides a view of AI model usage through a compound component
 * system: tokens used, cost, response time.
 *
 * <Context
 *   usage={{ promptTokens: 1200, completionTokens: 800, totalTokens: 2000 }}
 *   model="gpt-4o"
 *   duration={3500}
 * />
 *
 * Monochrome: all text is textSecondary. No colored badges.
 */

import { memo } from 'react';
import { classNames } from '~/utils/classNames';

interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface ContextProps {
  usage?: Usage;
  model?: string;
  duration?: number;
  className?: string;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }

  return String(n);
}

function ContextImpl({ usage, model, duration, className }: ContextProps) {
  if (!usage && !model && !duration) {
    return null;
  }

  return (
    <div className={classNames('flex items-center gap-3 text-[10px] text-palmkit-elements-textSecondary', className)}>
      {model && (
        <div className="flex items-center gap-1">
          <div className="i-ph:cpu text-xs" />
          <span>{model}</span>
        </div>
      )}
      {duration && (
        <div className="flex items-center gap-1">
          <div className="i-ph:timer text-xs" />
          <span>{formatDuration(duration)}</span>
        </div>
      )}
      {usage && (
        <div className="flex items-center gap-1">
          <div className="i-ph:hash text-xs" />
          <span>
            {formatTokens(usage.totalTokens)} tokens
            <span className="text-palmkit-elements-textSecondary/60">
              {' '}
              ({formatTokens(usage.promptTokens)} in / {formatTokens(usage.completionTokens)} out)
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export const Context = memo(ContextImpl);
