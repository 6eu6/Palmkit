/**
 * read_file tool
 * ==============
 * Read a file from the project's in-memory file map.
 *
 * Available in: code mode only (requires ToolContext.files)
 *
 * The file map (FileMap) is set by api.chat.ts when there are existing
 * project files. In a fresh build, files is undefined — the tool returns
 * a clear error explaining the LLM should generate the project first.
 *
 * FileMap = Record<string, Dirent | undefined> where Dirent = File | Folder.
 * Only File entries have .content (string). Folder entries have .type='folder'.
 *
 * Path normalization: leading "./" or "/" are stripped so both
 * "src/App.tsx" and "./src/App.tsx" resolve to the same file.
 *
 * On success: returns {path, content, size, lines}.
 * On failure: returns available files (first 20, sorted) to help the LLM
 * pick a valid path on retry.
 */
import { readFileSchema, type ReadFileInput } from '~/lib/.server/tools/schemas/read-file';
import type { ToolDefinition, ToolContext, ToolResult } from '~/lib/.server/tools/types';

export const readFileTool: ToolDefinition<typeof readFileSchema> = {
  name: 'read_file',
  description:
    'Read a file from the current project (in-memory file map, no sandbox needed). ' +
    'Use this to: verify a file you just wrote exists and has the right content, ' +
    'read an existing file before modifying it, check imports/exports between files. ' +
    'Returns: file content as text, plus size in bytes and line count. ' +
    'If the file is not found, returns the first 20 available file paths to help you retry. ' +
    'Do NOT use this for sandbox files (use read_sandbox_file) or URLs (use read_url).',

  inputSchema: readFileSchema,
  availableIn: ['code'],

  execute: async (input: ReadFileInput, ctx: ToolContext): Promise<ToolResult> => {
    const files = ctx.files;

    if (!files) {
      return {
        ok: false,
        error: 'No project files available in this context.',
        hint: 'This is a fresh build with no files yet. Generate the project first using <palmkitArtifact> tags.',
      };
    }

    // Normalize path: strip leading "./" or "/"
    const normalizedPath = input.path.replace(/^\.?\//, '');

    // Look up the file (try both normalized and original)
    const entry = files[normalizedPath] ?? files[`./${normalizedPath}`] ?? files[input.path];

    if (!entry) {
      // File not found — return available files to help the LLM retry
      const availableFiles = Object.keys(files)
        .filter((k) => files[k]?.type === 'file')
        .sort()
        .slice(0, 20);

      return {
        ok: false,
        error: `File not found: ${input.path}. Try one of these available files: ${availableFiles.join(', ')}`,
        hint: 'Use list_files to see the full project structure.',
      };
    }

    // Skip folders and non-file entries
    if (entry.type !== 'file' || typeof entry.content !== 'string') {
      return {
        ok: false,
        error: `${input.path} is not a file (type: ${entry.type ?? 'unknown'}).`,
        hint: 'Use list_files to see what files are available.',
      };
    }

    return {
      ok: true,
      path: normalizedPath,
      content: entry.content,
      size: entry.content.length,
      lines: entry.content.split('\n').length,
    };
  },
};
