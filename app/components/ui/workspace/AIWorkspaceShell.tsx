import { memo, type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * WorkspaceShell
 *
 * Provides the consistent mobile page background with a refined
 * grid pattern and radial glow. Premium dark developer aesthetic.
 *
 * Usage:
 *   <WorkspaceShell>
 *     <ChatView />
 *   </WorkspaceShell>
 */

interface WorkspaceShellProps {
  children: ReactNode;

  /** Optional class name for the inner content area */
  className?: string;

  /** Show the subtle grid/noise background pattern */
  showBackgroundPattern?: boolean;

  /** ID for the scrollable content area */
  contentId?: string;
}

export const WorkspaceShell = memo(
  ({ children, className, showBackgroundPattern = true, contentId }: WorkspaceShellProps) => {
    return (
      <div
        className={classNames(
          'relative flex flex-col min-h-dvh w-full overflow-x-hidden',
          'bg-palmkit-elements-bg-depth-1',
          className,
        )}
      >
        {/* Subtle background pattern — grid + radial glow */}
        {showBackgroundPattern && (
          <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
            {/* Grid pattern — purple tinted, subtle */}
            <div
              className="absolute inset-0 opacity-[0.02] dark:opacity-[0.035]"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(139, 92, 246, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.4) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }}
            />
            {/* Radial glow — top center */}
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse 70% 50% at 50% 0%, var(--palmkit-glow-color), transparent 70%)',
              }}
            />
            {/* Secondary subtle vignette */}
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse 40% 30% at 50% 100%, rgba(139, 92, 246, 0.03), transparent)',
              }}
            />
          </div>
        )}

        {/* Main content */}
        <main id={contentId} className={classNames('relative z-1 flex-1 flex flex-col w-full overflow-x-hidden')}>
          {children}
        </main>
      </div>
    );
  },
);

WorkspaceShell.displayName = 'WorkspaceShell';
