/**
 * Shimmer — Animated loading text/background
 * ==========================================
 *
 * Two modes:
 *   <Shimmer>Generating response…</Shimmer>
 *   → renders text with a shimmer gradient sweep
 *
 *   <Shimmer.Background className="h-4 w-48 rounded" />
 *   → renders a placeholder block with shimmer
 *
 * Monochrome: uses textSecondary → textPrimary → textSecondary gradient.
 * No colors, no bright accents.
 */

import { memo, type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';

interface ShimmerProps {
  children?: ReactNode;
  className?: string;
}

function ShimmerImpl({ children, className }: ShimmerProps) {
  if (!children) {
    return null;
  }

  return <span className={classNames('ai-shimmer-text', className)}>{children}</span>;
}

function ShimmerBackgroundImpl({ className }: { className?: string }) {
  return <div className={classNames('ai-shimmer-bg', className)} />;
}

export const Shimmer = Object.assign(memo(ShimmerImpl), {
  Background: memo(ShimmerBackgroundImpl),
});
