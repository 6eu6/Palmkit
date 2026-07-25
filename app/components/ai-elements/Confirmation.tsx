/**
 * Confirmation — Tool execution approval
 * =======================================
 *
 * An alert-based component for managing tool execution approval
 * workflows with request, accept, and reject states.
 *
 * <Confirmation
 *   toolName="run_shell"
 *   description="This tool wants to delete the file /tmp/example.txt"
 *   onAccept={() => approve()}
 *   onReject={() => reject()}
 * />
 *
 * Monochrome: border + background-depth-1. No red/green — uses
 * textSecondary for "Reject" and textPrimary for "Approve".
 * Icons: i-ph:warning for the alert, i-ph:check / i-ph:x for buttons.
 */

import { memo } from 'react';
import { classNames } from '~/utils/classNames';

interface ConfirmationProps {
  toolName: string;
  description: string;
  onAccept: () => void;
  onReject: () => void;
  className?: string;
}

function ConfirmationImpl({ toolName, description, onAccept, onReject, className }: ConfirmationProps) {
  return (
    <div
      className={classNames(
        'rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 p-3',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="i-ph:warning text-sm text-palmkit-elements-textSecondary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-palmkit-elements-textPrimary">
            <span className="font-mono">{toolName}</span> — {description}
          </div>
          <div className="text-[11px] text-palmkit-elements-textSecondary mt-0.5">Do you approve this action?</div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={onAccept}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-palmkit-elements-background-depth-2 text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-3 transition-colors border border-palmkit-elements-borderColor"
            >
              <div className="i-ph:check text-sm" />
              Approve
            </button>
            <button
              onClick={onReject}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
            >
              <div className="i-ph:x text-sm" />
              Reject
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Confirmation = memo(ConfirmationImpl);
