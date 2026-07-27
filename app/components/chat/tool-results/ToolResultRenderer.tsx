/**
 * ToolResultRenderer
 * ==================
 * The main dispatcher that inspects a tool invocation result and
 * delegates to the appropriate specialized renderer component.
 *
 * Architecture:
 *   - Each tool category (office, analytics, creative, investigative, code)
 *     has its own subdirectory with one renderer per tool.
 *   - The dispatcher uses a switch on toolName to pick the renderer.
 *   - For unknown tools or error results, falls back to a generic
 *     JSON renderer (preserves backward compat with MCP tools).
 *
 * The renderer is injected into ToolInvocations.tsx — when the tool
 * result matches one of our 19 native tools, we render a rich UI;
 * otherwise we fall back to the existing JSON display.
 *
 * Design principles:
 *   1. NEVER crash on malformed input — every renderer validates the
 *      result shape and falls back to JSON if it doesn't match.
 *   2. ALWAYS show the raw JSON in a collapsible <details> section so
 *      the user can debug if the rich UI is wrong.
 *   3. Rich UI components are LAZY loaded — only the renderer for the
 *      tool actually being displayed is imported.
 *   4. All renderers are memo'd to prevent re-renders when unrelated
 *      state changes.
 */

import { memo, lazy, Suspense, type ReactNode } from 'react';
import type { ToolInvocationUIPart } from '@ai-sdk/ui-utils';
import { logger } from '~/utils/logger';

/*
 * Lazy-load each category's renderers so they only ship to the client
 * when actually needed. This keeps the main bundle small.
 */
const OfficeRenderers = lazy(() => import('./office'));
const AnalyticsRenderers = lazy(() => import('./analytics'));
const CreativeRenderers = lazy(() => import('./creative'));
const InvestigativeRenderers = lazy(() => import('./investigative'));
const CodeRenderers = lazy(() => import('./code'));

import { GenericToolResult } from './shared/GenericToolResult';

export interface ToolResultRendererProps {
  /** The tool invocation (contains toolName, args, result, state). */
  toolInvocation: ToolInvocationUIPart['toolInvocation'];

  /** Optional: theme for code highlighting etc. */
  theme?: 'light' | 'dark';
}

/**
 * Map of toolName → category for fast lookup.
 * Tools not in this map fall back to the GenericToolResult (JSON view).
 */
const TOOL_TO_CATEGORY: Record<string, 'office' | 'analytics' | 'creative' | 'investigative' | 'code'> = {
  // Office
  create_pdf: 'office',
  create_docx: 'office',
  create_xlsx: 'office',
  read_document: 'office',

  // Analytics
  make_chart: 'analytics',
  build_table: 'analytics',
  analyze_data: 'analytics',

  // Creative
  generate_image: 'creative',

  // Investigative
  web_search: 'investigative',
  read_url: 'investigative',
  scrape_page: 'investigative',
  deep_search: 'investigative',
  read_and_extract: 'investigative',

  // Code
  read_file: 'code',
  list_files: 'code',
  grep: 'code',
  run_shell: 'code',
  screenshot: 'code',
  read_sandbox_file: 'code',
};

/**
 * The dispatcher. Inspects toolName, picks the right category, and
 * delegates rendering.
 *
 * For unknown tools or tools in 'call' state (not yet executed),
 * returns null — the caller (ToolInvocations) handles those cases.
 *
 * Note: ToolInvocation is a discriminated union in AI SDK v4. The
 * `result` field only exists when state === 'result'. We cast to
 * `any` here because the discriminated union narrowing doesn't
 * propagate through the switch statement cleanly.
 */
function ToolResultRendererImpl({ toolInvocation, theme: _theme = 'dark' }: ToolResultRendererProps): ReactNode {
  const { toolName, state } = toolInvocation;

  // Cast to access `result` — we already checked state above
  const result = (toolInvocation as any).result;

  // Only render results, not pending calls
  if (state !== 'result') {
    return null;
  }

  // If result is an error string (TOOL_EXECUTION_DENIED etc.), show generic
  if (typeof result === 'string') {
    return <GenericToolResult result={result} toolName={toolName} />;
  }

  const category = TOOL_TO_CATEGORY[toolName];

  if (!category) {
    // Unknown tool — fall back to JSON view
    return <GenericToolResult result={result} toolName={toolName} />;
  }

  try {
    return (
      <Suspense fallback={<GenericToolResult result={result} toolName={toolName} loading />}>
        {category === 'office' && <OfficeRenderers toolName={toolName} result={result} theme={_theme} />}
        {category === 'analytics' && <AnalyticsRenderers toolName={toolName} result={result} theme={_theme} />}
        {category === 'creative' && <CreativeRenderers toolName={toolName} result={result} theme={_theme} />}
        {category === 'investigative' && <InvestigativeRenderers toolName={toolName} result={result} theme={_theme} />}
        {category === 'code' && <CodeRenderers toolName={toolName} result={result} theme={_theme} />}
      </Suspense>
    );
  } catch (err) {
    logger.error(`[ToolResultRenderer] Failed to render ${toolName}`, err);
    return <GenericToolResult result={result} toolName={toolName} error="Renderer crashed" />;
  }
}

export const ToolResultRenderer = memo(ToolResultRendererImpl);
