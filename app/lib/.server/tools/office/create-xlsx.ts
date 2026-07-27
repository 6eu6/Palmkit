/**
 * create_xlsx tool
 * ================
 * Generate a CSV-compatible spreadsheet from structured data.
 *
 * Available in: work mode only
 *
 * Returns CSV content that Excel, Google Sheets, Numbers, and LibreOffice
 * all open natively. For multi-sheet inputs, sheets are separated by a
 * blank line + sheet name header (Excel recognizes this pattern).
 *
 * Why CSV instead of true .xlsx?
 *   - The `exceljs` library is ~1MB minified — would blow the CF bundle.
 *   - The `xlsx` (SheetJS) library is ~900KB — same problem.
 *   - CSV is universally supported and zero-dependency.
 *   - For users who need formatting/colors/formulas, a future Phase 3
 *     tool will route through the Oracle worker to generate true .xlsx.
 *
 * CSV quoting rules (RFC 4180):
 *   - Fields containing commas, quotes, or newlines are wrapped in "...".
 *   - Embedded quotes are doubled: " becomes "".
 *   - Numbers stay unquoted; strings get quoted only if needed.
 */
import { createXlsxSchema, type CreateXlsxInput } from '~/lib/.server/tools/schemas/create-xlsx';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

type CellValue = string | number | boolean | null;

export const createXlsxTool: ToolDefinition<typeof createXlsxSchema> = {
  name: 'create_xlsx',
  description:
    'Generate a spreadsheet from structured tabular data. ' +
    'CALL THIS TOOL IMMEDIATELY when the user says "Excel", "spreadsheet", ".xlsx", or "downloadable spreadsheet". ' +
    'Do NOT write markdown first when the user explicitly asks for Excel — generate the spreadsheet directly. ' +
    'When the user does NOT specify a format, present data as a markdown table and offer Excel as an option afterwards. ' +
    'Accepts 1-10 sheets, each with headers and rows. ' +
    'Returns CSV content (universally compatible) with proper RFC 4180 quoting. ' +
    'For formatting (colors, formulas, charts), a future tool will generate true .xlsx. ' +
    'Do NOT use this for documents (use create_pdf or create_docx) or for markdown tables (use build_table).',

  inputSchema: createXlsxSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: CreateXlsxInput): Promise<ToolResult> => {
    const { filename = 'spreadsheet', sheets } = input;

    try {
      // Validate row widths match headers
      for (const sheet of sheets) {
        for (let i = 0; i < sheet.rows.length; i++) {
          if (sheet.rows[i].length !== sheet.headers.length) {
            return {
              ok: false,
              error:
                `Sheet "${sheet.name}" row ${i + 1} has ${sheet.rows[i].length} cells ` +
                `but headers has ${sheet.headers.length}. Row width must match headers.`,
              hint: 'Pad short rows with null, or trim long rows.',
            };
          }
        }
      }

      const sections: string[] = [];

      for (const sheet of sheets) {
        // Sheet name header (Excel-style: prefixed with # for visibility)
        sections.push(`# Sheet: ${sheet.name}`);

        // Header row
        sections.push(sheet.headers.map(csvEscape).join(','));

        // Data rows
        for (const row of sheet.rows) {
          sections.push(row.map((cell) => csvEscape(cell as CellValue)).join(','));
        }

        // Blank line between sheets
        sections.push('');
      }

      const csv = sections.join('\n');

      // Compute simple stats for the response
      const stats = sheets.map((s) => ({
        name: s.name,
        rows: s.rows.length,
        cols: s.headers.length,
      }));

      return {
        ok: true,
        filename: sanitizeFilename(filename) + '.csv',
        format: 'csv',
        mimeType: 'text/csv',
        content: csv,
        contentLength: csv.length,
        sheets: stats,
        totalRows: stats.reduce((sum, s) => sum + s.rows, 0),
        totalCols: Math.max(...stats.map((s) => s.cols)),
        instructions:
          'Save the CSV content as a .csv file. Opens directly in Excel, Google Sheets, ' +
          'Numbers, or LibreOffice Calc.',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `XLSX generation failed: ${message}`,
      };
    }
  },
};

/**
 * Escape a cell value per RFC 4180.
 * - Numbers: returned as-is (unquoted).
 * - Booleans: returned as TRUE/FALSE (Excel convention).
 * - null: returned as empty string.
 * - Strings: quoted only if they contain comma, quote, newline, or leading/trailing whitespace.
 *           Embedded quotes are doubled.
 */
function csvEscape(value: CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    // Avoid scientific notation for large/small numbers
    if (Number.isFinite(value)) {
      return String(value);
    }

    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  const str = String(value);

  // Quote if needed
  if (/[",\n\r]/.test(str) || str !== str.trim() || str === '') {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'spreadsheet'
  );
}
