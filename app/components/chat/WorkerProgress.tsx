/**
 * Phase 5 / Phase 10 — Worker Progress UI
 *
 * Shows real-time Oracle Worker build events with:
 *   - Progress bar from actual Oracle Worker progress (0-100%)
 *   - Stage pipeline: Queued → Plan → Generate → Validate → Build → Upload → Done
 *   - Collapsible event log
 *   - File count badge
 */

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workerEventsStore, workerProgressStore, type WorkerEvent } from '~/lib/stores/build-status';
import { classNames } from '~/utils/classNames';

const ICON_DONE = 'i-ph:check-circle-fill text-green-400';
const ICON_RUNNING = 'i-svg-spinners:90-ring-with-bg text-palmkit-elements-loader-progress animate-spin';
const ICON_ERROR = 'i-ph:x-circle-fill text-red-400';
const ICON_WARN = 'i-ph:warning-fill text-yellow-400';

const TERMINAL_EVENTS = new Set(['ready_for_preview', 'job_failed']);
const ERROR_EVENTS = new Set(['job_failed', 'validation_failed', 'build_check_failed']);
const WARN_EVENTS = new Set(['repair_started']);

interface Stage {
  key: string;
  label: string;
}

const STAGES: Stage[] = [
  { key: 'queued', label: 'Queue' },
  { key: 'plan', label: 'Plan' },
  { key: 'generate', label: 'Generate' },
  { key: 'validate', label: 'Validate' },
  { key: 'build_check', label: 'Build' },
  { key: 'uploading', label: 'Upload' },
  { key: 'done', label: 'Done' },
];

function currentStageIndex(currentStep: string): number {
  const idx = STAGES.findIndex((s) => s.key === currentStep);

  return idx === -1 ? 0 : idx;
}

function eventIcon(event: WorkerEvent, isLast: boolean): string {
  if (ERROR_EVENTS.has(event.type)) {
    return ICON_ERROR;
  }

  if (WARN_EVENTS.has(event.type)) {
    return ICON_WARN;
  }

  if (isLast && !TERMINAL_EVENTS.has(event.type)) {
    return ICON_RUNNING;
  }

  return ICON_DONE;
}

function isFileWritten(event: WorkerEvent): boolean {
  return event.type === 'file_written' && (event.payload as any)?.kind !== 'edit' && (event.payload as any)?.kind !== 'delete';
}

/*
 * Filter out event types that are rendered by their own dedicated panels
 * (TodosPanel, ThoughtProcessPanel, ActivityStream). Without this filter,
 * the WorkerProgress log would show duplicate entries: once in the
 * specialized panel and once in the flat log.
 */
const HIDDEN_EVENT_TYPES = new Set([
  'reasoning',
  'todos_updated',
  'agent_started',
  'agent_completed',
  // step_start / step_end are not yet emitted — kept for future use
  'step_start',
  'step_end',
]);

