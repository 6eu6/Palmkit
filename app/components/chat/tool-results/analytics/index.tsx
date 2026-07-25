/**
 * Analytics tool renderers
 * =======================
 * Dispatcher for analytics tools: make_chart, build_table, analyze_data.
 */

import { memo } from 'react';
import { ChartRenderer } from './ChartRenderer';
import { TableRenderer } from './TableRenderer';
import { DataAnalysisRenderer } from './DataAnalysisRenderer';
import { GenericToolResult } from '~/components/chat/tool-results/shared/GenericToolResult';

interface AnalyticsRenderersProps {
  toolName: string;
  result: unknown;
  theme: 'light' | 'dark';
}

function AnalyticsRenderersImpl({ toolName, result, theme: _theme }: AnalyticsRenderersProps) {
  switch (toolName) {
    case 'make_chart':
      return <ChartRenderer result={result} theme={_theme} />;
    case 'build_table':
      return <TableRenderer result={result} theme={_theme} />;
    case 'analyze_data':
      return <DataAnalysisRenderer result={result} theme={_theme} />;
    default:
      return <GenericToolResult result={result} toolName={toolName} />;
  }
}

export default memo(AnalyticsRenderersImpl);
