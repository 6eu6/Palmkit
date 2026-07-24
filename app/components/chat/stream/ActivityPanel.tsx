/**
 * ActivityPanel — collapsible timeline of tool calls + build progress.
 *
 * Replaces the old BuildStream.tsx chaotic timeline. Now groups events
 * chronologically with clear visual hierarchy:
 *
 *   ┌─ Build status (top, prominent) ─────────────┐
 *   │ Building · 5 files written                    │
 *   ├─ Tool calls (collapsible per item) ──────────┤
 *   │ • Read src/App.tsx (12ms)                     │
 *   │ • Search "useState" (45ms)                    │
 *   │ • Run npm test (running...)                   │
 *   ├─ Files modified (compact list) ──────────────┤
 *   │ + src/App.tsx (24 lines)                      │
 *   │ + src/components/Button.tsx (15 lines)        │
 *   ├─ Retries (warning badge) ────────────────────┤
 *   │ ↻ Attempt 1/2 — missing package.json          │
 *   └───────────────────────────────────────────────┘
 *
 * Empty state: hidden entirely (no "No activity yet" placeholder).
 */

import { memo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { activityStore, buildFileCount, buildRetryCount } from '~/lib/stream/stores';
import { StreamIcon, severityToClass } from '~/components/icons/stream/StreamIcon';
import { classNames } from '~/utils/classNames';

function ActivityPanelImpl() {
  const activity = useStore(activityStore);
  const fileCount = useStore(buildFileCount);
  const retryCount = useStore(buildRetryCount);

  const [expanded, setExpanded] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // Hide entirely if no activity
  if (
    !activity.buildStatus &&
    activity.toolCalls.length === 0 &&
    activity.buildFiles.length === 0 &&
    activity.buildRetries.length === 0
  ) {
    return null;
  }

  const toggleTool = (callId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);

      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }

      return next;
    });
  };

  return (
    <div className="border-t border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1">
      {/* Header — always visible when there's activity */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-palmkit-elements-background-depth-2 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2.5">
          <StreamIcon
            name={activity.buildStatus?.icon ?? 'ph:hammer-duotone'}
            size={16}
            className={severityToClass(activity.buildStatus?.severity ?? 'info')}
          />
          <span className="text-xs font-medium text-palmkit-elements-textPrimary">
            {activity.buildStatus?.message ?? 'Activity'}
          </span>
          {retryCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-palmkit-elements-button-warning-background text-palmkit-elements-button-warning-text">
              {retryCount} {retryCount === 1 ? 'retry' : 'retries'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-palmkit-elements-textSecondary">
          {fileCount > 0 && <span>{fileCount} files</span>}
          <span
            className={classNames(
              'i-ph:caret-down-duotone inline-block w-3 h-3 transition-transform',
              expanded ? '' : '-rotate-90',
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 max-h-[280px] overflow-y-auto">
          {/* Build status timeline */}
          {activity.buildStatus && (
            <div className="mb-3 flex items-start gap-2 text-xs">
              <StreamIcon
                name={activity.buildStatus.icon}
                size={14}
                className={severityToClass(activity.buildStatus.severity)}
              />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-palmkit-elements-textPrimary capitalize">
                  {activity.buildStatus.status}
                </span>
                <span className="text-palmkit-elements-textSecondary"> · </span>
                <span className="text-palmkit-elements-textSecondary">{activity.buildStatus.message}</span>
              </div>
            </div>
          )}

          {/* Tool calls */}
          {activity.toolCalls.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-palmkit-elements-textSecondary mb-1.5">
                Tool calls
              </div>
              <ul className="space-y-1">
                {activity.toolCalls.map((tc) => {
                  const isExpanded = expandedTools.has(tc.callId);
                  const inFlight = !tc.endedAt;

                  return (
                    <li key={tc.callId}>
                      <button
                        type="button"
                        onClick={() => toggleTool(tc.callId)}
                        className="w-full flex items-center gap-2 py-1 px-1.5 rounded text-xs hover:bg-palmkit-elements-background-depth-2 transition-colors text-left"
                      >
                        <StreamIcon
                          name={tc.icon}
                          size={12}
                          className={
                            inFlight
                              ? 'text-palmkit-elements-textSecondary animate-spin'
                              : tc.ok
                                ? 'text-palmkit-elements-button-success-text'
                                : 'text-palmkit-elements-button-danger-text'
                          }
                        />
                        <span className="flex-1 truncate text-palmkit-elements-textPrimary">{tc.label}</span>
                        {tc.durationMs !== undefined && (
                          <span className="text-[10px] text-palmkit-elements-textTertiary tabular-nums">
                            {tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}
                          </span>
                        )}
                        {inFlight && <span className="text-[10px] text-palmkit-elements-textSecondary">running</span>}
                        {tc.summary && !isExpanded && (
                          <span className="text-[10px] text-palmkit-elements-textTertiary truncate max-w-[200px]">
                            {tc.summary}
                          </span>
                        )}
                      </button>
                      {isExpanded && tc.summary && (
                        <div className="ml-7 mb-1 px-2 py-1 rounded bg-palmkit-elements-background-depth-3 text-[11px] text-palmkit-elements-textSecondary font-mono whitespace-pre-wrap break-all">
                          {tc.summary}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Files modified */}
          {activity.buildFiles.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wider text-palmkit-elements-textSecondary mb-1.5">
                Files
              </div>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                {activity.buildFiles.map((f, i) => (
                  <li key={`${f.path}-${i}`} className="flex items-center gap-2 text-xs font-mono">
                    <span
                      className={classNames(
                        'inline-block w-3 text-center text-[11px]',
                        f.action === 'create' && 'text-palmkit-elements-button-success-text',
                        f.action === 'edit' && 'text-palmkit-elements-button-warning-text',
                        f.action === 'delete' && 'text-palmkit-elements-button-danger-text',
                      )}
                    >
                      {f.action === 'create' ? '+' : f.action === 'edit' ? '~' : '-'}
                    </span>
                    <span className="flex-1 truncate text-palmkit-elements-textPrimary">{f.path}</span>
                    {(f.linesAdded !== undefined || f.linesRemoved !== undefined) && (
                      <span className="text-[10px] text-palmkit-elements-textTertiary tabular-nums">
                        {f.linesAdded !== undefined && (
                          <span className="text-palmkit-elements-button-success-text">+{f.linesAdded}</span>
                        )}
                        {f.linesRemoved !== undefined && (
                          <span className="text-palmkit-elements-button-danger-text">-{f.linesRemoved}</span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Retries (only show if any) */}
          {activity.buildRetries.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-palmkit-elements-button-warning-text mb-1.5">
                Retries
              </div>
              <ul className="space-y-1">
                {activity.buildRetries.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-palmkit-elements-textSecondary">
                    <StreamIcon name={r.icon} size={12} className="mt-0.5" />
                    <span className="flex-1">
                      Attempt {r.attempt}/{r.maxAttempts} — {r.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ActivityPanel = memo(ActivityPanelImpl);
