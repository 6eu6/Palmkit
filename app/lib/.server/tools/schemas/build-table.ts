/**
 * Build Table Schema
 * ------------------
 * Used by: build_table tool (work mode only)
 *
 * Converts unstructured/semi-structured data into a clean markdown table.
 * This is the successor to the legacy format_table tool — it accepts
 * richer inputs (JSON objects, key-value pairs, raw text) and produces
 * cleaner output.
 *
 * Use cases:
 *   - User pastes a tab-separated list → markdown table
 *   - User has JSON array of objects → markdown table with auto-detected columns
 *   - User describes data in prose → LLM extracts structure, this tool formats
 */
import { z } from 'zod';

export const buildTableSchema = z.object({
  headers: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe('Column headers. Will be rendered as the first row of the table.'),
  rows: z
    .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
    .min(1)
    .max(1000)
    .describe(
      'Data rows. Each row should match the headers length. ' + 'null becomes empty cell. Numbers stay unquoted.',
    ),
  caption: z.string().max(200).optional().describe('Optional table caption. Rendered as bold text above the table.'),
  format: z
    .enum(['markdown', 'html', 'csv'])
    .optional()
    .describe('Output format. Default: markdown. CSV is useful for spreadsheet paste.'),
});

export type BuildTableInput = z.infer<typeof buildTableSchema>;
