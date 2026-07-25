/**
 * Grep Schema
 * -----------
 * Used by: grep tool (code mode only)
 *
 * Searches for a text/regex pattern across all project files.
 * Faster than reading each file individually when looking for:
 *   - "Where is this function defined?"
 *   - "Which files import X?"
 *   - "Find all TODO comments"
 *
 * The pattern is treated as a regex (case-insensitive). If it's invalid
 * regex, we escape special characters and retry as a literal match.
 *
 * Returns: matches with {file, line, text}, capped at 50 results.
 */
import { z } from 'zod';

export const grepSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'The text or regex pattern to search for. Case-insensitive. ' +
        'Examples: "function App", "import.*Button", "TODO\\("',
    ),
  fileGlob: z
    .string()
    .optional()
    .describe(
      'File pattern to limit search. Examples: "*.tsx", "src/**", "*.json". ' +
        'If omitted, searches all files. Supports * and ? wildcards.',
    ),
  caseSensitive: z
    .boolean()
    .optional()
    .describe('If true, perform case-sensitive search. Default: false (case-insensitive).'),
  maxResults: z.number().int().min(1).max(200).optional().describe('Maximum matches to return (default 50, max 200).'),
});

export type GrepInput = z.infer<typeof grepSchema>;
