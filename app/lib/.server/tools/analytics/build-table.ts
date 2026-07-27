/**
 * build_table tool
 * =================
 * Format structured data as a markdown, HTML, or CSV table.
 *
 * Available in: work mode only
 *
 * Successor to the legacy format_table tool. Accepts already-structured
 * data (headers + rows) and produces clean output in any of 3 formats.
 *
 * Use cases:
 *   - The LLM has extracted structured data from a page (via scrape_page)
 *     and wants to present it as a table.
 *   - The user pasted CSV data and wants it formatted.
 *   - The LLM has computed some statistics (via analyze_data) and wants
 *     to show them in a table.
 *
 * If the data is NOT already structured (raw text), the LLM should
 * parse it first and pass structured rows to this tool.
 */
import { buildTableSchema, type BuildTableInput } from '~/lib/.server/tools/schemas/build-table';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

export const buildTableTool: ToolDefinition<typeof buildTableSchema> = {
  name: 'build_table',
  description:
    'Format structured data as a markdown, HTML, or CSV table. ' +
    'Use this when you have headers and rows ready and want to present them as a clean table. ' +
    'Returns: markdown table (default), HTML table, or CSV depending on the format parameter. ' +
    'For spreadsheet files use create_xlsx. For PDF documents with tables use create_pdf. ' +
    'If the user pasted UNSTRUCTURED text, parse it first then call this tool.',

  inputSchema: buildTableSchema,
  availableIn: ['work'],

  execute: async (input: BuildTableInput): Promise<ToolResult> => {
    const { headers, rows, caption, format = 'markdown' } = input;

    try {
      // Validate: each row must match headers length
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].length !== headers.length) {
          return {
            ok: false,
            error:
              `Row ${i + 1} has ${rows[i].length} cells but headers has ${headers.length}. ` +
              `Row width must match headers.`,
            hint: 'Pad short rows with null, or trim long rows.',
          };
        }
      }

      let output: string;

      switch (format) {
        case 'markdown':
          output = renderMarkdown(headers, rows, caption);
          break;
        case 'html':
          output = renderHtml(headers, rows, caption);
          break;
        case 'csv':
          output = renderCsv(headers, rows);
          break;
        default:
          return { ok: false, error: `Unknown format: ${format}` };
      }

      return {
        ok: true,
        format,
        content: output,
        contentLength: output.length,
        rows: rows.length,
        columns: headers.length,
        caption: caption ?? null,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Table building failed: ${message}` };
    }
  },
};

// ─── Renderers ───────────────────────────────────────────────────

function renderMarkdown(
  headers: string[],
  rows: Array<Array<string | number | boolean | null>>,
  caption?: string,
): string {
  const lines: string[] = [];

  if (caption) {
    lines.push(`**${caption}**`);
    lines.push('');
  }

  // Header row
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

  // Data rows
  for (const row of rows) {
    const cells = row.map((cell) => {
      if (cell === null || cell === undefined) {
        return '';
      }

      if (typeof cell === 'boolean') {
        return cell ? '✓' : '✗';
      }

      return String(cell);
    });
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}

function renderHtml(headers: string[], rows: Array<Array<string | number | boolean | null>>, caption?: string): string {
  const parts: string[] = ['<table>'];

  if (caption) {
    parts.push(`<caption>${escapeHtml(caption)}</caption>`);
  }

  // Header
  parts.push('<thead><tr>');

  for (const h of headers) {
    parts.push(`<th>${escapeHtml(h)}</th>`);
  }
  parts.push('</tr></thead>');

  // Body
  parts.push('<tbody>');

  for (const row of rows) {
    parts.push('<tr>');

    for (const cell of row) {
      let cellContent = '';

      if (cell !== null && cell !== undefined) {
        cellContent = typeof cell === 'boolean' ? (cell ? '✓' : '✗') : escapeHtml(String(cell));
      }

      parts.push(`<td>${cellContent}</td>`);
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');

  return parts.join('\n');
}

function renderCsv(headers: string[], rows: Array<Array<string | number | boolean | null>>): string {
  const lines: string[] = [headers.map(csvEscape).join(',')];

  for (const row of rows) {
    const cells = row.map((cell) => {
      if (cell === null || cell === undefined) {
        return '';
      }

      if (typeof cell === 'boolean') {
        return cell ? 'TRUE' : 'FALSE';
      }

      if (typeof cell === 'number') {
        return String(cell);
      }

      return csvEscape(cell);
    });
    lines.push(cells.join(','));
  }

  return lines.join('\n');
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value) || value !== value.trim() || value === '') {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
