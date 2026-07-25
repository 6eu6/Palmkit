/**
 * WebSearchRenderer
 * =================
 * Renders the result of the `web_search` tool.
 *
 * Shows: provider, query, answer (if available), list of results with
 * clickable links. Each result has title, URL, snippet.
 */

import { memo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';

interface WebSearchRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchResult {
  ok: boolean;
  provider?: string;
  query?: string;
  answer?: string | null;
  results?: SearchResult[];
  totalResults?: number;
  error?: string;
  hint?: string;
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function WebSearchRendererImpl({ result, theme: _theme }: WebSearchRendererProps) {
  const data = result as WebSearchResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="web_search"
          label="Web Search"
          iconClass="i-ph:magnifying-glass"
          success={false}
          error={data.error}
        />
        {data.hint && (
          <div className="mt-2 p-2 rounded-md bg-palmkit-elements-icon-warning/10 text-xs text-palmkit-elements-textSecondary">
            <div className="i-ph:info inline-block mr-1" />
            {data.hint}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="web_search"
        label={data.query ?? 'Web Search'}
        iconClass="i-ph:magnifying-glass"
        success
        accentColor="bg-cyan-500/10"
        meta={
          <>
            {data.provider && (
              <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.provider}</span>
            )}
            {data.totalResults !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.totalResults} result{data.totalResults !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
      />

      {data.answer && (
        <div className="mb-3 p-3 rounded-md bg-palmkit-elements-background-depth-2 border-l-2 border-palmkit-elements-item-contentAccent">
          <div className="text-[10px] uppercase text-palmkit-elements-textSecondary mb-1">Synthesized answer</div>
          <div className="text-sm text-palmkit-elements-textPrimary">{data.answer}</div>
        </div>
      )}

      <div className="space-y-2">
        {data.results?.map((r, idx) => (
          <a
            key={idx}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-3 rounded-md border border-palmkit-elements-borderColor hover:border-palmkit-elements-item-contentAccent hover:bg-palmkit-elements-background-depth-2 transition-colors group"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-palmkit-elements-textSecondary">{idx + 1}.</span>
              <span className="text-[10px] text-palmkit-elements-textSecondary">{domainFromUrl(r.url)}</span>
              <div className="i-ph:arrow-square-out text-xs text-palmkit-elements-textSecondary opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
            </div>
            <div className="text-sm font-medium text-palmkit-elements-item-contentAccent group-hover:underline mb-1">
              {r.title}
            </div>
            <div className="text-xs text-palmkit-elements-textSecondary line-clamp-2">{r.snippet}</div>
          </a>
        ))}
      </div>

      {!data.results?.length && (
        <div className="text-xs text-palmkit-elements-textSecondary italic p-4 text-center">No results found.</div>
      )}
    </div>
  );
}

export const WebSearchRenderer = memo(WebSearchRendererImpl);
