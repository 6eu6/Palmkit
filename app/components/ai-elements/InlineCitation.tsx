/**
 * InlineCitation — Inline source reference
 * ========================================
 *
 * A citation pill that shows detailed source information on hover/click.
 * Similar to academic paper citations or research document references.
 *
 * <InlineCitation
 *   number={1}
 *   source={{ title: "React Docs", url: "https://react.dev" }}
 * />
 *
 * Renders as a small superscript number pill. On hover, shows a
 * popover with the source title + URL.
 *
 * Monochrome: background-depth-2 pill, no colored text.
 */

import { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

export interface CitationSource {
  title: string;
  url: string;
  snippet?: string;
}

interface InlineCitationProps {
  number: number;
  source: CitationSource;
  className?: string;
}

function InlineCitationImpl({ number, source, className }: InlineCitationProps) {
  const [showPopover, setShowPopover] = useState(false);

  return (
    <span
      className={classNames('relative inline-block', className)}
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-medium bg-palmkit-elements-background-depth-2 text-palmkit-elements-textSecondary hover:bg-palmkit-elements-background-depth-3 hover:text-palmkit-elements-textPrimary transition-colors align-super cursor-pointer"
      >
        {number}
      </a>
      {showPopover && (
        <div className="absolute z-20 bottom-full left-0 mb-1 w-64 p-2.5 rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 shadow-lg ai-fade-in">
          <div className="flex items-start gap-1.5">
            <div className="i-ph:link text-xs text-palmkit-elements-textSecondary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-palmkit-elements-textPrimary truncate">{source.title}</div>
              <div className="text-[10px] text-palmkit-elements-textSecondary truncate">{source.url}</div>
              {source.snippet && (
                <div className="text-[11px] text-palmkit-elements-textSecondary mt-1 line-clamp-2">
                  {source.snippet}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

export const InlineCitation = memo(InlineCitationImpl);
