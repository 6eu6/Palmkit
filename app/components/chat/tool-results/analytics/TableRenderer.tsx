/**
 * TableRenderer
 * =============
 * Renders the result of the `build_table` tool.
 *
 * Shows the table content (markdown or HTML) with format tabs and
 * download buttons. Markdown is rendered as HTML for visual preview.
 */

import { memo, useState, useMemo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { classNames } from '~/utils/classNames';

interface TableRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface BuildTableResult {
  ok: boolean;
  format?: 'markdown' | 'html' | 'csv';
  content?: string;
  contentLength?: number;
  rows?: number;
  columns?: number;
  caption?: string | null;
  error?: string;
}

/**
 * Convert markdown table syntax to HTML for visual preview.
 * Simple parser — handles standard markdown tables with headers.
 */
function markdownTableToHtml(md: string): string {
  const lines = md
    .trim()
    .split('\n')
    .filter((l) => l.trim());

  if (lines.length < 2) {
    return `<p>${md}</p>`;
  }

  const parseRow = (line: string): string[] => {
    return line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  };

  const headers = parseRow(lines[0]);
  const bodyRows = lines.slice(2).map(parseRow); // skip separator line

  let html = '<table class="w-full text-xs border-collapse">';
  html += '<thead><tr>';

  for (const h of headers) {
    html += `<th class="px-3 py-1.5 text-left font-semibold border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2">${h}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const row of bodyRows) {
    html += '<tr>';

    for (const cell of row) {
      const cellContent = cell || '<span class="italic opacity-50">—</span>';
      html += `<td class="px-3 py-1.5 border border-palmkit-elements-borderColor">${cellContent}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  return html;
}

function TableRendererImpl({ result, theme: _theme }: TableRendererProps) {
  const [view, setView] = useState<'rendered' | 'source'>('rendered');

  const data = result as BuildTableResult;

  const renderedHtml = useMemo(() => {
    if (!data.content) {
      return '';
    }

    if (data.format === 'html') {
      return data.content;
    }

    if (data.format === 'markdown') {
      return markdownTableToHtml(data.content);
    }

    // CSV: convert to table
    if (data.format === 'csv') {
      const rows = data.content.split('\n').map((l) => l.split(','));

      if (rows.length < 1) {
        return '';
      }

      let html = '<table class="w-full text-xs border-collapse">';
      html += '<thead><tr>';

      for (const h of rows[0]) {
        html += `<th class="px-3 py-1.5 text-left border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2">${h}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (const row of rows.slice(1)) {
        if (!row.some((c) => c.trim())) {
          continue;
        }

        html += '<tr>';

        for (const cell of row) {
          html += `<td class="px-3 py-1.5 border border-palmkit-elements-borderColor">${cell}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';

      return html;
    }

    return '';
  }, [data.content, data.format]);

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="build_table"
          label="Table"
          iconClass="i-ph:table"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  const fileExt = data.format === 'markdown' ? 'md' : data.format === 'html' ? 'html' : 'csv';
  const mimeType = data.format === 'html' ? 'text/html' : data.format === 'csv' ? 'text/csv' : 'text/markdown';

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="build_table"
        label={data.caption ?? 'Table'}
        iconClass="i-ph:table"
        success
        meta={
          <>
            <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.format}</span>
            {data.rows !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.rows} × {data.columns}
              </span>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <DownloadButton
          data={data.content}
          filename={`table.${fileExt}`}
          mimeType={mimeType}
          label={`Download .${fileExt}`}
          iconClass="i-ph:download-simple"
        />
      </div>

      <div className="flex gap-1 mb-2 border-b border-palmkit-elements-borderColor">
        <button
          onClick={() => setView('rendered')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            view === 'rendered'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary',
          )}
        >
          Rendered
        </button>
        <button
          onClick={() => setView('source')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            view === 'source'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary',
          )}
        >
          {data.format === 'markdown' ? 'Markdown' : data.format === 'html' ? 'HTML' : 'CSV'} source
        </button>
      </div>

      {view === 'rendered' ? (
        <div
          className="overflow-auto max-h-96 border border-palmkit-elements-borderColor rounded-md bg-white dark:bg-palmkit-elements-background-depth-2 p-2"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : (
        <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap break-all">
          {data.content}
        </pre>
      )}
    </div>
  );
}

export const TableRenderer = memo(TableRendererImpl);
