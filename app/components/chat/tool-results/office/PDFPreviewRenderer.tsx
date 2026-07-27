/**
 * PDFPreviewRenderer
 * =================
 * Renders the result of the `create_pdf` tool.
 *
 * The tool returns HTML content (print-ready, A4). We render:
 *   1. Header: title, file size, download button
 *   2. Action buttons: Open in new tab, Print (save as PDF), Download HTML
 *   3. Live preview: iframe showing the HTML rendered
 *   4. Collapsible: raw HTML source
 *
 * The "Print" button opens the browser print dialog — the user picks
 * "Save as PDF" to get the actual PDF. This matches the tool's design
 * (see app/lib/.server/tools/office/create-pdf.ts).
 */

import { memo, useState, useMemo, useRef } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { DownloadButton } from '~/components/chat/tool-results/shared/DownloadButton';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';
import { classNames } from '~/utils/classNames';

interface PDFPreviewRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface CreatePdfResult {
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

// eslint-disable-next-line @typescript-eslint/naming-convention
function PDFPreviewRendererImpl({ result, theme: _theme }: PDFPreviewRendererProps) {
  const [previewMode, setPreviewMode] = useState<'rendered' | 'source'>('rendered');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const data = result as CreatePdfResult;

  // Build a blob URL for the iframe preview (avoids CSP issues with srcDoc)
  const previewUrl = useMemo(() => {
    if (!data.content) {
      return '';
    }

    const blob = new Blob([data.content], { type: 'text/html' });

    return URL.createObjectURL(blob);
  }, [data.content]);

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  };

  const handleOpenInNewTab = () => {
    if (data.content) {
      const blob = new Blob([data.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  };

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="create_pdf"
          label="PDF Document"
          iconClass="i-ph:file-pdf"
          success={false}
          error={data.error}
        />
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="create_pdf"
        label={data.title ?? 'PDF Document'}
        iconClass="i-ph:file-pdf"
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
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-primary-background hover:bg-palmkit-elements-button-primary-backgroundHover text-palmkit-elements-button-primary-text"
        >
          <div className="i-ph:printer text-base" />
          Print / Save as PDF
        </button>
        <button
          onClick={handleOpenInNewTab}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-palmkit-elements-button-neutral-background hover:bg-palmkit-elements-button-neutral-backgroundHover text-palmkit-elements-button-neutral-text border border-palmkit-elements-borderColor"
        >
          <div className="i-ph:arrow-square-out text-base" />
          Open in new tab
        </button>
        <DownloadButton
          data={data.content}
          filename={data.filename ?? 'document.html'}
          mimeType="text/html"
          label="Download HTML"
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
          ref={iframeRef}
          src={previewUrl}
          className="w-full h-[600px] border border-palmkit-elements-borderColor rounded-md bg-white"
          title="PDF preview"
          sandbox="allow-same-origin allow-popups"
        />
      ) : (
        <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-all">
          {data.content}
        </pre>
      )}

      <div className="mt-3">
        <CollapsibleSection title="Instructions" badge={data.instructions ? '1 step' : undefined}>
          <p className="text-xs text-palmkit-elements-textSecondary">{data.instructions}</p>
        </CollapsibleSection>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const PDFPreviewRenderer = memo(PDFPreviewRendererImpl);
