/**
 * ChartRenderer
 * =============
 * Renders the result of the `make_chart` tool.
 *
 * The tool returns a Chart.js v4 configuration object. We pass it
 * directly to react-chartjs-2's <Chart> component, which is already
 * installed in the project.
 *
 * Features:
 *   - Renders the chart live in the chat
 *   - "Download as PNG" button (uses chart.toBase64Image())
 *   - "Download config" button (saves the JSON config)
 *   - Collapsible raw config viewer
 *
 * The chart is responsive (maintainAspectRatio: false) so it fills
 * the available width. Height is fixed at 320px for chat context.
 */

import { memo, useRef, useState, useEffect } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { Chart as ReactChart } from 'react-chartjs-2';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';

// Register all Chart.js components once
ChartJS.register(...registerables);

interface ChartRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface MakeChartResult {
  ok: boolean;
  chartType?: string;
  title?: string;
  config?: any;
  configJson?: string;
  labelsCount?: number;
  datasetsCount?: number;
  renderer?: string;
  instructions?: string;
  error?: string;
}

function ChartRendererImpl({ result, theme: _theme }: ChartRendererProps) {
  const chartRef = useRef<ChartJS>(null);
  const [chartReady, setChartReady] = useState(false);

  const data = result as MakeChartResult;

  useEffect(() => {
    if (chartRef.current) {
      setChartReady(true);
    }
  }, [data.config]);

  const handleDownloadPng = () => {
    const chart = chartRef.current;

    if (!chart) {
      return;
    }

    const url = chart.toBase64Image('image/png', 1);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.title?.replace(/[^a-z0-9]+/gi, '-').toLowerCase() ?? 'chart'}.png`;
    link.click();
  };

  if (!data.ok || !data.config) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="make_chart"
          label="Chart"
          iconClass="i-ph:chart-bar"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="make_chart"
        label={data.title ?? 'Chart'}
        iconClass="i-ph:chart-bar"
        success
        accentColor="bg-blue-500/10"
        meta={
          <>
            <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.chartType}</span>
            {data.labelsCount !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.labelsCount} × {data.datasetsCount} dataset{data.datasetsCount !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={handleDownloadPng}
          disabled={!chartReady}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-primary-background hover:bg-palmkit-elements-button-primary-backgroundHover text-palmkit-elements-button-primary-text disabled:opacity-50"
        >
          <div className="i-ph:image text-base" />
          Download PNG
        </button>
        <DownloadButton
          data={data.configJson}
          filename={`${(data.title ?? 'chart').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-config.json`}
          mimeType="application/json"
          label="Download config"
          iconClass="i-ph:file-code"
        />
      </div>

      <div className="bg-white dark:bg-palmkit-elements-background-depth-2 rounded-md p-4 border border-palmkit-elements-borderColor">
        <div style={{ height: '320px', position: 'relative' }}>
          <ReactChart ref={chartRef} type={data.config.type} data={data.config.data} options={data.config.options} />
        </div>
      </div>

      <div className="mt-3">
        <CollapsibleSection title="Chart.js configuration" badge="JSON">
          <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-auto max-h-96 whitespace-pre">
            {data.configJson}
          </pre>
        </CollapsibleSection>
      </div>

      {data.instructions && (
        <div className="mt-2 text-xs text-palmkit-elements-textSecondary italic">{data.instructions}</div>
      )}
    </div>
  );
}

export const ChartRenderer = memo(ChartRendererImpl);
