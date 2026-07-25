/**
 * WebPreview — Generated UI preview + source code
 * ================================================
 *
 * Provides a flexible way to showcase the result of a generated UI
 * component, along with its source code.
 *
 * <WebPreview
 *   title="My Component"
 *   html="<div>Hello</div>"
 *   console={[
 *     { time: "10:45:42 PM", text: "Page loaded successfully" }
 *   ]}
 * />
 *
 * Monochrome: tabs use textSecondary for inactive, textPrimary for active.
 * Icons: i-ph:eye for preview, i-ph:code for source, i-ph:terminal for console.
 */

import { memo, useState } from 'react';
import { classNames } from '~/utils/classNames';

interface ConsoleEntry {
  time: string;
  text: string;
  level?: 'log' | 'warn' | 'error';
}

interface WebPreviewProps {
  title?: string;
  html?: string;
  source?: string;
  console?: ConsoleEntry[];
  className?: string;
}

function WebPreviewImpl({ title, html, source, console: consoleEntries, className }: WebPreviewProps) {
  const [tab, setTab] = useState<'preview' | 'source' | 'console'>('preview');

  const tabs: Array<{ id: typeof tab; label: string; icon: string; visible: boolean }> = [
    { id: 'preview', label: 'Preview', icon: 'i-ph:eye', visible: Boolean(html) },
    { id: 'source', label: 'Source', icon: 'i-ph:code', visible: Boolean(source) },
    { id: 'console', label: 'Console', icon: 'i-ph:terminal', visible: Boolean(consoleEntries?.length) },
  ];

  const visibleTabs = tabs.filter((t) => t.visible);

  return (
    <div
      className={classNames(
        'rounded-md border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 overflow-hidden',
        className,
      )}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-palmkit-elements-borderColor">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-palmkit-elements-background-depth-3" />
          <div className="w-2.5 h-2.5 rounded-full bg-palmkit-elements-background-depth-3" />
          <div className="w-2.5 h-2.5 rounded-full bg-palmkit-elements-background-depth-3" />
        </div>
        {title && <span className="text-xs text-palmkit-elements-textSecondary ml-2">{title}</span>}
      </div>

      {/* Tabs */}
      {visibleTabs.length > 1 && (
        <div className="flex border-b border-palmkit-elements-borderColor">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={classNames(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors',
                tab === t.id
                  ? 'border-palmkit-elements-textPrimary text-palmkit-elements-textPrimary'
                  : 'border-transparent text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary',
              )}
            >
              <div className={classNames('text-sm', t.icon)} />
              {t.label}
              {t.id === 'console' && consoleEntries && consoleEntries.length > 0 && (
                <span className="px-1 rounded text-[9px] bg-palmkit-elements-background-depth-2">
                  {consoleEntries.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="max-h-96 overflow-auto">
        {tab === 'preview' && html && (
          <div className="bg-white dark:bg-palmkit-elements-background-depth-2">
            <iframe
              srcDoc={html}
              className="w-full h-64 border-0"
              title="Preview"
              sandbox="allow-same-origin allow-popups"
            />
          </div>
        )}
        {tab === 'source' && source && (
          <pre className="text-xs p-3 overflow-x-auto whitespace-pre-wrap break-all text-palmkit-elements-textPrimary">
            {source}
          </pre>
        )}
        {tab === 'console' && consoleEntries && (
          <div className="p-3 space-y-0.5 font-mono text-xs">
            {consoleEntries.map((entry, idx) => (
              <div key={idx} className="flex gap-2">
                <span className="text-palmkit-elements-textSecondary shrink-0">{entry.time}</span>
                <span
                  className={classNames(
                    entry.level === 'error' && 'text-palmkit-elements-textPrimary font-bold',
                    entry.level === 'warn' && 'text-palmkit-elements-textPrimary',
                    !entry.level && 'text-palmkit-elements-textSecondary',
                  )}
                >
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const WebPreview = memo(WebPreviewImpl);
