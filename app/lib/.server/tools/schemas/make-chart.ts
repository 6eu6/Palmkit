/**
 * Make Chart Schema
 * -----------------
 * Used by: make_chart tool (work mode only)
 *
 * Returns a Chart.js config object that the client renders with the
 * already-installed Chart.js library. This avoids generating PNGs on
 * the server (which would require canvas + headless browser).
 *
 * Supported chart types: bar, line, pie, doughnut, radar, polarArea.
 * The config is a standard Chart.js v4 configuration — the client
 * passes it directly to `new Chart(canvas, config)`.
 */
import { z } from 'zod';

export const makeChartSchema = z.object({
  type: z
    .enum(['bar', 'line', 'pie', 'doughnut', 'radar', 'polarArea'])
    .describe('Chart type. Choose based on data: bar=comparison, line=trend, pie=proportion.'),
  title: z.string().min(1).max(200).describe('Chart title. Displayed above the chart.'),
  labels: z.array(z.string()).min(1).max(100).describe('Labels for the X axis (bar/line) or segments (pie/doughnut).'),
  datasets: z
    .array(
      z.object({
        label: z.string().min(1).describe('Dataset name (REQUIRED even for single-dataset charts). Appears in legend.'),
        data: z.array(z.number()).min(1).max(100).describe('Numeric values. Must match labels length.'),
        backgroundColor: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'Color(s). Single color applies to all; array per-point. ' +
              'Use hex (#ff6384) or rgba. If omitted, client picks a palette.',
          ),
        borderColor: z.string().optional().describe('Border color (hex/rgba). Default: same as backgroundColor.'),
      }),
    )
    .min(1)
    .max(10)
    .describe('One or more datasets. Multiple datasets create grouped bars / multiple lines.'),
  xAxisLabel: z.string().optional().describe('Optional X axis label (bar/line only).'),
  yAxisLabel: z.string().optional().describe('Optional Y axis label (bar/line only).'),
});

export type MakeChartInput = z.infer<typeof makeChartSchema>;
