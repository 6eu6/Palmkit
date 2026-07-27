/**
 * Read File Schema
 * ----------------
 * Used by: read_file tool (code mode only)
 *
 * Reads a file from the project's file map (in-memory, no sandbox).
 * The LLM uses this to:
 *   - Verify a file it just wrote exists and has the right content
 *   - Read an existing file before modifying it
 *   - Check imports/exports between files
 *
 * The file map (FileMap) is injected via ToolContext.files. If the
 * context has no files (e.g. fresh build), the tool returns a clean
 * error with a list of available files (empty in fresh build).
 */
import { z } from 'zod';

export const readFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'The file path relative to the project root. Examples: "src/App.tsx", ' +
        '"package.json", "components/Button.tsx". Leading "./" or "/" are stripped.',
    ),
});

export type ReadFileInput = z.infer<typeof readFileSchema>;
