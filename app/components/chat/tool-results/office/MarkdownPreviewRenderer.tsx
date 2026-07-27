/**
 * MarkdownPreviewRenderer
 * =======================
 * Renders the result of the `create_md` tool.
 *
 * Shows:
 *   1. Header: filename, file size, download button
 *   2. Tabbed view: Rendered preview (markdown → HTML) | Raw source
 *   3. Download as .md file
 */

import { memo, useState, useMemo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';
import { Markdown } from '~/components/chat/Markdown';
import { classNames } from '~/utils/classNames';

interface MarkdownPreviewRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface CreateMdResult {
  ok: boolean;
  title?: string;
  format?: string;
  content?: string;
  contentLength?: number;
  mimeType?: string;
  filename?: string;
  error?: string;
}

function MarkdownPreviewRendererImpl({ result, theme: _theme }: MarkdownPreviewRendererProps) {
  const [previewMode, setPreviewMode] = useState<'rendered' | 'source'>('rendered');

  const data = result as CreateMdResult;

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="create_md"
          label="Markdown File"
          iconClass="i-ph:file-text"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="create_md"
        label={data.filename ?? 'Markdown File'}
        iconClass="i-ph:file-text"
        success
        meta={
          data.contentLength && (
            <span className="text-xs text-palmkit-elements-textSecondary">
              {(data.contentLength / 1024).toFixed(1)} KB
            </span>
          )
        }
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <DownloadButton
          data={data.content}
          filename={data.filename ?? 'document.md'}
          mimeType="text/markdown"
          label="Download .md"
        />
      </div>

      <div className="flex gap-1 mb-2 border-b border-palmkit-elements-borderColor">
        <button
          onClick={() => setPreviewMode('rendered')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            previewMode === 'rendered'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary',
          )}
        >
          Preview
        </button>
        <button
          onClick={() => setPreviewMode('source')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            previewMode === 'source'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary',
          )}
        >
          Markdown source
        </button>
      </div>

      {previewMode === 'rendered' ? (
        <div className="prose prose-sm dark:prose-invert max-w-none p-3 rounded-md bg-palmkit-elements-background-depth-2 max-h-[600px] overflow-y-auto">
          <Markdown>{data.content || ''}</Markdown>
        </div>
      ) : (
        <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
          {data.content}
        </pre>
      )}
    </div>
  );
}

export const MarkdownPreviewRenderer = memo(MarkdownPreviewRendererImpl);
