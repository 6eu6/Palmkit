/**
 * Tool — Collapsible tool call display
 * ====================================
 *
 * Shows a tool call with its parameters and result in a clean,
 * collapsible card. Monochrome — no status colors, just icons.
 *
 * <Tool
 *   name="web_search"
 *   state="result"
 *   args={{ query: "react hooks" }}
 *   result={{ ok: true, results: [...] }}
 * />
 *
 * States:
 *   "call"   → shows "running…" with a subtle pulse icon
 *   "result" → shows checkmark, expandable to see parameters + result
 *
 * Compound structure:
 *   <Tool.Header>   — icon + name + status
 *   <Tool.Params>   — JSON parameters (collapsible)
 *   <Tool.Result>   — rich result (delegates to ToolResultRenderer)
 */

import { memo, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';

// Tool → icon mapping (Phosphor, monochrome)
const TOOL_ICONS: Record<string, string> = {
  web_search: 'i-ph:magnifying-glass',
  read_url: 'i-ph:link',
  scrape_page: 'i-ph:globe',
  deep_search: 'i-ph:binoculars',
  read_and_extract: 'i-ph:scan',
  create_pdf: 'i-ph:file-pdf',
  create_docx: 'i-ph:file-doc',
  create_xlsx: 'i-ph:file-xls',
  read_document: 'i-ph:file-text',
  make_chart: 'i-ph:chart-bar',
  build_table: 'i-ph:table',
  analyze_data: 'i-ph:chart-line-up',
  generate_image: 'i-ph:image',
  read_file: 'i-ph:file-code',
  list_files: 'i-ph:folder-open',
  grep: 'i-ph:magnifying-glass-bold',
  run_shell: 'i-ph:terminal',
  screenshot: 'i-ph:camera',
  read_sandbox_file: 'i-ph:file-search',
};

interface ToolProps {
  name: string;
  state: 'call' | 'result';
  args?: Record<string, unknown>;
  result?: unknown;

  /** Custom result renderer (e.g. ToolResultRenderer) */
  resultRenderer?: (result: unknown) => ReactNode;
  className?: string;
}

function ToolImpl({ name, state, args, result, resultRenderer, className }: ToolProps) {
  const [expanded, setExpanded] = useState(state === 'result');
  const isCall = state === 'call';
  const icon = TOOL_ICONS[name] ?? 'i-ph:gear';

  return (
    <div
      className={classNames(
        'rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 overflow-hidden',
        className,
      )}
    >
      {/* Header — always visible */}
      <button
        onClick={() => !isCall && setExpanded(!expanded)}
        disabled={isCall}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-palmkit-elements-background-depth-2 transition-colors disabled:cursor-default"
      >
        <div
          className={classNames(
            'text-sm text-palmkit-elements-textSecondary',
            !isCall && 'transition-transform',
            expanded && !isCall && 'rotate-90',
            isCall ? 'i-ph:circle-notch' : 'i-ph:caret-right-bold',
            isCall && 'animate-spin',
          )}
          style={isCall ? { animationDuration: '1.5s' } : undefined}
        />
        <div className={classNames('text-sm text-palmkit-elements-textSecondary', icon)} />
        <span className="text-xs font-mono text-palmkit-elements-textPrimary">{name}</span>
        <span className="text-xs text-palmkit-elements-textSecondary">{isCall ? '— running' : '— completed'}</span>
        {!isCall && <div className="ml-auto i-ph:check text-sm text-palmkit-elements-textSecondary" />}
      </button>

      {/* Expandable content */}
      <AnimatePresence>
        {expanded && !isCall && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-palmkit-elements-borderColor"
          >
            {/* Parameters */}
            {args && Object.keys(args).length > 0 && (
              <div className="px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-palmkit-elements-textSecondary mb-1">
                  Parameters
                </div>
                <pre className="text-xs bg-palmkit-elements-background-depth-2 p-2 rounded overflow-x-auto max-h-40">
                  {JSON.stringify(args, null, 2)}
                </pre>
              </div>
            )}

            {/* Result */}
            {result !== undefined && (
              <div className="px-3 py-2 border-t border-palmkit-elements-borderColor">
                <div className="text-[10px] uppercase tracking-wide text-palmkit-elements-textSecondary mb-1">
                  Result
                </div>
                {resultRenderer ? (
                  resultRenderer(result)
                ) : (
                  <pre className="text-xs bg-palmkit-elements-background-depth-2 p-2 rounded overflow-x-auto max-h-60">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const Tool = memo(ToolImpl);
