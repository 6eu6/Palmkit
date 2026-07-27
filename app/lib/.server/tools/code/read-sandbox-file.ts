/**
 * read_sandbox_file tool
 * ======================
 * Read a file from the sandbox filesystem (post-build verification).
 *
 * Available in: code mode only (requires ToolContext.sandboxId)
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
 * REQUIRES a sandboxId. Returns the file content (capped at maxLength
 * chars to fit in the LLM's context window).
 *
 * If the file doesn't exist in the sandbox, returns a clean error.
 */
import { readSandboxFileSchema, type ReadSandboxFileInput } from '~/lib/.server/tools/schemas/read-sandbox-file';
import { callSandbox } from '~/lib/.server/tools/schemas/_sandbox';
import type { ToolDefinition, ToolContext, ToolResult } from '~/lib/.server/tools/types';

export const readSandboxFileTool: ToolDefinition<typeof readSandboxFileSchema> = {
  name: 'read_sandbox_file',
  description:
    'Read a file from the sandbox filesystem (the ACTUAL file, post-build). ' +
    'Use this to: verify a file was written correctly after `npm install` or `npm run build`, ' +
    'read build output (dist/, build/) that does not exist in the in-memory file map, ' +
    'inspect node_modules to verify a package installed, read logs or generated files. ' +
    'Returns: file content as text (capped at maxLength, default 8000 chars). ' +
    'REQUIRES an active sandbox. ' +
    'Difference from read_file: read_file reads the in-memory file map (what you generated), ' +
    'this reads the actual sandbox file (what was written to disk).',

  inputSchema: readSandboxFileSchema,
  availableIn: ['code'],

  execute: async (input: ReadSandboxFileInput, ctx: ToolContext): Promise<ToolResult> => {
    const { path, maxLength = 8000 } = input;

    const result = await callSandbox(ctx.sandboxId ?? '', 'read', { path }, 15000);

    if (!result.ok) {
      return result;
    }

    const data = result.data as {
      path?: string;
      content?: string;
      size?: number;
    };

    const content = data.content ?? '';
    const size = data.size ?? content.length;
    const truncated = content.length > maxLength;
    const finalContent = truncated ? content.slice(0, maxLength) + '\n\n[... truncated]' : content;

    return {
      ok: true,
      path: data.path ?? path,
      content: finalContent,
      size,
      truncated,
      originalLength: content.length,
    };
  },
};
