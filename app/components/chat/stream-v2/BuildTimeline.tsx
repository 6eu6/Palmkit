/**
 * BuildTimeline — Code-mode-only build progress renderer
 * ======================================================
 *
 * This component is LAZY LOADED only in code mode. It wraps the
 * existing BuildStream component (which reads from workerEventsStore)
 * and adds:
 *   - Validation status display (from annotation)
 *   - Past turn support (via TurnBuildStream)
 *   - Progress bar
 *
 * Why lazy load?
 *   BuildStream.tsx is 1744 lines (~65KB). Loading it in chat/work
 *   mode would blow past the 3MiB CF Pages bundle limit. By lazy
 *   loading, chat/work users never download this code.
 */

import { memo } from 'react';
import { useStore } from '@nanostores/react';
import { workerEventsStore, workerProgressStore } from '~/lib/stores/build-status';
import { BuildStreamView } from '~/components/chat/BuildStream';
import { TurnBuildStream } from '~/components/chat/TurnBuildStream';

interface BuildTimelineProps {
  buildJobId?: string;
  isStreaming?: boolean;
  validationAnnotation?: { type: string; value: any } | undefined;
  isPastBuild?: boolean;
}

function BuildTimelineImpl({ buildJobId, isStreaming, validationAnnotation, isPastBuild }: BuildTimelineProps) {
  const events = useStore(workerEventsStore);
  const progressStore = useStore(workerProgressStore);
  const progress = typeof progressStore === 'number' ? progressStore : progressStore.progress;

  // Past build (completed earlier in the thread)
  if (isPastBuild && buildJobId) {
    return <TurnBuildStream jobId={buildJobId} />;
  }

  // Live build (currently streaming)
  if (isStreaming && events.length > 0) {
    return (
      <div className="mt-3">
        <BuildStreamView events={events} progress={progress} currentStep="building" defaultOpen={true} />
        {validationAnnotation && <ValidationStatus annotation={validationAnnotation} />}
      </div>
    );
  }

  // Completed build with validation result
  if (validationAnnotation && !isStreaming) {
    return <ValidationStatus annotation={validationAnnotation} />;
  }

  return null;
}

/**
 * Validation status display — shows the validation result
 * (complete, incomplete, failed) as a clean status card.
 */
const ValidationStatus = memo(({ annotation }: { annotation: { type: string; value: any } }) => {
  const v = annotation.value;

  if (!v) {
    return null;
  }

  const isComplete = v.completeness === 'complete';
  const isError = v.completeness === 'garbage' || v.completeness === 'invalid';

  return (
    <div
      className={`mt-2 p-3 rounded-md border text-xs ${
        isComplete
          ? 'bg-palmkit-elements-icon-success/5 border-palmkit-elements-icon-success/20 text-palmkit-elements-icon-success'
          : isError
            ? 'bg-palmkit-elements-icon-error/5 border-palmkit-elements-icon-error/20 text-palmkit-elements-icon-error'
            : 'bg-palmkit-elements-icon-warning/5 border-palmkit-elements-icon-warning/20 text-palmkit-elements-textSecondary'
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`text-base ${
            isComplete ? 'i-ph:check-circle' : isError ? 'i-ph:x-circle' : 'i-ph:warning-circle'
          }`}
        />
        <span className="font-medium">
          {isComplete
            ? 'Build complete'
            : isError
              ? `Build failed: ${v.issues?.[0]?.message || 'Unknown error'}`
              : `Build incomplete (${v.retryCount || 0} retries)`}
        </span>
        {v.fileCount > 0 && <span className="ml-auto text-palmkit-elements-textSecondary">{v.fileCount} files</span>}
      </div>
      {!isComplete && v.issues && v.issues.length > 0 && (
        <ul className="mt-2 ml-6 list-disc space-y-0.5">
          {v.issues.slice(0, 3).map((issue: any, idx: number) => (
            <li key={idx} className="text-palmkit-elements-textSecondary">
              {issue.message}
            </li>
          ))}
          {v.issues.length > 3 && (
            <li className="text-palmkit-elements-textSecondary italic">... and {v.issues.length - 3} more</li>
          )}
        </ul>
      )}
    </div>
  );
});

export const BuildTimeline = memo(BuildTimelineImpl);
