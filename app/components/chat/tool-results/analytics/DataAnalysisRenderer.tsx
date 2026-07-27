/**
 * DataAnalysisRenderer
 * ===================
 * Renders the result of the `analyze_data` tool.
 *
 * Shows:
 *   1. Top-level insights (auto-generated bullet points)
 *   2. Per-column statistics (numeric: min/max/mean/median/stddev; text: top values)
 *   3. Sample rows
 *
 * The insights are the most useful part — they're what the LLM surfaces
 * to the user. We display them prominently at the top.
 */

import { memo, useState } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { classNames } from '~/utils/classNames';

interface DataAnalysisRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface NumericColumnStats {
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

interface TextColumnStats {
  type: 'text';
  count: number;
  missing: number;
  unique: number;
  topValues: Array<{ value: string; count: number; percentage: number }>;
}

interface MixedColumnStats {
  type: 'mixed';
  count: number;
  missing: number;
  numericCount: number;
  textCount: number;
  note: string;
}

type ColumnStats = NumericColumnStats | TextColumnStats | MixedColumnStats;

interface AnalyzeDataResult {
  ok: boolean;
  format?: string;
  delimiter?: string;
  totalRows?: number;
  totalColumns?: number;
  columns?: Record<string, ColumnStats>;
  sample?: Array<Record<string, unknown>>;
  insights?: string[];
  error?: string;
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return (n / 1_000_000).toFixed(2) + 'M';
  }

  if (Math.abs(n) >= 1_000) {
    return (n / 1_000).toFixed(2) + 'k';
  }

  if (Number.isInteger(n)) {
    return n.toString();
  }

  return n.toFixed(4).replace(/\.?0+$/, '');
}

function DataAnalysisRendererImpl({ result, theme: _theme }: DataAnalysisRendererProps) {
  const [view, setView] = useState<'insights' | 'columns' | 'sample'>('insights');

  const data = result as AnalyzeDataResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="analyze_data"
          label="Data Analysis"
          iconClass="i-ph:chart-line-up"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="analyze_data"
        label="Data Analysis"
        iconClass="i-ph:chart-line-up"
        success
        accentColor="bg-purple-500/10"
        meta={
          <>
            <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.format}</span>
            {data.totalRows !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.totalRows} × {data.totalColumns}
              </span>
            )}
          </>
        }
      />

      <div className="flex gap-1 mb-3 border-b border-palmkit-elements-borderColor">
        <button
          onClick={() => setView('insights')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            view === 'insights'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary',
          )}
        >
          Insights {data.insights && `(${data.insights.length})`}
        </button>
        <button
          onClick={() => setView('columns')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            view === 'columns'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary',
          )}
        >
          Columns {data.columns && `(${Object.keys(data.columns).length})`}
        </button>
        <button
          onClick={() => setView('sample')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            view === 'sample'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary',
          )}
        >
          Sample rows
        </button>
      </div>

      {view === 'insights' && (
        <div className="space-y-2">
          {data.insights?.map((insight, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2 rounded-md bg-palmkit-elements-background-depth-2">
              <div className="text-base text-palmkit-elements-item-contentAccent mt-0.5 i-ph:lightbulb" />
              <span className="text-xs text-palmkit-elements-textPrimary flex-1">{insight}</span>
            </div>
          ))}
          {!data.insights?.length && (
            <div className="text-xs text-palmkit-elements-textSecondary italic">No auto-generated insights.</div>
          )}
        </div>
      )}

      {view === 'columns' && (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {data.columns &&
            Object.entries(data.columns).map(([colName, stats]) => (
              <div key={colName} className="border border-palmkit-elements-borderColor rounded-md p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-palmkit-elements-textPrimary">{colName}</span>
                  <span
                    className={classNames(
                      'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
                      stats.type === 'numeric'
                        ? 'bg-blue-500/10 text-blue-500'
                        : stats.type === 'text'
                          ? 'bg-green-500/10 text-green-500'
                          : 'bg-orange-500/10 text-orange-500',
                    )}
                  >
                    {stats.type}
                  </span>
                  <span className="text-xs text-palmkit-elements-textSecondary ml-auto">
                    {stats.count} values
                    {stats.missing > 0 && (
                      <span className="text-palmkit-elements-icon-warning ml-1">({stats.missing} missing)</span>
                    )}
                  </span>
                </div>

                {stats.type === 'numeric' && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <Stat label="Min" value={formatNumber(stats.min)} />
                    <Stat label="Max" value={formatNumber(stats.max)} />
                    <Stat label="Mean" value={formatNumber(stats.mean)} />
                    <Stat label="Median" value={formatNumber(stats.median)} />
                    <Stat label="Std Dev" value={formatNumber(stats.stddev)} />
                    <Stat label="Sum" value={formatNumber(stats.sum)} />
                    {stats.outliers > 0 && (
                      <Stat label="Outliers" value={stats.outliers.toString()} highlight="warning" />
                    )}
                  </div>
                )}

                {stats.type === 'text' && (
                  <div className="space-y-1">
                    <div className="text-xs text-palmkit-elements-textSecondary">{stats.unique} unique values</div>
                    <div className="space-y-1">
                      {stats.topValues.slice(0, 3).map((tv, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <span className="text-palmkit-elements-textPrimary truncate flex-1">
                            {tv.value || '(empty)'}
                          </span>
                          <span className="text-palmkit-elements-textSecondary whitespace-nowrap">
                            {tv.count}× ({tv.percentage}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {stats.type === 'mixed' && (
                  <div className="text-xs text-palmkit-elements-textSecondary italic">
                    {stats.note} ({stats.numericCount} numeric, {stats.textCount} text)
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {view === 'sample' && (
        <div className="overflow-auto max-h-96 border border-palmkit-elements-borderColor rounded-md">
          {data.sample && data.sample.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-palmkit-elements-background-depth-2">
                <tr>
                  {Object.keys(data.sample[0]).map((col) => (
                    <th
                      key={col}
                      className="px-3 py-1.5 text-left font-semibold border-r border-palmkit-elements-borderColor"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sample.map((row, idx) => (
                  <tr key={idx} className="hover:bg-palmkit-elements-background-depth-2">
                    {Object.values(row).map((val, cellIdx) => (
                      <td key={cellIdx} className="px-3 py-1.5 border-r border-palmkit-elements-borderColor">
                        {String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-palmkit-elements-textSecondary italic p-4 text-center">
              No sample rows available.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  highlight?: 'warning' | 'error';
}

function Stat({ label, value, highlight }: StatProps) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-palmkit-elements-textSecondary uppercase">{label}</span>
      <span
        className={classNames(
          'font-mono',
          highlight === 'warning' ? 'text-palmkit-elements-icon-warning' : 'text-palmkit-elements-textPrimary',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export const DataAnalysisRenderer = memo(DataAnalysisRendererImpl);
