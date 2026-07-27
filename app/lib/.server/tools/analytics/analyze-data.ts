/**
 * analyze_data tool
 * =================
 * Parse CSV or JSON data and return statistical insights.
 *
 * Available in: work mode only
 *
 * Improvements over the legacy analyze_data:
 *   - Proper CSV parsing (handles quoted fields with commas, newlines, escaped quotes)
 *   - Standard deviation calculation
 *   - Outlier detection (Z-score > 2)
 *   - Auto delimiter detection (commas, tabs, semicolons, pipes)
 *   - Mixed-type column detection (numbers + text in same column)
 *   - Generates human-readable "insights" strings the LLM can surface directly
 *
 * Output structure:
 *   - columns: Record<columnName, ColumnStats>
 *     - Numeric columns: { type, count, missing, min, max, mean, median, stddev, sum, outliers }
 *     - Text columns: { type, count, missing, unique, topValues: [{value, count, percentage}] }
 *     - Mixed columns: { type: 'mixed', note }
 *   - insights: string[] — human-readable findings ("Column X has 3 outliers", etc.)
 */
import {
  analyzeDataSchema,
  type AnalyzeDataInput,
  type AnalyzeDataSuccess,
  type ColumnStats,
} from '~/lib/.server/tools/schemas/analyze-data';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

