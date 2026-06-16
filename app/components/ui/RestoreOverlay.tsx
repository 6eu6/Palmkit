import { useStore } from '@nanostores/react';
import { motion, AnimatePresence } from 'framer-motion';
import { restoreStatusStore, isRestoring, RESTORE_STEP_LABELS, type RestoreStep } from '~/lib/stores/generationStatus';
import { classNames } from '~/utils/classNames';
import { RestoreSnapshotCard, type RestoreSnapshotStatus } from './workspace/RestoreSnapshotCard';

const RESTORE_ICONS: Record<RestoreStep, string> = {
  idle: 'i-ph:circle-notch',
  'loading-messages': 'i-ph:chat-circle-dots',
  'restoring-chat': 'i-ph:chat-centered-text',
  'restoring-files': 'i-ph:folder-open',
  'restoring-webcontainer': 'i-ph:cube',
  done: 'i-ph:check-circle',
  error: 'i-ph:warning-circle',
};

const STEP_ORDER: RestoreStep[] = ['loading-messages', 'restoring-chat', 'restoring-files', 'restoring-webcontainer'];

/**
 * Maps RestoreStep to RestoreSnapshotStatus for RestoreSnapshotCard.
 */
function restoreStepToStatus(step: RestoreStep, wasInterrupted: boolean): RestoreSnapshotStatus {
  switch (step) {
    case 'done':
      return wasInterrupted ? 'interrupted-restored' : 'restored';
    case 'error':
      return 'restore-failed';
    default:
      return 'restoring';
  }
}

export function RestoreOverlay() {
  const restoring = useStore(isRestoring);
  const status = useStore(restoreStatusStore);

  const currentStepIndex = STEP_ORDER.indexOf(status.step);
  const snapshotStatus = restoreStepToStatus(status.step, status.wasInterrupted);

  return (
    <AnimatePresence>
      {restoring && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--palmkit-mobile-surface-bg-overlay)] backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="flex w-full max-w-sm flex-col items-center gap-6 p-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.5, delay: 0.1, type: 'spring', stiffness: 200, damping: 25 }}
          >
            {/* Main spinner */}
            <div className="relative">
              <div className="h-16 w-16 animate-spin rounded-full border-4 border-[var(--palmkit-mobile-accent-faint)] border-t-[var(--palmkit-mobile-accent-text)]" />
              <div
                className={classNames(
                  'absolute inset-0 flex items-center justify-center',
                  'text-[var(--palmkit-mobile-accent-text)]',
                )}
              >
                <div className={classNames(RESTORE_ICONS[status.step], 'text-2xl')} />
              </div>
            </div>

            {/* Status text */}
            <div className="text-center">
              <h2 className="text-lg font-semibold text-[var(--palmkit-mobile-text-primary)]">Restoring Workspace</h2>
              <p className="mt-2 text-sm text-[var(--palmkit-mobile-text-secondary)]">
                {RESTORE_STEP_LABELS[status.step]}
              </p>
            </div>

            {/* Step indicators */}
            <div className="flex w-full items-center justify-center gap-2">
              {STEP_ORDER.map((step, idx) => {
                const isCompleted = currentStepIndex > idx;
                const isCurrent = currentStepIndex === idx;
                const isPending = currentStepIndex < idx;

                return (
                  <div key={step} className="flex items-center gap-2">
                    <div
                      className={classNames(
                        'h-2.5 w-2.5 rounded-full transition-all duration-300',
                        isCompleted && 'bg-[var(--palmkit-mobile-success)]',
                        isCurrent &&
                          'scale-125 bg-[var(--palmkit-mobile-accent-text)] ring-2 ring-[var(--palmkit-mobile-accent)]/30',
                        isPending && 'bg-[var(--palmkit-mobile-accent-faint)]',
                      )}
                    />
                    {idx < STEP_ORDER.length - 1 && (
                      <div
                        className={classNames(
                          'h-0.5 w-6 transition-colors duration-300',
                          isCompleted ? 'bg-[var(--palmkit-mobile-success)]/60' : 'bg-[var(--palmkit-mobile-surface-border)]',
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* RestoreSnapshotCard for interrupted restore */}
            {status.wasInterrupted && (
              <RestoreSnapshotCard status={snapshotStatus} wasInterrupted={status.wasInterrupted} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
