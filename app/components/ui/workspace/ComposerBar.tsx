import { memo, type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';

/**
 * ComposerBar
 *
 * Premium "command center" chat input for the AI workspace.
 * Dark developer-tool aesthetic with purple/violet accent system.
 *
 * Features:
 * - Provider/model pill-shaped badges
 * - API key status dot (success/error)
 * - Attach, web, enhance, mic buttons with 36px touch targets
 * - Send/Stop with gradient and error states
 * - Press feedback on all interactive elements
 *
 * This is a wrapper/layout component — it renders children in a structured way.
 * The actual input and button logic come from the existing ChatBox.
 */

interface ComposerBarProps {
  children: ReactNode;

  /** Provider name for compact display */
  providerName?: string;

  /** Model name for compact display */
  modelName?: string;

  /** Whether API key is configured */
  hasApiKey?: boolean;

  /** Whether the model is currently streaming */
  isStreaming?: boolean;

  /** Send handler */
  onSend?: () => void;

  /** Stop handler */
  onStop?: () => void;

  /** Attachment button click */
  onAttach?: () => void;

  /** Web search button click */
  onWebSearch?: () => void;

  /** Enhance prompt button click */
  onEnhance?: () => void;

  /** Mic button click */
  onMic?: () => void;

  /** Is enhance in progress */
  enhancing?: boolean;

  /** Is mic active */
  isListening?: boolean;

  /** Action buttons slot — for full control */
  actionsSlot?: ReactNode;
  className?: string;
}

export const ComposerBar = memo(
  ({
    children,
    providerName,
    modelName,
    hasApiKey,
    isStreaming = false,
    onSend,
    onStop,
    onAttach,
    onWebSearch,
    onEnhance,
    onMic,
    enhancing,
    isListening,
    actionsSlot,
    className,
  }: ComposerBarProps) => {
    return (
      <div
        className={classNames(
          'relative w-full max-w-chat mx-auto',
          'bg-[var(--palmkit-mobile-surface-bg-elevated)] backdrop-blur-xl',
          'rounded-[var(--palmkit-radius-lg)]',
          'border border-[var(--palmkit-mobile-surface-border)]',
          'shadow-[var(--palmkit-shadow-md)]',
          'transition-shadow duration-[var(--palmkit-duration-normal)]',
          'hover:shadow-[var(--palmkit-shadow-accent)]',
          'overflow-hidden',
          className,
        )}
      >
        {/* Provider/model compact header */}
        {(providerName || modelName) && (
          <div className="flex items-center gap-1.5 px-[var(--palmkit-space-3)] pt-[var(--palmkit-space-2)] pb-[var(--palmkit-space-1)]">
            {providerName && (
              <span
                className={classNames(
                  'text-[var(--palmkit-text-2xs)] font-medium',
                  'text-[var(--palmkit-mobile-accent-text)]',
                  'bg-[var(--palmkit-mobile-accent-faint)]',
                  'px-[var(--palmkit-space-2)] py-[2px]',
                  'rounded-[var(--palmkit-radius-pill)]',
                  'border border-[var(--palmkit-mobile-surface-border-subtle)]',
                )}
              >
                {providerName}
              </span>
            )}
            {modelName && (
              <span
                className={classNames(
                  'text-[var(--palmkit-text-2xs)] font-mono',
                  'text-[var(--palmkit-mobile-text-secondary)]',
                  'bg-[var(--palmkit-mobile-accent-faint)]',
                  'px-[var(--palmkit-space-2)] py-[2px]',
                  'rounded-[var(--palmkit-radius-pill)]',
                  'border border-[var(--palmkit-mobile-surface-border-subtle)]',
                  'truncate max-w-[180px]',
                )}
              >
                {modelName}
              </span>
            )}
            {hasApiKey !== undefined && (
              <div
                className={classNames(
                  'w-[6px] h-[6px] rounded-full shrink-0 ml-auto',
                  hasApiKey ? 'bg-[var(--palmkit-mobile-success)]' : 'bg-[var(--palmkit-mobile-error)]',
                )}
                title={hasApiKey ? 'API key configured' : 'API key missing'}
              />
            )}
          </div>
        )}

        {/* Input area */}
        <div className="px-[var(--palmkit-space-3)] py-[var(--palmkit-space-1)]">{children}</div>

        {/* Action bar */}
        {actionsSlot ? (
          <div className="flex items-center gap-1 px-[var(--palmkit-space-2)] pb-[var(--palmkit-space-2)] pt-[var(--palmkit-space-1)]">
            {actionsSlot}
          </div>
        ) : (
          <div className="flex items-center gap-1 px-[var(--palmkit-space-2)] pb-[var(--palmkit-space-2)] pt-[var(--palmkit-space-1)]">
            {/* Attach */}
            {onAttach && <ComposerIconButton icon="i-ph:paperclip" label="Attach" onClick={onAttach} />}

            {/* Web search */}
            {onWebSearch && (
              <ComposerIconButton icon="i-ph:globe" label="Search" onClick={onWebSearch} disabled={isStreaming} />
            )}

            {/* Enhance */}
            {onEnhance && (
              <ComposerIconButton
                icon={enhancing ? 'i-svg-spinners:90-ring-with-bg' : 'i-palmkit:stars'}
                label="Enhance"
                onClick={onEnhance}
                disabled={isStreaming}
                spinning={enhancing}
              />
            )}

            {/* Mic */}
            {onMic && (
              <ComposerIconButton
                icon="i-ph:microphone"
                label="Mic"
                onClick={onMic}
                active={isListening}
                disabled={isStreaming}
              />
            )}

            {/* Send / Stop */}
            <div className="ml-auto flex items-center">
              {isStreaming ? (
                <button
                  onClick={onStop}
                  className={classNames(
                    'flex items-center justify-center w-9 h-9 rounded-lg',
                    'bg-[var(--palmkit-mobile-error-muted)] text-[var(--palmkit-mobile-error)]',
                    'border border-[var(--palmkit-mobile-error)]/20',
                    'hover:bg-[var(--palmkit-mobile-error-muted)]/80',
                    'active:scale-[0.9]',
                    'transition-transform duration-[var(--palmkit-duration-fast)]',
                  )}
                  aria-label="Stop generation"
                >
                  <div className="i-ph:stop-fill text-sm" />
                </button>
              ) : (
                <button
                  onClick={onSend}
                  className={classNames(
                    'flex items-center justify-center w-9 h-9 rounded-lg',
                    'bg-gradient-to-r from-[var(--palmkit-gradient-start)] to-[var(--palmkit-gradient-mid)]',
                    'text-white',
                    'hover:shadow-[var(--palmkit-shadow-accent)]',
                    'active:scale-[0.9]',
                    'transition-all duration-[var(--palmkit-duration-fast)]',
                  )}
                  aria-label="Send message"
                >
                  <div className="i-ph:arrow-up text-sm" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

ComposerBar.displayName = 'ComposerBar';

/** Compact icon button for the composer bar */
interface ComposerIconButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  spinning?: boolean;
}

const ComposerIconButton = memo(({ icon, label, onClick, disabled, active, spinning }: ComposerIconButtonProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={classNames(
      'flex items-center justify-center w-9 h-9 rounded-lg',
      'text-[var(--palmkit-mobile-text-secondary)]',
      'hover:text-[var(--palmkit-mobile-text-primary)]',
      'hover:bg-[var(--palmkit-mobile-accent-faint)]',
      'active:scale-[0.9]',
      'transition-all duration-[var(--palmkit-duration-fast)]',
      'disabled:opacity-40 disabled:pointer-events-none',
      active &&
        'text-[var(--palmkit-mobile-accent-text)] bg-[var(--palmkit-mobile-accent-muted)] ring-2 ring-[var(--palmkit-mobile-accent)]',
      spinning && 'animate-spin',
    )}
    aria-label={label}
    title={label}
  >
    <div className={classNames(icon, 'text-lg')} />
  </button>
));

ComposerIconButton.displayName = 'ComposerIconButton';
