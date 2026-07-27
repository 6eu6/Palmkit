/**
 * list_files tool
 * ===============
 * List all files in the project's in-memory file map.
 *
 * Available in: code mode only (requires ToolContext.files)
 *
 * The LLM uses this to:
 *   - Understand the project structure
 *   - Find files to import from
 *   - Verify all expected files exist after a build
 *
 * Returns: totalFiles + array of {path, size, lines} sorted alphabetically.
 *
 * Optional filter parameter supports simple glob patterns:
 *   - "*.tsx" matches any .tsx file in the root
 *   - "src/**" matches everything under src/ (we convert ** to .*)
 *   - "*.json" matches JSON files anywhere
 *
 * The glob conversion is simple (not full micromatch) — sufficient for
 * the LLM's filtering needs without adding a 50KB glob library.
 */
import { listFilesSchema, type ListFilesInput } from '~/lib/.server/tools/schemas/list-files';
import type { ToolDefinition, ToolContext, ToolResult } from '~/lib/.server/tools/types';

export const listFilesTool: ToolDefinition<typeof listFilesSchema> = {
  name: 'list_files',
  description:
    'List all files in the current project (in-memory file map, no sandbox needed). ' +
    'Use this to: understand the project structure, find files to import from, ' +
    'verify all expected files exist after a build. ' +
    'Returns: totalFiles + array of {path, size, lines} sorted alphabetically. ' +
    'Optional filter parameter supports globs like "*.tsx", "src/**", "*.json". ' +
    'Do NOT use this for sandbox files (use read_sandbox_file with path "/").',

  inputSchema: listFilesSchema,
  availableIn: ['code'],

  execute: async (input: ListFilesInput, ctx: ToolContext): Promise<ToolResult> => {
    const files = ctx.files;

    if (!files) {
      return {
        ok: false,
        error: 'No project files available in this context.',
        hint: 'This is a fresh build with no files yet. Generate the project first.',
      };
    }

    // Build glob filter regex if filter is provided
    let globFilter: RegExp | null = null;

    if (input.filter) {
      try {
        /*
         * Convert glob to regex:
         *   ** → matches anything (including /)
         *   *  → matches anything including / (so "*.tsx" matches "src/App.tsx")
         *   ?  → matches single char (including /)
         *   .  → literal dot
         *
         * Note: this is intentionally simpler than micromatch. The common
         * use cases are:
         *   "*.tsx"     → any .tsx file anywhere
         *   "src/**"    → everything under src/
         *   "*.json"    → any .json file anywhere
         *   "package.*" → package.json, package-lock.json, etc.
         *
         * We treat all * as "match anything" (not just non-slash), which
         * matches user expectations better than strict glob semantics.
         */
        let pattern = input.filter
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '\u0000') // placeholder for ** (kept for compatibility)
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
          .replace(/\u0000/g, '.*');

        /*
         * If pattern doesn't end with $, allow matching prefix
         * (so "src/**" matches "src/App.tsx")
         */
        if (!pattern.endsWith('$')) {
          pattern = `^${pattern}.*$`;
        } else {
          pattern = `^${pattern}`;
        }

        globFilter = new RegExp(pattern);
      } catch {
        // If regex construction fails, ignore the filter
        globFilter = null;
      }
    }

    // Collect all file entries
    const fileList: Array<{ path: string; size: number; lines: number }> = [];

    for (const [path, entry] of Object.entries(files)) {
      // Skip undefined, folders, and non-file entries
      if (!entry || entry.type !== 'file' || typeof entry.content !== 'string') {
        continue;
      }

      if (globFilter && !globFilter.test(path)) {
        continue;
      }

      fileList.push({
        path,
        size: entry.content.length,
        lines: entry.content.split('\n').length,
      });
    }

    // Sort alphabetically by path
    fileList.sort((a, b) => a.path.localeCompare(b.path));

    // Compute summary stats
    const totalSize = fileList.reduce((sum, f) => sum + f.size, 0);
    const totalLines = fileList.reduce((sum, f) => sum + f.lines, 0);

    // Group by extension for quick overview
    const byExtension: Record<string, number> = {};

    for (const f of fileList) {
      const ext = f.path.match(/\.([a-z0-9]+)$/i)?.[1] ?? '(no ext)';
      byExtension[ext] = (byExtension[ext] ?? 0) + 1;
    }

    return {
      ok: true,
      totalFiles: fileList.length,
      totalSize,
      totalLines,
      ...(Object.keys(byExtension).length > 0 ? { byExtension } : {}),
      files: fileList,
    };
  },
};