export function WorkerProgress() {
  const events = useStore(workerEventsStore);
  const { progress, currentStep } = useStore(workerProgressStore);
  const [logsOpen, setLogsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsOpen) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [events.length, logsOpen]);

  if (events.length === 0 && progress === 0) {
    return null;
  }

  const isDone = currentStep === 'done' || events.some((e) => e.type === 'ready_for_preview');
  const isFailed = events.some((e) => ERROR_EVENTS.has(e.type));
  const fileCount = events.filter((e) => isFileWritten(e)).length;
  const stageIdx = isDone ? STAGES.length - 1 : currentStageIndex(currentStep);
  const displayProgress = isDone ? 100 : isFailed ? progress : Math.max(progress, stageIdx * 14);
  // Filter out events rendered by their own dedicated panels (TodosPanel,
  // ThoughtProcessPanel, ActivityStream) so the flat log doesn't duplicate.
  const visibleEvents = events.filter((e) => !HIDDEN_EVENT_TYPES.has(e.type));
  // Also hide file_chunk events that have an `agent` payload — those are
  // already shown in the ActivityStream. Keep file_chunk events without an
  // agent (e.g. "⏳ Building... (Ns)" from the keep-alive timer).
  const filteredEvents = visibleEvents.filter(
    (e) => !(e.type === 'file_chunk' && (e.payload as any)?.agent),
  );
  const displayItems = collapseFileEvents(filteredEvents);

  return (
    <div className="mx-4 mb-3 rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-bg-depth-2 overflow-hidden text-sm">
      {/* Progress bar */}
      <div className="h-1 bg-palmkit-elements-background-depth-1 relative">
        <div
          className={classNames(
            'h-full transition-all duration-700 ease-out',
            isFailed ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-gradient-to-r from-blue-500 to-violet-500',
          )}
          style={{ width: `${displayProgress}%` }}
        />
      </div>

      <div className="p-3">
        {/* Header row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className={classNames(
                'i-ph:hammer text-[11px]',
                isFailed ? 'text-red-400' : isDone ? 'text-green-400' : 'text-palmkit-elements-textTertiary',
              )}
            />
            <span className="text-xs font-medium uppercase tracking-wide text-palmkit-elements-textTertiary">
              {isFailed ? 'Build Failed' : isDone ? 'Build Complete' : 'Building'}
            </span>
            {!isDone && !isFailed && (
              <span className="text-xs font-mono text-palmkit-elements-textSecondary opacity-60">
                {displayProgress}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {fileCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-palmkit-elements-background-depth-1 text-palmkit-elements-textSecondary font-mono">
                {fileCount} file{fileCount !== 1 ? 's' : ''}
              </span>
            )}
            {events.length > 0 && (
              <button
                onClick={() => setLogsOpen((o) => !o)}
                className="text-[10px] text-palmkit-elements-textTertiary hover:text-palmkit-elements-textSecondary transition-colors flex items-center gap-0.5"
              >
                {logsOpen ? 'hide' : 'logs'}
                <div
                  className={classNames(
                    'i-ph:caret-down text-[10px] transition-transform',
                    logsOpen ? 'rotate-180' : '',
                  )}
                />
              </button>
            )}
          </div>
        </div>

        {/* Stage pipeline */}
        <div className="flex items-center gap-0">
          {STAGES.map((stage, i) => {
            const isPast = i < stageIdx;
            const isCurrent = i === stageIdx && !isDone;
            const isDoneStage = isDone || i < stageIdx;

            return (
              <React.Fragment key={stage.key}>
                <div className="flex flex-col items-center">
                  <div
                    className={classNames(
                      'w-2 h-2 rounded-full transition-all duration-300',
                      isFailed && isCurrent
                        ? 'bg-red-500'
                        : isDoneStage || isPast
                          ? 'bg-green-500'
                          : isCurrent
                            ? 'bg-blue-500 scale-125 ring-2 ring-blue-500/30'
                            : 'bg-palmkit-elements-borderColor',
                    )}
                  />
                  <span
                    className={classNames(
                      'text-[9px] mt-0.5 whitespace-nowrap',
                      isCurrent
                        ? 'text-blue-400 font-medium'
                        : isDoneStage || isPast
                          ? 'text-green-400'
                          : 'text-palmkit-elements-textTertiary opacity-40',
                    )}
                  >
                    {stage.label}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div
                    className={classNames(
                      'h-px flex-1 mx-0.5 transition-all duration-500',
                      i < stageIdx ? 'bg-green-500' : 'bg-palmkit-elements-borderColor',
                    )}
                    style={{ minWidth: '10px' }}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Collapsible event log */}
        {logsOpen && (
          <ul className="mt-3 pt-3 border-t border-palmkit-elements-borderColor space-y-1">
            {displayItems.map((item, i) => {
              const isLast = i === displayItems.length - 1;

              if (item.type === 'file_summary') {
                return (
                  <li key={`fs-${i}`} className="flex items-center gap-2 text-palmkit-elements-textSecondary">
                    <div className={classNames('shrink-0 text-[13px]', ICON_DONE)} />
                    <span className="text-xs opacity-70">{item.message}</span>
                  </li>
                );
              }

              if (item.type === 'generating_summary') {
                const summary = item as { type: 'generating_summary'; message: string; count: number; totalChars: number };
                return (
                  <li
                    key={`gs-${i}`}
                    className="flex items-center gap-2 text-palmkit-elements-textSecondary"
                    title={`${summary.count} streaming updates collapsed`}
                  >
                    <div
                      className={classNames(
                        'shrink-0 text-[13px]',
                        isLast ? ICON_RUNNING : 'i-ph:spinner text-palmkit-elements-textTertiary',
                      )}
                    />
                    <span className="text-xs opacity-70">
                      {summary.message}{' '}
                      <span className="opacity-50">({summary.count} updates)</span>
                    </span>
                  </li>
                );
              }

              const icon = eventIcon(item as WorkerEvent, isLast);

              return (
                <li
                  key={`ev-${(item as WorkerEvent).seq}`}
                  className={classNames(
                    'flex items-center gap-2',
                    ERROR_EVENTS.has((item as WorkerEvent).type)
                      ? 'text-red-300'
                      : TERMINAL_EVENTS.has((item as WorkerEvent).type) && (item as WorkerEvent).type !== 'job_failed'
                        ? 'text-green-300'
                        : isLast
                          ? 'text-palmkit-elements-textPrimary'
                          : 'text-palmkit-elements-textSecondary',
                  )}
                >
                  <div className={classNames('shrink-0 text-[13px]', icon)} />
                  <span className="text-xs">{(item as WorkerEvent).message}</span>
                </li>
              );
            })}
            <div ref={bottomRef} />
          </ul>
        )}
      </div>
    </div>
  );
}

type DisplayItem = WorkerEvent | { type: 'file_summary'; message: string } | { type: 'generating_summary'; message: string; count: number; totalChars: number };

/*
 * Collapse consecutive "Generating... X chars received" events into a single
 * summary entry. Without this, the log gets flooded with 20+ identical-looking
 * lines during the streaming phase.
 *
 * The pattern we look for: messages matching /^Generating\.\.\.\s*[\d,]+\s*chars?\s*received$/i
 * We collapse consecutive matches into one entry showing the latest count +
 * how many updates we skipped.
 */
function isGeneratingCharsEvent(ev: WorkerEvent): boolean {
  return /^Generating\.\.\.\s*[\d,]+\s*chars?\s*received/i.test(ev.message || '');
}

function extractCharsCount(ev: WorkerEvent): number {
  const match = ev.message?.match(/([\d,]+)\s*chars?\s*received/i);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
}

function collapseFileEvents(events: WorkerEvent[]): DisplayItem[] {
  const result: DisplayItem[] = [];
  let fileCount = 0;
  let lastFileMsg = '';

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    // Collapse consecutive "Generating... X chars received" events
    if (isGeneratingCharsEvent(ev)) {
      const collapsedEvents: WorkerEvent[] = [ev];
      let j = i + 1;

      while (j < events.length && isGeneratingCharsEvent(events[j])) {
        collapsedEvents.push(events[j]);
        j++;
      }

      if (collapsedEvents.length > 2) {
        const lastEv = collapsedEvents[collapsedEvents.length - 1];
        const totalChars = extractCharsCount(lastEv);
        result.push({
          type: 'generating_summary',
          message: `Generating… ${totalChars.toLocaleString()} chars received`,
          count: collapsedEvents.length,
          totalChars,
        });
      } else {
        for (const e of collapsedEvents) {
          result.push(e);
        }
      }

      i = j - 1; // skip the consumed events
      continue;
    }

    if (isFileWritten(ev)) {
      fileCount++;
      lastFileMsg = ev.message;

      if (i + 1 < events.length && isFileWritten(events[i + 1])) {
        continue;
      }

      if (fileCount > 2) {
        result.push({ type: 'file_summary', message: `${lastFileMsg} (+${fileCount - 1} more files)` });
      } else {
        for (let j = i - fileCount + 1; j <= i; j++) {
          result.push(events[j]);
        }
      }

      fileCount = 0;
    } else {
      fileCount = 0;
      result.push(ev);
    }
  }

  return result;
}
