/**
 * Read Sandbox File Schema
 * ------------------------
 * Used by: read_sandbox_file tool (code mode only, requires active sandbox)
 *
 * Read a file from the sandbox filesystem (post-build verification).
 *
 * Difference from read_file:
 *   - read_file reads from the project's in-memory file map (what the LLM generated)
 *   - read_sandbox_file reads from the ACTUAL file in the sandbox
 *     (what was actually written after npm install, build steps, etc.)
 *
 * Use cases:
 *   - Verify a file was written correctly after `npm install`
 *   - Read build output (dist/, build/) that doesn't exist in the file map
 *   - Inspect node_modules to verify a package installed
 *   - Read logs or generated files
 *
 * REQUIRES a sandboxId. Returns the file content (capped at 8000 chars
 * to fit in the LLM's context window).
 */
import { z } from 'zod';

export const readSandboxFileSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'Absolute or project-relative path. Examples: "package.json", ' +
        '"dist/index.html", "/home/user/project/src/App.tsx", "node_modules/react/package.json".',
    ),
  maxLength: z
    .number()
    .int()
    .min(1000)
    .max(50000)
    .optional()
    .describe('Maximum characters to return (default 8000, max 50000).'),
});

export type ReadSandboxFileInput = z.infer<typeof readSandboxFileSchema>;
