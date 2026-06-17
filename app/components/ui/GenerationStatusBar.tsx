import { useStore } from '@nanostores/react';
import {
  generationStatusStore,
  GENERATION_STEP_LABELS,
  resetGenerationStatus,
  setGenerationStep,
} from '~/lib/stores/generationStatus';
import { classNames } from '~/utils/classNames';
import { AgentStatusPill, type AgentStatus } from './workspace/AgentStatusPill';

const STEPS_ORDER = ['waiting-for-model', 'creating-files', 'updating-workspace', 'starting-preview', 'done'] as const;

/**
 * Maps a GenerationStep to an AgentStatus for the AgentStatusPill.
 */
function stepToAgentStatus(step: string, isStuck: boolean): AgentStatus {
  if (isStuck) {
    return 'stuck';
  }

  switch (step) {
    case 'waiting-for-model':
      return 'thinking';
    case 'creating-files':
    case 'updating-workspace':
    case 'starting-preview':
      return 'generating';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export function GenerationStatusBar() {
  const status = useStore(generationStatusStore);

  if (status.step === 'idle') {
    return null;
  }

  const isDone = status.step === 'done';
  const isError = status.step === 'error';
  const isActive = !isDone && !isError;
  const agentStatus = stepToAgentStatus(status.step, status.isStuck);

  return (
    <div
      className={classNames(
        'relative overflow-hidden',
        'flex items-center gap-3 px-4 py-2.5 text-sm',
        'border-b transition-all duration-[var(--palmkit-duration-slower)] ease-out',
        isError
          ? 'bg-[var(--palmkit-mobile-error-muted)] border-[rgba(248,113,113,0.2)] text-[var(--palmkit-mobile-error)]'
          : isDone
            ? 'bg-[var(--palmkit-mobile-success-muted)] border-[rgba(74,222,128,0.2)] text-[var(--palmkit-mobile-success)]'
            : 'bg-[var(--palmkit-mobile-accent-faint)] border-[var(--palmkit-mobile-surface-border)] text-[var(--palmkit-mobile-accent-text)]',
      )}
    >
      {/* Progress bar background */}
      {isActive && (
        <div className="absolute inset-0 opacity-15">
          <div
            className="h-full bg-gradient-to-r from-[var(--palmkit-gradient-start)] to-[var(--palmkit-gradient-end)] transition-all duration-1000 ease-out"
            style={{
              width: `${
                isDone
                  ? 100
                  : isError
                    ? 0
                    : Math.min(
                        Math.round((STEPS_ORDER.indexOf(status.step as any) / (STEPS_ORDER.length - 1)) * 100),
                        90,
                      )
              }%`,
            }}
          />
        </div>
      )}

      {/* Agent status pill */}
      <AgentStatusPill status={agentStatus} compact={isActive} />

      {/* Status text */}
      <span className="relative font-medium truncate">{GENERATION_STEP_LABELS[status.step]}</span>

      {/* Current file being created */}
      {status.currentFile && isActive && (
        <span className="relative text-xs opacity-70 truncate max-w-[200px] font-mono">
          {status.currentFile.split('/').pop()}
        </span>
      )}

      {/* Step dots indicator */}
      {isActive && (
        <div className="relative flex items-center gap-1 ml-1">
          {STEPS_ORDER.slice(0, -1).map((step, i) => {
            const currentStepIndex = STEPS_ORDER.indexOf(status.step as any);

            return (
              <div
                key={step}
                className={classNames(
                  'w-1.5 h-1.5 rounded-full transition-all duration-[var(--palmkit-duration-moderate)]',
                  i < currentStepIndex
                    ? 'bg-[var(--palmkit-mobile-accent)]'
                    : i === currentStepIndex
                      ? 'bg-[var(--palmkit-mobile-accent)] scale-125'
                      : 'bg-[var(--palmkit-mobile-surface-border)]',
                )}
              />
            );
          })}
        </div>
      )}

      {/* Elapsed time */}
      {isActive && status.startTime && Math.round((Date.now() - status.startTime) / 1000) > 5 && (
        <span className="relative text-xs opacity-50 ml-auto shrink-0 font-mono">
          {Math.round((Date.now() - status.startTime) / 1000)}s
        </span>
      )}

      {/* Stuck indicator */}
      {status.isStuck && (
        <div className="relative flex items-center gap-2 ml-auto shrink-0">
          <span className="text-xs text-[var(--palmkit-mobile-warning)] font-medium animate-pulse">Seems stuck?</span>
          <button
            onClick={() => {
              resetGenerationStatus();
            }}
            className="text-xs px-2.5 py-1 rounded-[var(--palmkit-radius-sm)] bg-[var(--palmkit-mobile-error-muted)] text-[var(--palmkit-mobile-error)] hover:bg-[rgba(248,113,113,0.2)] transition-all duration-[var(--palmkit-duration-normal)] active:scale-95"
          >
            Stop
          </button>
          <button
            onClick={() => {
              setGenerationStep('waiting-for-model');
            }}
            className="text-xs px-2.5 py-1 rounded-[var(--palmkit-radius-sm)] bg-[var(--palmkit-mobile-accent-muted)] text-[var(--palmkit-mobile-accent-text)] hover:bg-[rgba(0,0,0,0.12)] transition-all duration-[var(--palmkit-duration-normal)] active:scale-95"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
