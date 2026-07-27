/**
 * DeepSearchRenderer
 * ==================
 * Renders the result of the `deep_search` tool.
 *
 * Shows: topic, depth, queries used, findings (top synthesized points),
 * and structured results list with source domains.
 */

import { memo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';

interface DeepSearchRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface DeepSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
  query: string;
}

interface DeepSearchResult {
  ok: boolean;
  topic?: string;
  depth?: string;
  queriesUsed?: string[];
  totalResults?: number;
  results?: DeepSearchResultItem[];
  findings?: string[];
  searchedAt?: string;
  error?: string;
  hint?: string;
}

function DeepSearchRendererImpl({ result, theme: _theme }: DeepSearchRendererProps) {
  const data = result as DeepSearchResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="deep_search"
          label="Deep Search"
          iconClass="i-ph:binoculars"
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
        toolName="deep_search"
        label={data.topic ?? 'Deep Search'}
        iconClass="i-ph:binoculars"
        success
        accentColor="bg-violet-500/10"
        meta={
          <>
            {data.depth && <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.depth}</span>}
            {data.queriesUsed && (
              <span className="text-xs text-palmkit-elements-textSecondary">{data.queriesUsed.length} queries</span>
            )}
            {data.totalResults !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">{data.totalResults} results</span>
            )}
          </>
        }
      />

      {data.findings && data.findings.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase text-palmkit-elements-textSecondary mb-2">Synthesized findings</div>
          <div className="space-y-2">
            {data.findings.map((finding, idx) => (
              <div key={idx} className="flex items-start gap-2 p-2 rounded-md bg-palmkit-elements-background-depth-2">
                <span className="text-xs font-medium text-palmkit-elements-item-contentAccent mt-0.5">{idx + 1}.</span>
                <span className="text-xs text-palmkit-elements-textPrimary flex-1">{finding}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.results && data.results.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="All results" badge={`${data.results.length}`}>
            <div className="space-y-2">
              {data.results.map((r, idx) => (
                <a
                  key={idx}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-2 rounded-md border border-palmkit-elements-borderColor hover:border-palmkit-elements-item-contentAccent hover:bg-palmkit-elements-background-depth-2 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-palmkit-elements-textSecondary">{idx + 1}.</span>
                    <span className="text-[10px] text-palmkit-elements-textSecondary">{r.sourceDomain}</span>
                    <span className="text-[10px] text-palmkit-elements-textSecondary italic ml-auto truncate max-w-32">
                      query: {r.query}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-palmkit-elements-item-contentAccent group-hover:underline mb-1">
                    {r.title}
                  </div>
                  <div className="text-xs text-palmkit-elements-textSecondary line-clamp-2">{r.snippet}</div>
                </a>
              ))}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {data.queriesUsed && data.queriesUsed.length > 0 && (
        <div className="mb-3">
          <CollapsibleSection title="Queries used" badge={`${data.queriesUsed.length}`}>
            <ul className="space-y-1">
              {data.queriesUsed.map((q, idx) => (
                <li key={idx} className="text-xs text-palmkit-elements-textPrimary font-mono">
                  <span className="text-palmkit-elements-textSecondary">{idx + 1}.</span> {q}
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

export const DeepSearchRenderer = memo(DeepSearchRendererImpl);
