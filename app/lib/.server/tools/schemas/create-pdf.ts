/**
 * Create PDF Schema
 * -----------------
 * Used by: create_pdf tool (work mode only)
 *
 * Returns HTML that the client opens in a new window for print-to-PDF.
 * This avoids heavy PDF libraries (jspdf, pdfkit) that would blow past
 * the 3 MiB Cloudflare Pages bundle limit.
 *
 * The HTML is print-optimized: A4 page size, margins, page breaks.
 */
import { z } from 'zod';

export const createPdfSchema = z.object({
  title: z.string().min(1).max(200).describe('Document title. Appears as <h1> at the top of the first page.'),
  content: z
    .string()
    .min(1)
    .max(50000)
    .describe(
      'Document body in MARKDOWN format. Supports headings (#, ##, ###), ' +
        'bold (**text**), italic (*text*), lists (- item), links ([text](url)), ' +
        'code (`code`), tables (| col1 | col2 |), and blockquotes (> quote). ' +
        'Page breaks can be inserted with "---page-break---".',
    ),
  author: z.string().optional().describe('Optional author name. Appears in the document header.'),
  subject: z.string().optional().describe('Optional subject line. Appears under the title.'),
});

export type CreatePdfInput = z.infer<typeof createPdfSchema>;
