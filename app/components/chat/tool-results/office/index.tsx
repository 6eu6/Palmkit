/**
 * Office tool renderers
 * ====================
 * Lazy-loaded module that exports a single dispatcher component.
 * The dispatcher switches on toolName and renders the appropriate
 * office-specific renderer.
 *
 * Tools:
 *   - create_pdf    → PDFPreviewRenderer
 *   - create_docx   → DocxPreviewRenderer
 *   - create_xlsx   → XlsxPreviewRenderer
 *   - read_document → DocumentContentRenderer
 */

import { memo } from 'react';
import { PDFPreviewRenderer } from './PDFPreviewRenderer';
import { DocxPreviewRenderer } from './DocxPreviewRenderer';
import { XlsxPreviewRenderer } from './XlsxPreviewRenderer';
import { DocumentContentRenderer } from './DocumentContentRenderer';
import { GenericToolResult } from '~/components/chat/tool-results/shared/GenericToolResult';

interface OfficeRenderersProps {
  toolName: string;
  result: unknown;
  theme: 'light' | 'dark';
}

function OfficeRenderersImpl({ toolName, result, theme: _theme }: OfficeRenderersProps) {
  switch (toolName) {
    case 'create_pdf':
      return <PDFPreviewRenderer result={result} theme={_theme} />;
    case 'create_docx':
      return <DocxPreviewRenderer result={result} theme={_theme} />;
    case 'create_xlsx':
      return <XlsxPreviewRenderer result={result} theme={_theme} />;
    case 'read_document':
      return <DocumentContentRenderer result={result} theme={_theme} />;
    default:
      return <GenericToolResult result={result} toolName={toolName} />;
  }
}

export default memo(OfficeRenderersImpl);
