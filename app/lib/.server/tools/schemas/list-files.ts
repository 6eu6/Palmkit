/**
 * List Files Schema
 * -----------------
 * Used by: list_files tool (code mode only)
 *
 * Lists all files in the project's file map (in-memory).
 * The LLM uses this to:
 *   - Understand the project structure
 *   - Find files to import from
 *   - Verify all expected files exist after a build
 *
 * Returns: totalFiles + array of {path, size, lines} sorted alphabetically.
 */
import { z } from 'zod';

export const listFilesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe(
      'Optional glob filter to limit results. Examples: "*.tsx", "src/**", "*.json". ' +
        'If omitted, all files are returned. Supports * and ? wildcards.',
    ),
});

export type ListFilesInput = z.infer<typeof listFilesSchema>;
