/**
 * DocumentContentRenderer
 * ======================
 * Renders the result of the `read_document` tool.
 *
 * Shows the extracted text content with syntax highlighting for code
 * files, plus metadata (filename, format, size, truncation status).
 *
 * PDF special case:
 *   The server returns `pdfExtractionRequired: true` because pdfjs-dist
 *   can't run in CF Workers. The client renderer offers an "Extract text"
 *   button that dynamically imports pdfjs-dist and parses the PDF in
 *   the browser. This keeps the server bundle small while still
 *   supporting PDF reading.
 */

import { memo, useState, useCallback } from 'react';
import { ToolResultHeader } from '~/components/chat/tool-results/shared/ToolResultHeader';
import { CollapsibleSection } from '~/components/chat/tool-results/shared/CollapsibleSection';
import { classNames } from '~/utils/classNames';

interface DocumentContentRendererProps {
  result: unknown;
  theme: 'light' | 'dark';
}

interface ReadDocumentResult {
  ok: boolean;
  filename?: string;
  format?: string;
  content?: string;
  originalLength?: number;
  truncated?: boolean;
  bytes?: number;
  error?: string;

  // PDF-specific fields
  pdfExtractionRequired?: boolean;
  pdfContentBase64?: string;
  hint?: string;
}

/**
 * Extract text from a PDF using pdfjs-dist.
 *
 * This function is called CLIENT-SIDE only (uses dynamic import to keep
 * pdfjs-dist out of the main bundle). The library is ~1.5MB so we only
 * load it when the user actually clicks "Extract text".
 *
 * Returns the extracted text concatenated from all pages.
 */
async function extractPdfText(base64: string): Promise<{ text: string; pageCount: number }> {
  // Dynamic import — pdfjs-dist is only loaded when this function runs
  const pdfjsLib: any = await import('pdfjs-dist');

  /*
   * Set the worker source. We use the bundled worker (no CDN needed).
   * pdfjs-dist v4+ ships with a worker that can be loaded as a module.
   */
  if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      // Try to use the bundled worker (works with Vite)
      const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;
    } catch {
      // Fallback: use CDN worker (last resort)
      const version = pdfjsLib.version;
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
    }
  }

  // Decode base64 → Uint8Array
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  // Extract text from each page
  const textParts: string[] = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText) {
      textParts.push(`--- Page ${pageNum} ---\n${pageText}`);
    }

    // Cleanup page resources
    page.cleanup();
  }

  await pdf.destroy();

  return {
    text: textParts.join('\n\n'),
    pageCount,
  };
}

