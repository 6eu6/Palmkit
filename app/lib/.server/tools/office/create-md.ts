/**
 * create_md tool
 * ==============
 * Generate a downloadable Markdown (.md) file from content.
 *
 * Available in: all modes (chat, work, code)
 *
 * The tool returns the raw markdown content with a .md filename.
 * The frontend renders a preview (rendered markdown) + download button.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolResult } from '~/lib/.server/tools/types';

const createMdSchema = z.object({
  filename: z
    .string()
    .min(1)
    .describe('The filename for the markdown file, e.g. "report.md" or "README.md". Must end with .md'),
  content: z
    .string()
    .min(1)
    .describe(
      'The full markdown content of the file. Supports all standard markdown: headings, bold, italic, lists, tables, code blocks, blockquotes, links, images.',
    ),
});

type CreateMdInput = z.infer<typeof createMdSchema>;

export const createMdTool: ToolDefinition<typeof createMdSchema> = {
  name: 'create_md',
  description:
    'Generate a downloadable Markdown (.md) file. ' +
    'Use this when the user asks for a .md file, markdown document, README, notes file, or any text document in markdown format. ' +
    'Returns the raw markdown content with a download button and live preview. ' +
    'Supports: headings, bold/italic, lists, tables, code blocks, blockquotes, links, images, horizontal rules. ' +
    'Do NOT use this for PDFs (use create_pdf) or Word docs (use create_docx) or spreadsheets (use create_xlsx).',

  inputSchema: createMdSchema,
  availableIn: ['chat', 'work', 'code'],

  execute: async (input: CreateMdInput): Promise<ToolResult> => {
    const { filename, content } = input;

    // Ensure filename ends with .md
    const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`;

    return {
      ok: true,
      title: finalFilename.replace(/\.md$/, ''),
      format: 'markdown',
      content,
      contentLength: content.length,
      mimeType: 'text/markdown',
      filename: finalFilename,
    };
  },
};
