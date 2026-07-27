/**
 * grep tool
 * =========
 * Search for a text/regex pattern across all project files.
 *
 * Available in: code mode only (requires ToolContext.files)
 *
 * The LLM uses this to:
 *   - "Where is this function defined?"
 *   - "Which files import X?"
 *   - "Find all TODO comments"
 *
 * Improvements over the legacy grep:
 *   - caseSensitive option (legacy was always case-insensitive)
 *   - maxResults option (legacy was hardcoded 50)
 *   - Returns truncated flag (legacy returned truncated but no count info)
 *   - Better glob support (uses the same glob converter as list_files)
 *   - Skips binary-looking files (large files with > 30% non-printable chars)
 *
 * The pattern is treated as a regex. If it's invalid regex, we escape
 * special characters and retry as a literal match. This prevents the
 * tool from crashing on patterns like "function(" (unbalanced paren).
 *
 * Results are capped at maxResults (default 50). Each result includes:
 *   - file: path to the file
 *   - line: 1-indexed line number
 *   - text: the matching line (trimmed, capped at 200 chars)
 */
import { grepSchema, type GrepInput } from '~/lib/.server/tools/schemas/grep';
import type { ToolDefinition, ToolContext, ToolResult } from '~/lib/.server/tools/types';

export const grepTool: ToolDefinition<typeof grepSchema> = {
  name: 'grep',
  description:
    'Search for a text or regex pattern across all project files. ' +
    'Use this to find: where a function is defined, which files import something, ' +
    'all TODO comments, all uses of a specific API. ' +
    'Returns: matching lines with file path + line number, capped at maxResults (default 50). ' +
    'The pattern is treated as case-insensitive regex by default. ' +
    'Optional fileGlob limits search to specific files (e.g. "*.tsx", "src/**"). ' +
    'Faster than reading each file individually with read_file. ' +
    'Do NOT use this for sandbox files (use run_shell with the grep command).',

  inputSchema: grepSchema,
  availableIn: ['code'],

  execute: async (input: GrepInput, ctx: ToolContext): Promise<ToolResult> => {
    const { pattern, fileGlob, caseSensitive = false, maxResults = 50 } = input;
    const files = ctx.files;

    if (!files) {
      return {
        ok: false,
        error: 'No project files available in this context.',
        hint: 'This is a fresh build with no files yet. Generate the project first.',
      };
    }

    // Build the regex
    let regex: RegExp;

    try {
      regex = new RegExp(pattern, caseSensitive ? '' : 'i');
    } catch {
      // Invalid regex — escape special characters and retry as literal
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      try {
        regex = new RegExp(escaped, caseSensitive ? '' : 'i');
      } catch {
        return {
          ok: false,
          error: `Could not construct a valid regex from pattern: ${pattern}`,
        };
      }
    }

    // Build glob filter
    let globFilter: RegExp | null = null;

    if (fileGlob) {
      try {
        // Same glob conversion as list_files: * matches anything (including /)
        let globPattern = fileGlob
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '\u0000')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
          .replace(/\u0000/g, '.*');
        globPattern = `^${globPattern}.*$`;
        globFilter = new RegExp(globPattern);
      } catch {
        globFilter = null;
      }
    }

    // Search each file
    const results: Array<{ file: string; line: number; text: string }> = [];
    const filesSearched: string[] = [];
    let truncated = false;

    for (const [path, entry] of Object.entries(files)) {
      // Skip non-file entries
      if (!entry || entry.type !== 'file' || typeof entry.content !== 'string') {
        continue;
      }

      // Apply glob filter
      if (globFilter && !globFilter.test(path)) {
        continue;
      }

      // Skip binary-looking files (heuristic: > 30% non-printable chars in first 1000)
      if (looksBinary(entry.content)) {
        continue;
      }

      filesSearched.push(path);

      const lines = entry.content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: path,
            line: i + 1,
            text: lines[i].trim().substring(0, 200),
          });

          if (results.length >= maxResults) {
            truncated = true;
            break;
          }
        }
      }

      if (truncated) {
        break;
      }
    }

    return {
      ok: true,
      pattern,
      caseSensitive,
      fileGlob: fileGlob ?? null,
      totalMatches: results.length,
      filesSearched: filesSearched.length,
      truncated,
      results,
    };
  },
};

/**
 * Heuristic: detect binary files by checking for high proportion of
 * non-printable characters in the first 1000 chars.
 *
 * This skips node_modules binaries, images encoded as text, etc.
 * A file with all printable ASCII or UTF-8 returns false.
 */
function looksBinary(content: string): boolean {
  if (content.length === 0) {
    return false;
  }

  const sample = content.slice(0, 1000);
  let nonPrintable = 0;

  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);

    // Allow: tab (9), newline (10), carriage return (13), printable ASCII (32-126), UTF-8 high (128+)
    if (code !== 9 && code !== 10 && code !== 13 && (code < 32 || code > 126) && code < 128) {
      nonPrintable++;
    }
  }

  return nonPrintable / sample.length > 0.3;
}
