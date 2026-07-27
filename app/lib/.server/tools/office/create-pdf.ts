/**
 * create_pdf tool
 * ===============
 * Generate a print-ready HTML document from markdown content.
 *
 * Available in: work mode only
 *
 * The returned HTML uses @media print CSS to format as A4 pages with
 * proper margins. The frontend opens this HTML in a new window and
 * triggers window.print() — the user picks "Save as PDF" in the dialog.
 *
 * Why not generate the PDF binary directly?
 *   - jspdf (~350KB) and pdfkit (~500KB) would blow the CF Pages 3 MiB bundle.
 *   - The browser's print-to-PDF produces higher-quality output (real fonts,
 *     proper kerning, vector graphics) than client-side JS PDF libraries.
 *   - This approach is the same one Google Docs, Notion, and GitHub use
 *     for their "Export to PDF" features.
 *
 * The HTML is a complete standalone document (no external dependencies)
 * so it works in any browser without network access.
 */
import { createPdfSchema, type CreatePdfInput } from '~/lib/.server/tools/schemas/create-pdf';
import { markdownToHtml } from '~/lib/.server/tools/schemas/_markdown';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

export const createPdfTool: ToolDefinition<typeof createPdfSchema> = {
  name: 'create_pdf',
  description:
    'Generate a PDF-ready document from markdown content. ' +
    'CALL THIS TOOL IMMEDIATELY when the user says "PDF", "downloadable PDF", "save as PDF", or mentions .pdf extension. ' +
    'Do NOT write markdown first when the user explicitly asks for PDF — generate the PDF directly. ' +
    'When the user does NOT specify a format (e.g. "write a report"), respond in markdown and offer PDF as an option afterwards. ' +
    'Returns a complete HTML document with print-optimized CSS. ' +
    'Supports: headings, bold/italic, lists, tables, code blocks, links, images, blockquotes. ' +
    'Insert "---page-break---" in the content to force a new page. ' +
    'Do NOT use this for spreadsheets (use create_xlsx) or editable Word docs (use create_docx).',

  inputSchema: createPdfSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: CreatePdfInput): Promise<ToolResult> => {
    const { title, content, author, subject } = input;

    try {
      const bodyHtml = markdownToHtml(content, { enablePageBreaks: true });

      const authorLine = author ? `<div class="author">By ${escapeHtml(author)}</div>` : '';
      const subjectLine = subject ? `<div class="subject">${escapeHtml(subject)}</div>` : '';
      const dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  /* Page setup: A4, 1-inch margins */
  @page {
    size: A4;
    margin: 1in;
  }

  /* Screen preview uses a max-width container to mimic page proportions */
  @media screen {
    body {
      max-width: 800px;
      margin: 2rem auto;
      padding: 2rem;
      background: #f5f5f5;
    }
    .page {
      background: white;
      padding: 2rem 3rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
  }

  /* Print: clean, professional, no decorations */
  @media print {
    body { margin: 0; padding: 0; }
    .page { box-shadow: none; padding: 0; }
  }

  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-weight: 600;
    line-height: 1.3;
    page-break-after: avoid;
  }

  h1 { font-size: 22pt; margin: 0 0 0.5rem; }
  h2 { font-size: 16pt; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #ddd; padding-bottom: 0.3rem; }
  h3 { font-size: 13pt; margin: 1.2rem 0 0.4rem; }
  h4 { font-size: 11pt; margin: 1rem 0 0.3rem; }

  p { margin: 0 0 0.8rem; }

  /* Document header */
  .doc-header {
    text-align: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #1a1a1a;
  }
  .doc-header h1 { font-size: 24pt; margin: 0 0 0.5rem; }
  .author { font-size: 11pt; color: #555; margin-top: 0.3rem; font-style: italic; }
  .subject { font-size: 10pt; color: #777; margin-top: 0.2rem; }
  .date { font-size: 10pt; color: #777; margin-top: 0.5rem; }

  /* Lists */
  ul, ol { margin: 0 0 0.8rem; padding-left: 1.5rem; }
  li { margin-bottom: 0.3rem; }

  /* Code */
  code {
    font-family: 'Courier New', monospace;
    font-size: 9.5pt;
    background: #f4f4f4;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
  }
  pre {
    background: #f4f4f4;
    padding: 0.8rem;
    border-radius: 4px;
    overflow-x: auto;
    page-break-inside: avoid;
    border-left: 3px solid #1a1a1a;
  }
  pre code { background: none; padding: 0; }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8rem 0;
    page-break-inside: avoid;
    font-size: 10pt;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 0.4rem 0.6rem;
    text-align: left;
  }
  th {
    background: #f0f0f0;
    font-weight: 600;
  }
  tbody tr:nth-child(even) { background: #fafafa; }

  /* Blockquote */
  blockquote {
    margin: 0.8rem 0;
    padding: 0.5rem 1rem;
    border-left: 3px solid #1a1a1a;
    background: #f9f9f9;
    font-style: italic;
  }

  /* Horizontal rule = page break hint in print */
  hr {
    border: none;
    border-top: 1px solid #ddd;
    margin: 1.5rem 0;
  }

  /* Links */
  a { color: #0066cc; text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Images */
  img { max-width: 100%; height: auto; }

  /* Explicit page breaks */
  div[style*="page-break-after"] { page-break-after: always; height: 0; }
</style>
</head>
<body>
<div class="page">
  <div class="doc-header">
    <h1>${escapeHtml(title)}</h1>
    ${subjectLine}
    ${authorLine}
    <div class="date">${dateStr}</div>
  </div>
  ${bodyHtml}
</div>
</body>
</html>`;

      return {
        ok: true,
        title,
        format: 'html',
        content: html,
        contentLength: html.length,
        mimeType: 'text/html',
        filename: sanitizeFilename(title) + '.html',
        instructions:
          'Open the HTML in a new window, then call window.print() — ' +
          'the user picks "Save as PDF" in the browser print dialog.',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `PDF generation failed: ${message}`,
      };
    }
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'document'
  );
}
