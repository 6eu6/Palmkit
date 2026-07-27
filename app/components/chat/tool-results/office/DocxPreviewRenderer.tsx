/**
 * DocxPreviewRenderer
 * ==================
 * Renders the result of the `create_docx` tool.
 *
 * Similar to PDFPreviewRenderer but with a .doc download instead of print.
 * The HTML is Word-compatible (opens in Word, Google Docs, LibreOffice).
 */

import { memo, useState, useMemo } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';
import { classNames } from '~/utils/classNames';

interface DocxPreviewRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface CreateDocxResult {
  ok: boolean;
  title?: string;
  format?: string;
  content?: string;
  contentLength?: number;
  mimeType?: string;
  filename?: string;
  instructions?: string;
  error?: string;
}

function DocxPreviewRendererImpl({ result, theme: _theme }: DocxPreviewRendererProps) {
  const [previewMode, setPreviewMode] = useState<'rendered' | 'source'>('rendered');

  const data = result as CreateDocxResult;

  const previewUrl = useMemo(() => {
    if (!data.content) {
      return '';
    }

    const blob = new Blob([data.content], { type: 'text/html' });

    return URL.createObjectURL(blob);
  }, [data.content]);

  const handleOpenInWord = () => {
    if (data.content) {
      const blob = new Blob([data.content], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename ?? 'document.doc';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="create_docx"
          label="Word Document"
          iconClass="i-ph:file-doc"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="create_docx"
        label={data.title ?? 'Word Document'}
        iconClass="i-ph:file-doc"
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
        <button
          onClick={handleOpenInWord}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-primary-background hover:bg-palmkit-elements-button-primary-backgroundHover text-palmkit-elements-button-primary-text"
        >
          <div className="i-ph:file-doc text-base" />
          Download .doc (opens in Word)
        </button>
        <DownloadButton
          data={data.content}
          filename={(data.filename ?? 'document.html').replace(/\.doc$/, '.html')}
          mimeType="text/html"
          label="Download HTML"
          iconClass="i-ph:code"
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
          HTML source
        </button>
      </div>

      {previewMode === 'rendered' ? (
        <iframe
          src={previewUrl}
          className="w-full h-[600px] border border-palmkit-elements-borderColor rounded-md bg-white"
          title="Word document preview"
          sandbox="allow-same-origin"
        />
      ) : (
        <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
          {data.content}
        </pre>
      )}

      <div className="mt-3">
        <CollapsibleSection title="Instructions">
          <p className="text-xs text-palmkit-elements-textSecondary">{data.instructions}</p>
        </CollapsibleSection>
      </div>
    </div>
  );
}

export const DocxPreviewRenderer = memo(DocxPreviewRendererImpl);
