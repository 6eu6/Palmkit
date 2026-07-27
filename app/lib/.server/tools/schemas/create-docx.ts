/**
 * Create DOCX Schema
 * ------------------
 * Used by: create_docx tool (work mode only)
 *
 * Returns HTML formatted for Microsoft Word. Word can open HTML files
 * with .doc extension natively, so we don't need the heavy `docx` library.
 *
 * The HTML includes Word-specific XML namespaces and styles that make
 * the document look native when opened in Word.
 */
import { z } from 'zod';

export const createDocxSchema = z.object({
  title: z.string().min(1).max(200).describe('Document title. Appears as Heading 1 at the top.'),
  content: z
    .string()
    .min(1)
    .max(50000)
    .describe(
      'Document body in MARKDOWN format. Same syntax as create_pdf: ' +
        'headings, bold, italic, lists, links, code, tables, blockquotes.',
    ),
  author: z.string().optional().describe('Optional author name.'),
  headings: z
    .enum(['numbered', 'plain'])
    .optional()
    .describe('Heading style: "numbered" adds 1., 1.1, 1.1.1 numbering; "plain" leaves them as-is. Default: plain.'),
});

export type CreateDocxInput = z.infer<typeof createDocxSchema>;
