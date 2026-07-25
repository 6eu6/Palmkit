/**
 * run_shell tool
 * ==============
 * Run a shell command in the preview sandbox (E2B).
 *
 * Available in: code mode only (requires ToolContext.sandboxId)
 *
 * The LLM uses this to:
 *   - Run `npm install` to verify dependencies install correctly
 *   - Run `npm run build` to check for TypeScript/build errors
 *   - Run `curl localhost:5173` to verify the dev server responds
 *   - Run `ls`, `cat`, `grep` to inspect the sandbox filesystem
 *
 * REQUIRES a sandboxId. If no sandbox is available (fresh build, before
 * the user generates any files), returns a clean error.
 *
 * The tool calls POST /api/sb with op=run. The sandbox API enforces
 * auth, ownership, and rate limiting.
 *
 * Output is capped to keep the LLM context manageable:
 *   - stdout: 5000 chars (was unlimited in legacy — could OOM the LLM)
 *   - stderr: 3000 chars
 *
 * The LLM can use the `success` field (exitCode === 0) for quick decisions
 * without parsing stdout.
 */
import { runShellSchema, type RunShellInput } from '~/lib/.server/tools/schemas/run-shell';
import { callSandbox } from '~/lib/.server/tools/schemas/_sandbox';
import type { ToolDefinition, ToolContext, ToolResult } from '~/lib/.server/tools/types';

export const runShellTool: ToolDefinition<typeof runShellSchema> = {
  name: 'run_shell',
  description:
    'Run a shell command in the preview sandbox (E2B). ' +
    'Use this to verify your build: "npm install", "npm run build", "npm test", ' +
    '"curl -s http://localhost:5173", "ls -la src/", "cat package.json". ' +
    'Returns: exitCode (0 = success), stdout (capped 5000 chars), stderr (capped 3000 chars), success flag. ' +
    'REQUIRES an active sandbox — generate the project first if no sandbox exists. ' +
    'Avoid interactive commands (vim, top, less) — they will hang. ' +
    'For long-running commands use a longer timeoutMs (default 30s, max 120s).',

  inputSchema: runShellSchema,
  availableIn: ['code'],

  execute: async (input: RunShellInput, ctx: ToolContext): Promise<ToolResult> => {
    const { command, timeoutMs = 30000 } = input;

    const result = await callSandbox(ctx.sandboxId ?? '', 'run', { command, timeoutMs }, timeoutMs);

    if (!result.ok) {
      return result;
    }

    const data = result.data as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };

    const exitCode = data.exitCode ?? -1;
    const stdout = (data.stdout ?? '').substring(0, 5000);
    const stderr = (data.stderr ?? '').substring(0, 3000);

    return {
      ok: true,
      command,
      exitCode,
      stdout,
      stderr,
      success: exitCode === 0,
      ...(stdout.length < (data.stdout?.length ?? 0)
        ? { stdoutTruncated: true, stdoutOriginalLength: data.stdout?.length }
        : {}),
      ...(stderr.length < (data.stderr?.length ?? 0)
        ? { stderrTruncated: true, stderrOriginalLength: data.stderr?.length }
        : {}),
    };
  },
};
