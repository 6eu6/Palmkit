/**
 * XlsxPreviewRenderer
 * ==================
 * Renders the result of the `create_xlsx` tool.
 *
 * Shows the CSV content as a table (per sheet, with tabs for multi-sheet
 * files), plus download buttons for CSV and the original data.
 *
 * The CSV is parsed client-side using a simple RFC 4180 parser (handles
 * quoted fields, escaped quotes). We render one table per sheet, with
 * sheet name tabs at the top for multi-sheet files.
 */

import { memo, useState, useMemo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { classNames } from '~/utils/classNames';

interface XlsxPreviewRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface XlsxSheet {
  name: string;
  rows: number;
  cols: number;
}

interface CreateXlsxResult {
  ok: boolean;
  filename?: string;
  format?: string;
  mimeType?: string;
  content?: string;
  contentLength?: number;
  sheets?: XlsxSheet[];
  totalRows?: number;
  totalCols?: number;
  instructions?: string;
  error?: string;
}

/**
 * Parse a CSV string into rows of cells (RFC 4180 compliant).
 * Handles quoted fields, escaped quotes, newlines inside quotes.
 *
 * The create_xlsx tool prefixes each sheet with "# Sheet: <name>".
 * We split on these headers to get per-sheet CSV blocks.
 */
function parseMultiSheetCsv(csv: string): Array<{ name: string; rows: string[][] }> {
  const sheets: Array<{ name: string; rows: string[][] }> = [];
  const lines = csv.split('\n');

  // First pass: split into sheet blocks
  const blocks: Array<{ name: string; content: string }> = [];
  let currentBlock: { name: string; content: string } | null = null;

  for (const line of lines) {
    if (line.startsWith('# Sheet: ')) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }

      currentBlock = { name: line.slice('# Sheet: '.length).trim(), content: '' };
    } else if (currentBlock) {
      currentBlock.content += (currentBlock.content ? '\n' : '') + line;
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // If no sheet headers found, treat the whole thing as one sheet
  if (blocks.length === 0) {
    blocks.push({ name: 'Sheet1', content: csv });
  }

  // Parse each block
  for (const block of blocks) {
    const rows = parseCsvBlock(block.content);
    sheets.push({ name: block.name, rows });
  }

  return sheets;
}

function parseCsvBlock(csv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < csv.length) {
    const char = csv[i];

    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }

        inQuotes = false;
        i++;
        continue;
      }

      currentField += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
      i++;
      continue;
    }

    if (char === '\r') {
      i++;
      continue;
    }

    if (char === '\n') {
      if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField);

        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
      }

      currentRow = [];
      currentField = '';
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);

    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function XlsxPreviewRendererImpl({ result, theme: _theme }: XlsxPreviewRendererProps) {
  const data = result as CreateXlsxResult;
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);

  const sheets = useMemo(() => {
    if (!data.content) {
      return [];
    }

    return parseMultiSheetCsv(data.content);
  }, [data.content]);

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="create_xlsx"
          label="Spreadsheet"
          iconClass="i-ph:file-xls"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  const activeSheet = sheets[activeSheetIdx];

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="create_xlsx"
        label={data.filename ?? 'Spreadsheet'}
        iconClass="i-ph:file-xls"
        success
        meta={
          <>
            <span className="text-xs text-palmkit-elements-textSecondary">
              {sheets.length} sheet{sheets.length !== 1 ? 's' : ''}
            </span>
            {data.totalRows !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">{data.totalRows} rows</span>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <DownloadButton
          data={data.content}
          filename={data.filename ?? 'spreadsheet.csv'}
          mimeType="text/csv"
          label="Download CSV"
          iconClass="i-ph:file-xls"
        />
      </div>

      {sheets.length > 1 && (
        <div className="flex gap-1 mb-2 border-b border-palmkit-elements-borderColor overflow-x-auto">
          {sheets.map((sheet, idx) => (
            <button
              key={idx}
              onClick={() => setActiveSheetIdx(idx)}
              className={classNames(
                'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                idx === activeSheetIdx
                  ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
                  : 'border-transparent text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary',
              )}
            >
              {sheet.name} ({sheet.rows.length - 1} rows)
            </button>
          ))}
        </div>
      )}

      {activeSheet && activeSheet.rows.length > 0 ? (
        <div className="overflow-auto max-h-96 border border-palmkit-elements-borderColor rounded-md">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-palmkit-elements-background-depth-2">
              <tr>
                <th className="px-2 py-1.5 text-left text-palmkit-elements-textSecondary border-r border-palmkit-elements-borderColor w-8">
                  #
                </th>
                {activeSheet.rows[0]?.map((header, idx) => (
                  <th
                    key={idx}
                    className="px-3 py-1.5 text-left font-semibold text-palmkit-elements-textPrimary border-r border-palmkit-elements-borderColor"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeSheet.rows.slice(1).map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-palmkit-elements-background-depth-2">
                  <td className="px-2 py-1.5 text-palmkit-elements-textSecondary border-r border-palmkit-elements-borderColor text-right">
                    {rowIdx + 1}
                  </td>
                  {row.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="px-3 py-1.5 text-palmkit-elements-textPrimary border-r border-palmkit-elements-borderColor"
                    >
                      {cell || <span className="text-palmkit-elements-textSecondary italic">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-palmkit-elements-textSecondary italic p-4 text-center">
          No data rows in this sheet.
        </div>
      )}

      {data.instructions && (
        <div className="mt-3 text-xs text-palmkit-elements-textSecondary italic">{data.instructions}</div>
      )}
    </div>
  );
}

export const XlsxPreviewRenderer = memo(XlsxPreviewRendererImpl);
