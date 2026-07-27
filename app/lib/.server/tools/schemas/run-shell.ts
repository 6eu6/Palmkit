/**
 * Run Shell Schema
 * ----------------
 * Used by: run_shell tool (code mode only, requires active sandbox)
 *
 * Run a shell command in the preview sandbox (E2B). The LLM uses this to:
 *   - Run `npm install` to verify dependencies install correctly
 *   - Run `npm run build` to check for TypeScript/build errors
 *   - Run `curl localhost:5173` to verify the dev server responds
 *   - Run `ls`, `cat`, `grep` to inspect the filesystem
 *
 * REQUIRES a sandboxId (injected via ToolContext.sandboxId when a sandbox
 * is active). If no sandbox is available, returns a clean error suggesting
 * the LLM generate the project first.
 *
 * The tool calls POST /api/sb with op=run. The sandbox API enforces:
 *   - User owns the sandbox (auth + ownership check)
 *   - Rate limiting (max 3 concurrent sandboxes per user)
 *   - Audit logging
 */
import { z } from 'zod';

export const runShellSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      'The shell command to run in the sandbox. Examples: "npm install", ' +
        '"npm run build", "ls -la src/", "curl -s http://localhost:5173 | head -20". ' +
        'Avoid interactive commands (vim, top) — they will hang.',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(120000)
    .optional()
    .describe(
      'Command timeout in ms. Default 30000 (30s). Max 120000 (2 min). ' +
        'Long-running commands (npm install) may need 60000-120000.',
    ),
});

export type RunShellInput = z.infer<typeof runShellSchema>;
