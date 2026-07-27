/**
 * Read Document Schema
 * --------------------
 * Used by: read_document tool (work mode only)
 *
 * Accepts a base64-encoded file (PDF, DOCX, or plain text) and returns
 * the extracted text content.
 *
 * Implementation notes:
 *   - Plain text (.txt, .md, .csv, .json): decoded directly — no parsing.
 *   - DOCX (.docx): parsed via a minimal XML extractor (no mammoth dep).
 *     DOCX is a ZIP file; we extract word/document.xml and strip tags.
 *   - PDF (.pdf): full text extraction requires pdfjs-dist or pdf-parse
 *     (both heavy). For Phase 2, we return a clean error suggesting the
 *     user paste text directly. Phase 3 will route PDF through Oracle.
 *
 * This is honest about limitations — better than returning garbage.
 */
import { z } from 'zod';

export const readDocumentSchema = z.object({
  filename: z
    .string()
    .min(1)
    .describe('Original filename. Used to detect type via extension (e.g. "report.pdf", "notes.docx").'),
  mimeType: z
    .string()
    .optional()
    .describe('Optional MIME type (e.g. "application/pdf"). Falls back to extension detection.'),
  contentBase64: z
    .string()
    .min(1)
    .max(5_000_000)
    .describe(
      'File content encoded as base64. Max ~3.5MB after decoding. ' +
        'Larger files should be uploaded to R2 and referenced by URL.',
    ),
  maxLength: z
    .number()
    .int()
    .min(1000)
    .max(50000)
    .optional()
    .describe('Maximum characters of extracted text to return (default 20000).'),
});

export type ReadDocumentInput = z.infer<typeof readDocumentSchema>;