function DocumentContentRendererImpl({ result, theme: _theme }: DocumentContentRendererProps) {
  const [view, setView] = useState<'formatted' | 'raw'>('formatted');
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  const data = result as ReadDocumentResult;

  const handleExtractPdf = useCallback(async () => {
    if (!data.pdfContentBase64) {
      return;
    }

    setExtracting(true);
    setExtractError(null);

    try {
      const result = await extractPdfText(data.pdfContentBase64);
      setExtractedText(result.text);
      setPageCount(result.pageCount);
    } catch (err: any) {
      setExtractError(err?.message ?? 'Failed to extract PDF text');
      console.error('PDF extraction failed:', err);
    } finally {
      setExtracting(false);
    }
  }, [data.pdfContentBase64]);

  // PDF special case: show extract button
  if (data.ok && data.pdfExtractionRequired) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="read_document"
          label={data.filename ?? 'PDF Document'}
          iconClass="i-ph:file-pdf"
          success
          accentColor="bg-red-500/10"
          meta={
            <>
              <span className="text-xs text-palmkit-elements-textSecondary uppercase">PDF</span>
              {data.bytes !== undefined && (
                <span className="text-xs text-palmkit-elements-textSecondary">{(data.bytes / 1024).toFixed(1)} KB</span>
              )}
            </>
          }
        />

        <div className="p-3 rounded-md bg-palmkit-elements-background-depth-2 border border-palmkit-elements-borderColor">
          <div className="flex items-start gap-2 mb-3">
            <div className="i-ph:file-pdf text-xl text-red-500 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-palmkit-elements-textPrimary mb-1">PDF text extraction</div>
              <div className="text-xs text-palmkit-elements-textSecondary">
                {data.hint ?? 'PDF parsing runs in your browser using pdfjs-dist.'}
              </div>
            </div>
          </div>

          {extractError && (
            <div className="mb-3 p-2 rounded-md bg-palmkit-elements-icon-error/10 text-xs text-palmkit-elements-icon-error">
              <div className="i-ph:warning inline-block mr-1" />
              {extractError}
            </div>
          )}

          <button
            onClick={handleExtractPdf}
            disabled={extracting}
            className={classNames(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              'bg-palmkit-elements-button-primary-background hover:bg-palmkit-elements-button-primary-backgroundHover',
              'text-palmkit-elements-button-primary-text',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <div
              className={classNames('text-base', extracting ? 'i-ph:spinner animate-spin' : 'i-ph:magnifying-glass')}
            />
            {extracting ? 'Extracting…' : 'Extract text'}
          </button>

          {extractedText !== null && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="i-ph:check-circle text-base text-palmkit-elements-icon-success" />
                <span className="text-xs text-palmkit-elements-textSecondary">
                  Extracted {pageCount} page{pageCount !== 1 ? 's' : ''}, {extractedText.length.toLocaleString()} chars
                </span>
              </div>
              <pre className="text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap break-words">
                {extractedText || '(PDF contains no extractable text — it may be a scanned image)'}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!data.ok) {
    return (
      <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
        <ToolResultHeader
          toolName="read_document"
          label="Document Reader"
          iconClass="i-ph:file-text"
          success={false}
          error={data.error}
        />
        {data.error?.includes('PDF') && (
          <div className="mt-2 p-3 rounded-md bg-palmkit-elements-icon-error/5 border border-palmkit-elements-icon-error/20 text-xs text-palmkit-elements-textSecondary">
            <div className="font-medium text-palmkit-elements-icon-error mb-1">PDF limitation</div>
            PDF text extraction requires the browser to parse the PDF. Please re-upload the file.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-palmkit-elements-background-depth-1 p-4 rounded-md">
      <ToolResultHeader
        toolName="read_document"
        label={data.filename ?? 'Document'}
        iconClass="i-ph:file-text"
        success
        meta={
          <>
            <span className="text-xs text-palmkit-elements-textSecondary uppercase">{data.format}</span>
            {data.bytes !== undefined && (
              <span className="text-xs text-palmkit-elements-textSecondary">{(data.bytes / 1024).toFixed(1)} KB</span>
            )}
            {data.originalLength !== undefined && data.originalLength > 0 && (
              <span className="text-xs text-palmkit-elements-textSecondary">
                {data.originalLength.toLocaleString()} chars
              </span>
            )}
          </>
        }
      />

      {data.truncated && (
        <div className="mb-3 p-2 rounded-md bg-palmkit-elements-icon-warning/10 text-xs text-palmkit-elements-textSecondary">
          <div className="i-ph:warning inline-block mr-1" />
          Content truncated to fit context window. Original: {data.originalLength?.toLocaleString()} chars.
        </div>
      )}

      <div className="flex gap-1 mb-2 border-b border-palmkit-elements-borderColor">
        <button
          onClick={() => setView('formatted')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            view === 'formatted'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary',
          )}
        >
          Formatted
        </button>
        <button
          onClick={() => setView('raw')}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium border-b-2 transition-colors',
            view === 'raw'
              ? 'border-palmkit-elements-item-contentAccent text-palmkit-elements-textPrimary'
              : 'border-transparent text-palmkit-elements-textSecondary',
          )}
        >
          Raw
        </button>
      </div>

      <pre
        className={classNames(
          'text-xs bg-[#FAFAFA] dark:bg-[#0A0A0A] p-3 rounded-md overflow-auto max-h-96',
          view === 'formatted' ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        )}
      >
        {data.content}
      </pre>

      {data.originalLength !== undefined && data.originalLength > 5000 && (
        <div className="mt-3">
          <CollapsibleSection title="Document statistics">
            <dl className="text-xs space-y-1">
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Filename:</dt>
                <dd className="text-palmkit-elements-textPrimary font-mono">{data.filename}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Format:</dt>
                <dd className="text-palmkit-elements-textPrimary uppercase">{data.format}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Original length:</dt>
                <dd className="text-palmkit-elements-textPrimary">{data.originalLength.toLocaleString()} chars</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Bytes:</dt>
                <dd className="text-palmkit-elements-textPrimary">{data.bytes?.toLocaleString() ?? 'N/A'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-palmkit-elements-textSecondary">Truncated:</dt>
                <dd className="text-palmkit-elements-textPrimary">{data.truncated ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

export const DocumentContentRenderer = memo(DocumentContentRendererImpl);