export const analyzeDataTool: ToolDefinition<typeof analyzeDataSchema> = {
  name: 'analyze_data',
  description:
    'Parse CSV or JSON data and return statistical insights. ' +
    'Use this when the user provides tabular data and wants analysis: average, min, max, ' +
    'distribution, outliers, top values, missing data. ' +
    'Returns: per-column stats (numeric: min/max/mean/median/stddev/outliers; ' +
    'text: unique count + top values) plus 3-5 auto-generated insights the user can read directly. ' +
    'Supports: comma/tab/semicolon/pipe separated CSV, JSON arrays of objects. ' +
    'For visualization use make_chart. For formatting as table use build_table.',

  inputSchema: analyzeDataSchema,
  availableIn: ['work'],

  execute: async (input: AnalyzeDataInput): Promise<ToolResult> => {
    const { data, format = 'auto', delimiter = 'auto' } = input;

    try {
      // 1. Detect format
      const detectedFormat = detectFormat(data, format);

      // 2. Parse rows
      let rows: Array<Record<string, unknown>> = [];
      let actualDelimiter: string | undefined;

      if (detectedFormat === 'json') {
        const parseResult = parseJson(data);

        if (!parseResult.ok) {
          return parseResult;
        }

        rows = parseResult.rows as Array<Record<string, unknown>>;
      } else {
        const parseResult = parseCsv(data, delimiter);

        if (!parseResult.ok) {
          return parseResult;
        }

        rows = parseResult.rows as Array<Record<string, unknown>>;
        actualDelimiter = parseResult.delimiter as string;
      }

      if (rows.length === 0) {
        return { ok: false, error: 'No data rows found after parsing.' };
      }

      // 3. Get column names from first row
      const columns = Object.keys(rows[0]);

      if (columns.length === 0) {
        return { ok: false, error: 'No columns detected in the data.' };
      }

      // 4. Analyze each column
      const columnStats: Record<string, ColumnStats> = {};
      const insights: string[] = [];

      for (const col of columns) {
        const values = rows.map((r) => r[col]).filter((v) => v !== undefined && v !== null && v !== '');
        const missing = rows.length - values.length;

        const numericValues = values
          .map((v) => (typeof v === 'number' ? v : Number(v)))
          .filter((n) => !isNaN(n) && isFinite(n));

        const allNumeric = numericValues.length === values.length && values.length > 0;

        if (allNumeric) {
          const stats = computeNumericStats(numericValues, missing);
          columnStats[col] = stats;

          // Generate insights
          if (stats.outliers > 0) {
            insights.push(
              `Column "${col}" has ${stats.outliers} outlier${stats.outliers > 1 ? 's' : ''} ` +
                `(values > 2 standard deviations from mean of ${stats.mean.toFixed(2)}).`,
            );
          }

          const range = stats.max - stats.min;

          if (range > 0 && stats.mean > 0) {
            const cv = (stats.stddev / Math.abs(stats.mean)) * 100;

            if (cv > 50) {
              insights.push(`Column "${col}" has high variability (CV=${cv.toFixed(0)}%).`);
            }
          }
        } else if (numericValues.length > values.length * 0.5 && numericValues.length > 0) {
          // Mixed column: >50% numeric but not all
          columnStats[col] = {
            type: 'mixed',
            count: values.length,
            missing,
            numericCount: numericValues.length,
            textCount: values.length - numericValues.length,
            note: `Column contains both numeric (${numericValues.length}) and text (${values.length - numericValues.length}) values.`,
          };
          insights.push(`Column "${col}" is mixed-type — could not compute numeric stats reliably.`);
        } else {
          // Text column
          const stats = computeTextStats(values, missing);
          columnStats[col] = stats;

          if (stats.unique === values.length && values.length > 5) {
            insights.push(`Column "${col}" has all unique values (${stats.unique}) — possibly an ID column.`);
          } else if (stats.unique === 1) {
            const val = stats.topValues[0]?.value;
            insights.push(`Column "${col}" has only one unique value ("${val}") — constant column.`);
          }
        }

        if (missing > 0) {
          const pct = ((missing / rows.length) * 100).toFixed(1);

          if (parseFloat(pct) > 20) {
            insights.push(`Column "${col}" has ${missing} missing values (${pct}% of rows).`);
          }
        }
      }

      // Add data-wide insights
      insights.push(
        `Dataset has ${rows.length} rows and ${columns.length} columns ` +
          `(${columns.filter((c) => columnStats[c].type === 'numeric').length} numeric, ` +
          `${columns.filter((c) => columnStats[c].type === 'text').length} text, ` +
          `${columns.filter((c) => columnStats[c].type === 'mixed').length} mixed).`,
      );

      const result: AnalyzeDataSuccess = {
        ok: true,
        format: detectedFormat,
        ...(actualDelimiter ? { delimiter: actualDelimiter } : {}),
        totalRows: rows.length,
        totalColumns: columns.length,
        columns: columnStats,
        sample: rows.slice(0, 3),
        insights: insights.slice(0, 7), // cap at 7 to keep response manageable
      };

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Data analysis failed: ${message}` };
    }
  },
};

// ─── Helpers ─────────────────────────────────────────────────────

function detectFormat(data: string, format: 'csv' | 'json' | 'auto'): 'csv' | 'json' {
  if (format !== 'auto') {
    return format;
  }

  const trimmed = data.trim();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return 'json';
  }

  return 'csv';
}

function parseJson(data: string): { ok: true; rows: Array<Record<string, unknown>> } | ToolResult {
  try {
    const parsed = JSON.parse(data);

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { ok: false, error: 'JSON array is empty.' };
      }

      // Flatten: each row should be an object with consistent keys
      const rows = parsed.map((item, idx) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new Error(`Row ${idx} is not an object: ${typeof item}`);
        }

        return item as Record<string, unknown>;
      });

      return { ok: true, rows };
    }

    if (typeof parsed === 'object' && parsed !== null) {
      // Single object — wrap as one row
      return { ok: true, rows: [parsed as Record<string, unknown>] };
    }

    return { ok: false, error: 'JSON must be an array of objects or a single object.' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `JSON parse failed: ${message}` };
  }
}

function parseCsv(
  data: string,
  delimiter: 'auto' | ',' | ';' | '\t' | '|',
): { ok: true; rows: Array<Record<string, unknown>>; delimiter: string } | ToolResult {
  const detectedDelimiter = delimiter === 'auto' ? detectCsvDelimiter(data) : delimiter;

  try {
    const lines = parseCsvLines(data, detectedDelimiter);

    if (lines.length < 2) {
      return { ok: false, error: 'CSV needs at least a header row and one data row.' };
    }

    const headers = lines[0].map((h) => h.trim());
    const rows: Array<Record<string, unknown>> = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i];
      const row: Record<string, unknown> = {};

      headers.forEach((h, idx) => {
        const v = values[idx];

        if (v === undefined || v === '') {
          row[h] = '';
          return;
        }

        const num = Number(v);
        row[h] = !isNaN(num) && v !== '' && isFinite(num) ? num : v;
      });

      rows.push(row);
    }

    return { ok: true, rows, delimiter: detectedDelimiter };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `CSV parse failed: ${message}` };
  }
}

/**
 * Detect CSV delimiter by counting occurrences in the first non-empty line.
 */
function detectCsvDelimiter(data: string): string {
  const firstLine = data.split('\n').find((l) => l.trim()) ?? '';
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let maxCount = 0;

  for (const c of candidates) {
    // Count outside of quotes (simple heuristic: just count total)
    const count = firstLine.split(c).length - 1;

    if (count > maxCount) {
      maxCount = count;
      best = c;
    }
  }

  return best;
}

/**
 * Parse CSV into rows of cells, properly handling:
 *   - Quoted fields: "hello, world" → single cell
 *   - Escaped quotes: "she said ""hi""" → she said "hi"
 *   - Newlines inside quoted fields
 *   - Empty trailing fields
 *
 * This is a proper RFC 4180 parser (the legacy tool used split(',')
 * which broke on any field containing a comma).
 */
function parseCsvLines(data: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < data.length) {
    const char = data[i];

    if (inQuotes) {
      if (char === '"') {
        if (data[i + 1] === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        }

        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }

      currentField += char;
      i++;
      continue;
    }

    // Not in quotes
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(currentField);
      currentField = '';
      i++;
      continue;
    }

    if (char === '\r') {
      // Handle \r\n line endings
      i++;
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentField);
      currentField = '';

      // Only push non-empty rows
      if (currentRow.some((c) => c !== '')) {
        rows.push(currentRow);
      }

      currentRow = [];
      i++;
      continue;
    }

    currentField += char;
    i++;
  }

  // Don't forget the last field/row
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField);

    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function computeNumericStats(values: number[], missing: number): Extract<ColumnStats, { type: 'numeric' }> {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];

  // Standard deviation
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / sorted.length;
  const stddev = Math.sqrt(variance);

  // Outliers: Z-score > 2 (more than 2 standard deviations from mean)
  const outliers = stddev > 0 ? sorted.filter((v) => Math.abs((v - mean) / stddev) > 2).length : 0;

  return {
    type: 'numeric',
    count: sorted.length,
    missing,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round(mean),
    median: round(median),
    stddev: round(stddev),
    sum: round(sum),
    outliers,
  };
}

function computeTextStats(values: unknown[], missing: number): Extract<ColumnStats, { type: 'text' }> {
  const counts: Record<string, number> = {};

  for (const v of values) {
    const key = String(v);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const unique = Object.keys(counts).length;

  const topValues = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({
      value,
      count,
      percentage: Math.round((count / values.length) * 100),
    }));

  return {
    type: 'text',
    count: values.length,
    missing,
    unique,
    topValues,
  };
}

function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}
