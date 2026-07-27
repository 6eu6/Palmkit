/**
 * GrepRenderer
 * ============
 * Renders the result of the `grep` tool.
 *
 * Shows: pattern, total matches, files searched, results grouped by file
 * with line numbers and highlighted matching lines.
 */

import { memo, useState } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { classNames } from '~/utils/classNames';

interface GrepRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

interface GrepResult {
  ok: boolean;
  pattern?: string;
  caseSensitive?: boolean;
  fileGlob?: string | null;
  totalMatches?: number;
  filesSearched?: number;
  truncated?: boolean;
  results?: GrepMatch[];
  error?: string;
}

function highlightPattern(text: string, pattern: string, caseSensitive: boolean): React.ReactNode {
  if (!pattern) {
    return text;
  }

  try {
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(`(${pattern})`, flags);
    const parts = text.split(regex);

    return parts.map((part, idx) =>
      regex.test(part) ? (
        <mark
          key={idx}
          className="bg-palmkit-elements-item-contentAccent/30 text-palmkit-elements-textPrimary px-0.5 rounded"
        >
          {part}
        </mark>
      ) : (
        <span key={idx}>{part}</span>
      ),
    );
  } catch {
    return text;
  }
}

function GrepRendererImpl({ result, theme: _theme }: GrepRendererProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const data = result as GrepResult;

  // Group results by file
  const grouped = useMemoGrouped(data.results);

  const toggleFile = (file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);

      if (next.has(file)) {
        next.delete(file);
      } else {
        next.add(file);
      }

      return next;
    });
  };

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="grep"
          label="Search Results"
          iconClass="i-ph:magnifying-glass"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="grep"
        label={`Search: "${data.pattern ?? ''}"`}
        iconClass="i-ph:magnifying-glass"
        success
        accentColor="bg-yellow-500/10"
        meta={
          <>
            {data.totalMatches !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.totalMatches} match{data.totalMatches !== 1 ? 'es' : ''}
              </span>
            )}
            {data.filesSearched !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                in {data.filesSearched} file{data.filesSearched !== 1 ? 's' : ''}
              </span>
            )}
            {data.caseSensitive && <span className="text-xs text-palmkit-elements-textSecondary">case-sensitive</span>}
            {data.truncated && <span className="text-xs text-palmkit-elements-icon-warning">truncated</span>}
          </>
        }
      />

      {data.fileGlob && (
        <div className="mb-2 text-xs text-palmkit-elements-textSecondary">
          Filter:{' '}
          <code className="font-mono bg-palmkit-elements-background-depth-2 px-1.5 py-0.5 rounded">
            {data.fileGlob}
          </code>
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="text-xs text-palmkit-elements-textSecondary italic p-4 text-center">No matches found.</div>
      ) : (
        <div className="space-y-1">
          {grouped.map(([file, matches]) => {
            const expanded = expandedFiles.has(file) || grouped.length <= 5;
            return (
              <div key={file} className="border border-palmkit-elements-borderColor rounded-md overflow-hidden">
                <button
                  onClick={() => toggleFile(file)}
                  className="flex items-center w-full px-3 py-1.5 bg-palmkit-elements-background-depth-2 hover:bg-palmkit-elements-artifacts-backgroundHover text-left"
                >
                  <div
                    className={classNames(
                      'text-xs text-palmkit-elements-textSecondary transition-transform mr-2',
                      expanded && 'rotate-90',
                      'i-ph:caret-right-bold',
                    )}
                  />
                  <div className="i-ph:file-code text-sm text-palmkit-elements-textSecondary mr-2" />
                  <span className="text-xs font-mono text-palmkit-elements-textPrimary flex-1 truncate">{file}</span>
                  <span className="text-[10px] text-palmkit-elements-textSecondary ml-2">
                    {matches.length} match{matches.length !== 1 ? 'es' : ''}
                  </span>
                </button>
                {expanded && (
                  <div className="bg-[#FAFAFA] dark:bg-[#0A0A0A]">
                    {matches.map((m, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 px-3 py-1 hover:bg-palmkit-elements-background-depth-2 text-xs font-mono"
                      >
                        <span className="text-palmkit-elements-textSecondary whitespace-nowrap">{m.line}:</span>
                        <span className="text-palmkit-elements-textPrimary flex-1 break-all">
                          {highlightPattern(m.text, data.pattern ?? '', data.caseSensitive ?? false)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Simple memoized grouping helper
function useMemoGrouped(results?: GrepMatch[]): Array<[string, GrepMatch[]]> {
  return useMemo(() => {
    if (!results) {
      return [];
    }

    const groups: Record<string, GrepMatch[]> = {};

    for (const r of results) {
      if (!groups[r.file]) {
        groups[r.file] = [];
      }

      groups[r.file].push(r);
    }

    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [results]);
}

import { useMemo } from 'react';

export const GrepRenderer = memo(GrepRendererImpl);
