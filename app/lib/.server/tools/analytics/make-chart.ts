/**
 * make_chart tool
 * ===============
 * Generate a Chart.js configuration from structured data.
 *
 * Available in: work mode only
 *
 * Returns a Chart.js v4 config object that the frontend passes directly
 * to `new Chart(canvas, config)`. The frontend already bundles Chart.js,
 * so we don't need to generate PNGs server-side.
 *
 * Why this approach:
 *   - Generating PNGs server-side requires canvas + headless browser
 *     (~50MB on the server, not viable on CF Pages).
 *   - Chart.js is ~200KB minified, already a common frontend dependency.
 *   - The config is JSON-serializable → can be stored, replayed, edited.
 *   - The user gets an INTERACTIVE chart (hover, zoom) not a static PNG.
 *
 * The frontend renders the chart in a sandboxed iframe and offers a
 * "Download as PNG" button that uses Chart.js's toBase64Image() method.
 */
import { makeChartSchema, type MakeChartInput } from '~/lib/.server/tools/schemas/make-chart';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

export const makeChartTool: ToolDefinition<typeof makeChartSchema> = {
  name: 'make_chart',
  description:
    'Generate an interactive chart from structured data. ' +
    'MARKDOWN-FIRST PHILOSOPHY: For simple data (3-5 values), consider a markdown table first. ' +
    'Use this tool when: (1) the user EXPLICITLY asks for a "chart", "graph", or "visualization", ' +
    '(2) the data has 6+ data points where a chart communicates better than a table, ' +
    'OR (3) the user wants to see trends/comparisons/proportions visually. ' +
    'Returns a Chart.js v4 configuration object that the frontend renders as a live chart. ' +
    'Supports: bar (comparison), line (trend), pie/doughnut (proportion), radar (multi-axis), polarArea. ' +
    'For markdown tables use build_table instead. ' +
    'For PDF reports with embedded charts, use create_pdf with an image link (separate step).',

  inputSchema: makeChartSchema,
  availableIn: ['work'],

  execute: async (input: MakeChartInput): Promise<ToolResult> => {
    const { type, title, labels, datasets, xAxisLabel, yAxisLabel } = input;

    try {
      // Validate: dataset data length must match labels length
      for (let i = 0; i < datasets.length; i++) {
        if (datasets[i].data.length !== labels.length) {
          return {
            ok: false,
            error:
              `Dataset ${i + 1} ("${datasets[i].label}") has ${datasets[i].data.length} values ` +
              `but labels has ${labels.length}. They must match.`,
            hint: 'Either pad the dataset with 0s, or trim the labels.',
          };
        }
      }

      // Validate: pie/doughnut/radar/polarArea support only 1 dataset meaningfully
      if (['pie', 'doughnut', 'radar', 'polarArea'].includes(type) && datasets.length > 1) {
        return {
          ok: false,
          error:
            `Chart type "${type}" works best with a single dataset. You provided ${datasets.length}. ` +
            `Multi-dataset ${type} charts are hard to read.`,
          hint: 'Either switch to bar/line for multiple datasets, or call make_chart separately for each.',
        };
      }

      // Auto-assign colors if not provided
      const palette = [
        'rgba(255, 99, 132, 0.7)', // red
        'rgba(54, 162, 235, 0.7)', // blue
        'rgba(255, 206, 86, 0.7)', // yellow
        'rgba(75, 192, 192, 0.7)', // green
        'rgba(153, 102, 255, 0.7)', // purple
        'rgba(255, 159, 64, 0.7)', // orange
        'rgba(199, 199, 199, 0.7)', // gray
        'rgba(83, 102, 255, 0.7)', // indigo
        'rgba(255, 99, 255, 0.7)', // pink
        'rgba(99, 255, 132, 0.7)', // mint
      ];

      const borderPalette = [
        'rgba(255, 99, 132, 1)',
        'rgba(54, 162, 235, 1)',
        'rgba(255, 206, 86, 1)',
        'rgba(75, 192, 192, 1)',
        'rgba(153, 102, 255, 1)',
        'rgba(255, 159, 64, 1)',
        'rgba(199, 199, 199, 1)',
        'rgba(83, 102, 255, 1)',
        'rgba(255, 99, 255, 1)',
        'rgba(99, 255, 132, 1)',
      ];

      const isMultiSlice = ['pie', 'doughnut', 'polarArea'].includes(type);

      const enrichedDatasets = datasets.map((ds, idx) => {
        let backgroundColor = ds.backgroundColor;
        let borderColor = ds.borderColor;

        if (!backgroundColor) {
          if (isMultiSlice) {
            // For pie/doughnut, each slice gets a different color
            backgroundColor = labels.map((_, i) => palette[i % palette.length]);
          } else {
            backgroundColor = palette[idx % palette.length];
          }
        }

        if (!borderColor) {
          if (isMultiSlice) {
            borderColor = '#fff';
          } else {
            borderColor = borderPalette[idx % borderPalette.length];
          }
        }

        return {
          ...ds,
          backgroundColor,
          borderColor,
          borderWidth: type === 'line' ? 2 : 1,
        };
      });

      // Build the Chart.js v4 config
      const isPieOrDoughnut = type === 'pie' || type === 'doughnut';

      const config: Record<string, unknown> = {
        type,
        data: {
          labels,
          datasets: enrichedDatasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: title,
              font: { size: 16, weight: 'bold' as const },
              padding: { top: 10, bottom: 20 },
            },
            legend: {
              display: true,
              position: isPieOrDoughnut ? 'right' : 'top',
            },
            tooltip: {
              enabled: true,
            },
          },
        },
      };

      // Axis configuration for cartesian charts (bar, line)
      if (type === 'bar' || type === 'line') {
        (config.options as any).scales = {
          x: {
            title: {
              display: !!xAxisLabel,
              text: xAxisLabel ?? '',
              font: { weight: 'bold' as const },
            },
            grid: { display: false },
          },
          y: {
            title: {
              display: !!yAxisLabel,
              text: yAxisLabel ?? '',
              font: { weight: 'bold' as const },
            },
            beginAtZero: true,
          },
        };
      }

      // Radar/PolarArea use a single radial scale
      if (type === 'radar' || type === 'polarArea') {
        (config.options as any).scales = {
          r: {
            beginAtZero: true,
            grid: { display: true },
          },
        };
      }

      // For line charts, add tension for smooth curves
      if (type === 'line') {
        enrichedDatasets.forEach((ds) => {
          (ds as any).tension = 0.3;
          (ds as any).fill = false;
        });
      }

      // For doughnut, set cutout
      if (type === 'doughnut') {
        (config.options as any).cutout = '60%';
      }

      const json = JSON.stringify(config, null, 2);

      return {
        ok: true,
        chartType: type,
        title,
        config,
        configJson: json,
        labelsCount: labels.length,
        datasetsCount: datasets.length,
        renderer: 'chart.js',
        instructions:
          'Pass the config object to `new Chart(canvas, config)`. ' +
          'Chart.js v4+ is required. For static PNG, call chart.toBase64Image() after render.',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Chart generation failed: ${message}` };
    }
  },
};
