/**
 * Sources — Response source citations
 * ===================================
 *
 * Displays the sources or citations used to generate a response.
 * Each source is a clickable link with title + domain.
 *
 * <Sources sources={[
 *   { title: "Stripe API Documentation", url: "https://stripe.com/docs/api" },
 *   { title: "GitHub REST API", url: "https://docs.github.com/rest" },
 * ]} />
 *
 * Monochrome: muted text, no colored links. Icon: i-ph:book-open.
 */

import { memo } from 'react';
import { classNames } from '~/utils/classNames';

export interface SourceItem {
  title: string;
  url: string;
  snippet?: string;
}

interface SourcesProps {
  sources: SourceItem[];
  className?: string;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function SourcesImpl({ sources, className }: SourcesProps) {
  if (!sources || sources.length === 0) {
    return null;
  }

  return (
    <div className={classNames('mt-3', className)}>
      <div className="flex items-center gap-1.5 mb-2">
        <div className="i-ph:book-open text-sm text-palmkit-elements-textSecondary" />
        <span className="text-xs font-medium text-palmkit-elements-textSecondary">
          Used {sources.length} source{sources.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {sources.map((source, idx) => (
          <a
            key={idx}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.snippet || source.title}
            className="group flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 hover:bg-palmkit-elements-background-depth-2 transition-colors max-w-xs"
          >
            <div className="i-ph:link text-xs text-palmkit-elements-textSecondary shrink-0" />
            <div className="min-w-0">
              <div className="text-xs text-palmkit-elements-textPrimary truncate group-hover:underline">
                {source.title}
              </div>
              <div className="text-[10px] text-palmkit-elements-textSecondary truncate">
                {domainFromUrl(source.url)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export const Sources = memo(SourcesImpl);
