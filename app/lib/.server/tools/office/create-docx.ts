/**
 * create_docx tool
 * ================
 * Generate a Word-compatible HTML document from markdown content.
 *
 * Available in: work mode only
 *
 * Microsoft Word can open HTML files with .doc extension natively. We
 * include Word-specific XML namespaces (xmlns:o, xmlns:w, etc.) and
 * Microsoft Office styles so the document looks native when opened
 * in Word — headings appear in the Navigation pane, lists are real
 * Word lists, etc.
 *
 * This avoids the heavy `docx` npm library (~500KB) which would
 * blow the CF Pages bundle limit. The result is editable in Word,
 * Google Docs, or LibreOffice.
 *
 * Why not generate a real .docx (OOXML ZIP)?
 *   - The `docx` library is 500KB+ minified.
 *   - Generating OOXML manually requires a ZIP implementation
 *     (another 200KB+ for jszip).
 *   - HTML-with-.doc-extension has been supported by Word since 1997
 *     and produces editable documents with full formatting.
 */
import { createDocxSchema, type CreateDocxInput } from '~/lib/.server/tools/schemas/create-docx';
import { markdownToHtml } from '~/lib/.server/tools/schemas/_markdown';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

export const createDocxTool: ToolDefinition<typeof createDocxSchema> = {
  name: 'create_docx',
  description:
    'Generate an editable Microsoft Word document from markdown content. ' +
    'CALL THIS TOOL IMMEDIATELY when the user says "Word", ".docx", "Word document", or "editable document". ' +
    'Do NOT write markdown first when the user explicitly asks for Word — generate the .docx directly. ' +
    'When the user does NOT specify a format, respond in markdown and offer Word as an option afterwards. ' +
    'Returns HTML formatted for Word with proper styles — opens natively in ' +
    'Microsoft Word, Google Docs, or LibreOffice. ' +
    'Supports: headings (with optional numbering), bold, italic, lists, tables, ' +
    'code blocks, links, images, and blockquotes. ' +
    'Do NOT use this for spreadsheets (use create_xlsx) or print-ready PDFs (use create_pdf).',

  inputSchema: createDocxSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: CreateDocxInput): Promise<ToolResult> => {
    const { title, content, author, headings = 'plain' } = input;

    try {
      const bodyHtml = markdownToHtml(content, {
        enablePageBreaks: false,
        numberedHeadings: headings === 'numbered',
      });

      const authorMeta = author ? `<meta name="Author" content="${escapeAttr(author)}">` : '';

      /*
       * Word-compatible HTML uses Microsoft Office namespaces so Word
       * recognizes the document as native rather than generic HTML.
       */
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<meta name="ProgId" content="Word.Document">
<meta name="Generator" content="PalmKit">
<meta name="Originator" content="PalmKit">
${authorMeta}
<title>${escapeAttr(title)}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
@page WordSection1 {
  size: 8.5in 11.0in;
  margin: 1in 1in 1in 1in;
}
div.WordSection1 { page: WordSection1; }

body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; }

h1, h2, h3, h4, h5, h6 {
  font-family: 'Calibri', Arial, sans-serif;
  font-weight: bold;
  color: #1a1a1a;
  margin-top: 12pt;
  margin-bottom: 6pt;
}
h1 { font-size: 18pt; color: #2c3e50; }
h2 { font-size: 14pt; color: #34495e; }
h3 { font-size: 12pt; color: #34495e; }
h4 { font-size: 11pt; }

p { margin: 0 0 8pt; }

ul, ol { margin: 0 0 8pt; padding-left: 0.5in; }
li { margin-bottom: 4pt; }

table {
  border-collapse: collapse;
  width: 100%;
  margin: 8pt 0;
  font-size: 10pt;
}
th, td {
  border: 1pt solid #999;
  padding: 4pt 6pt;
}
th { background: #e8e8e8; font-weight: bold; }

pre {
  background: #f4f4f4;
  padding: 8pt;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 9pt;
  border-left: 3pt solid #1a1a1a;
}
code {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 10pt;
  background: #f4f4f4;
  padding: 1pt 3pt;
}

blockquote {
  margin: 8pt 0;
  padding: 4pt 12pt;
  border-left: 3pt solid #1a1a1a;
  background: #f9f9f9;
  font-style: italic;
}

a { color: #0066cc; }

/* Title styling for the first H1 */
h1:first-child { text-align: center; font-size: 22pt; margin-top: 0; }
</style>
</head>
<body>
<div class="WordSection1">
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
        mimeType: 'application/msword',
        filename: sanitizeFilename(title) + '.doc',
        instructions:
          'Save the HTML content as a .doc file. Opens natively in Microsoft Word, ' +
          'Google Docs, or LibreOffice Writer.',
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `DOCX generation failed: ${message}`,
      };
    }
  },
};

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
