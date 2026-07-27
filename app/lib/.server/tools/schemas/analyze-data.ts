/**
 * Analyze Data Schema
 * -------------------
 * Used by: analyze_data tool (work mode only)
 *
 * Accepts CSV or JSON data and returns statistical insights:
 *   - Per-column type detection (numeric vs text)
 *   - Numeric stats: min, max, mean, median, sum, stddev
 *   - Text stats: unique count, top values with frequencies
 *   - Sample rows for verification
 *
 * This is the successor to the legacy analyze_data tool. Improvements:
 *   - Better CSV parsing (handles quoted fields with commas/newlines)
 *   - Standard deviation calculation (legacy only had mean/median)
 *   - Outlier detection (values > 2 standard deviations from mean)
 *   - Cleaner error messages with row/col context
 */
import { z } from 'zod';

export const analyzeDataSchema = z.object({
  data: z
    .string()
    .min(1)
    .max(500_000)
    .describe(
      'Raw data to analyze. CSV format (comma/tab/semicolon separated) or JSON array of objects. ' +
        'Auto-detected: starts with [ or { → JSON, otherwise CSV. ' +
        'Example CSV: "name,age\\nAlice,30\\nBob,25". ' +
        'Example JSON: \'[{"name":"Alice","age":30},{"name":"Bob","age":25}]\'.',
    ),
  format: z.enum(['csv', 'json', 'auto']).optional().describe('Force format. Default: "auto" (detected from content).'),
  delimiter: z
    .enum([',', ';', '\t', '|', 'auto'])
    .optional()
    .describe(
      'CSV delimiter. Default: "auto" (detected from first line). ' +
        'Use "\t" for tab-separated, ";" for European CSVs.',
    ),
});

export type AnalyzeDataInput = z.infer<typeof analyzeDataSchema>;

/**
 * The structured result of analyze_data. Each column gets a stats object
 * whose shape depends on whether the column is numeric or text.
 */
export interface AnalyzeDataSuccess {
  ok: true;
  format: 'csv' | 'json';
  delimiter?: string;
  totalRows: number;
  totalColumns: number;
  columns: Record<string, ColumnStats>;
  sample: Array<Record<string, unknown>>;
  insights: string[];
  [key: string]: unknown;
}

export type ColumnStats =
  | {
      type: 'numeric';
      count: number;
      missing: number;
      min: number;
      max: number;
      mean: number;
      median: number;
      stddev: number;
      sum: number;
      outliers: number;
    }
  | {
      type: 'text';
      count: number;
      missing: number;
      unique: number;
      topValues: Array<{ value: string; count: number; percentage: number }>;
    }
  | {
      type: 'mixed';
      count: number;
      missing: number;
      numericCount: number;
      textCount: number;
      note: string;
    };
