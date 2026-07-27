/**
 * ToolResultHeader
 * ================
 * Consistent header shown at the top of every tool result renderer.
 * Shows: tool icon + tool name + status (success/error) + duration.
 *
 * This keeps visual consistency across all 19 native tools.
 */

import { memo, type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';

interface ToolResultHeaderProps {
  toolName: string;

  /** Display label (e.g. "PDF Document" instead of "create_pdf"). */
  label: string;

  /** Icon class (Phosphor icon). */
  iconClass: string;

  /** Whether the tool succeeded. */
  success: boolean;

  /** Optional error message (shown when success=false). */
  error?: string;

  /** Optional metadata shown on the right (e.g. "3.2KB", "1.2s"). */
  meta?: ReactNode;

  /** Optional accent color class (e.g. for charts). */
  accentColor?: string;
}

function ToolResultHeaderImpl({
  toolName,
  label,
  iconClass,
  success,
  error,
  meta,
  accentColor,
}: ToolResultHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-palmkit-elements-borderColor">
      <div
        className={classNames(
          'w-8 h-8 rounded-md flex items-center justify-center',
          accentColor ?? 'bg-palmkit-elements-background-depth-3',
        )}
      >
        <div className={classNames('text-base text-palmkit-elements-textPrimary', iconClass)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-palmkit-elements-textPrimary truncate">{label}</span>
          <span className="text-[10px] text-palmkit-elements-textSecondary font-mono px-1.5 py-0.5 rounded bg-palmkit-elements-background-depth-2">
            {toolName}
          </span>
        </div>
        {error && (
          <div className="text-xs text-palmkit-elements-icon-error mt-0.5 truncate" title={error}>
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {meta}
        <div
          className={classNames(
            'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium',
            success
              ? 'bg-palmkit-elements-icon-success/10 text-palmkit-elements-icon-success'
              : 'bg-palmkit-elements-icon-error/10 text-palmkit-elements-icon-error',
          )}
        >
          <div className={classNames('text-xs', success ? 'i-ph:check-circle' : 'i-ph:x-circle')} />
          {success ? 'OK' : 'Failed'}
        </div>
      </div>
    </div>
  );
}

export const ToolResultHeader = memo(ToolResultHeaderImpl);
