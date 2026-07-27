import { memo } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * EmptyWorkspaceState
 *
 * Premium first-impression empty state for the AI workspace.
 * Dark developer-tool aesthetic with purple/violet accent system.
 * Designed to feel crafted, not dumped — with gradient text, floating logo,
 * glass morphism CTAs, and staggered entrance animations.
 *
 * Usage:
 *   <EmptyWorkspaceState
 *     onNewProject={() => {}}
 *     onImportChat={() => {}}
 *     onCloneRepo={() => {}}
 *   />
 */

interface EmptyWorkspaceStateProps {
  onNewProject?: () => void;
  onImportChat?: () => void;
  onCloneRepo?: () => void;
  className?: string;
}

export const EmptyWorkspaceState = memo(
  ({ onNewProject, onImportChat, onCloneRepo, className }: EmptyWorkspaceStateProps) => {
    return (
      <div
        className={classNames(
          'flex flex-col items-center justify-center',
          'px-[var(--palmkit-space-6)] py-[var(--palmkit-space-12)]',
          'min-h-[60dvh] w-full max-w-md mx-auto',
          'text-center',
          className,
        )}
      >
        {/* Logo / icon — floating with accent glow */}
        <div
          className={classNames(
            'w-16 h-16 rounded-[var(--palmkit-radius-xl)]',
            'flex items-center justify-center',
            'mb-[var(--palmkit-space-6)]',
            'bg-gradient-to-br from-[var(--palmkit-gradient-start)] to-[var(--palmkit-gradient-end)]',
            'shadow-[var(--palmkit-shadow-accent-strong)]',
            'animate-float-subtle',
          )}
        >
          <div className="i-ph:lightning-fill text-4xl text-white" />
        </div>

        {/* Heading — gradient text */}
        <h1 className="text-[var(--palmkit-text-2xl)] font-bold gradient-text mb-[var(--palmkit-space-2)]">
          Start a Project
        </h1>

        {/* Description */}
        <p
          className={classNames(
            'text-[var(--palmkit-text-sm)]',
            'text-[var(--palmkit-mobile-text-secondary)]',
            'leading-[1.7]',
            'mb-[var(--palmkit-space-8)]',
            'max-w-[300px]',
          )}
        >
          Describe what you want to build and the AI will generate a full project for you.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col gap-[var(--palmkit-space-3)] w-full max-w-[280px]">
          {/* Primary CTA — full gradient */}
          <button
            onClick={onNewProject}
            className={classNames(
              'w-full flex items-center justify-center gap-2',
              'py-3 px-6 rounded-[var(--palmkit-radius-md)]',
              'bg-gradient-to-r from-[var(--palmkit-gradient-start)] to-[var(--palmkit-gradient-mid)]',
              'text-white font-semibold text-[var(--palmkit-text-md)]',
              'shadow-[var(--palmkit-shadow-accent)]',
              'hover:shadow-[var(--palmkit-shadow-accent-strong)]',
              'active:scale-[0.97]',
              'transition-all duration-[var(--palmkit-duration-normal)]',
              'animate-fade-in-up',
              'opacity-0',
            )}
          >
            <div className="i-ph:plus-circle text-base" />
            Start New Project
          </button>

          {/* Secondary CTAs — glass morphism */}
          <div className="flex gap-[var(--palmkit-space-2)]">
            <button
              onClick={onImportChat}
              className={classNames(
                'flex-1 flex items-center justify-center gap-1.5',
                'py-[var(--palmkit-space-2)] px-[var(--palmkit-space-3)]',
                'rounded-[var(--palmkit-radius-md)]',
                'bg-[var(--palmkit-mobile-accent-faint)]',
                'text-[var(--palmkit-mobile-accent-text)] text-[var(--palmkit-text-xs)] font-medium',
                'border border-[var(--palmkit-mobile-surface-border)]',
                'hover:border-[var(--palmkit-mobile-surface-border-strong)]',
                'hover:bg-[var(--palmkit-mobile-accent-subtle)]',
                'active:scale-[0.97]',
                'transition-all duration-[var(--palmkit-duration-normal)]',
                'animate-fade-in-up animation-delay-100',
                'opacity-0',
              )}
            >
              <div className="i-ph:chat-centered-dots text-sm" />
              Import Chat
            </button>
            <button
              onClick={onCloneRepo}
              className={classNames(
                'flex-1 flex items-center justify-center gap-1.5',
                'py-[var(--palmkit-space-2)] px-[var(--palmkit-space-3)]',
                'rounded-[var(--palmkit-radius-md)]',
                'bg-[var(--palmkit-mobile-accent-faint)]',
                'text-[var(--palmkit-mobile-accent-text)] text-[var(--palmkit-text-xs)] font-medium',
                'border border-[var(--palmkit-mobile-surface-border)]',
                'hover:border-[var(--palmkit-mobile-surface-border-strong)]',
                'hover:bg-[var(--palmkit-mobile-accent-subtle)]',
                'active:scale-[0.97]',
                'transition-all duration-[var(--palmkit-duration-normal)]',
                'animate-fade-in-up animation-delay-200',
                'opacity-0',
              )}
            >
              <div className="i-ph:git-clone text-sm" />
              Clone Repo
            </button>
          </div>
        </div>

        {/* Hint text */}
        <p className="text-[var(--palmkit-text-2xs)] text-[var(--palmkit-mobile-text-tertiary)] mt-[var(--palmkit-space-8)]">
          or just start typing in the chat below
        </p>
      </div>
    );
  },
);

EmptyWorkspaceState.displayName = 'EmptyWorkspaceState';
