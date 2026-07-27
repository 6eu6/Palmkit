/**
 * Create XLSX Schema
 * ------------------
 * Used by: create_xlsx tool (work mode only)
 *
 * Returns CSV content that Excel opens natively. CSV is universally
 * compatible (Excel, Google Sheets, Numbers, LibreOffice) and avoids
 * the heavy `exceljs`/`xlsx` libraries that would blow the CF bundle.
 *
 * For multi-sheet workbooks or formatting (colors, formulas), a future
 * Phase 3 tool will call the Oracle worker to generate true .xlsx files.
 */
import { z } from 'zod';

export const createXlsxSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Suggested filename (without extension). Default: "spreadsheet".'),
  sheets: z
    .array(
      z.object({
        name: z.string().min(1).max(31).describe('Sheet name (max 31 chars, Excel limit).'),
        headers: z
          .array(z.string())
          .min(1)
          .max(100)
          .describe('Column headers. Each becomes the first row of the sheet.'),
        rows: z
          .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
          .max(10000)
          .describe(
            'Data rows. Each row MUST have the same length as headers. ' +
              'Use null for empty cells. Numbers stay as numbers; strings are quoted.',
          ),
      }),
    )
    .min(1)
    .max(10)
    .describe('Array of sheets (1-10). Each sheet becomes a separate CSV section.'),
});

export type CreateXlsxInput = z.infer<typeof createXlsxSchema>;
