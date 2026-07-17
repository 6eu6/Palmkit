/**
 * Phase 4 — Build Checker
 *
 * Writes generated files to a temp directory and runs the stack-specific
 * install + build commands directly on the Oracle ARM64 server (free, no E2B).
 *
 * Now uses StackRegistry for multi-stack support (react, vue, nextjs, python,
 * flutter, etc.) instead of hardcoding npm for everything.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { FileOperation } from './project-spec';
import { getStack, type StackId } from './stack-registry';
import { logger } from './logger';

const INSTALL_TIMEOUT_MS = 120_000;
const BUILD_TIMEOUT_MS = 90_000;
const MAX_ERROR_CHARS = 4000;

export interface BuildCheckResult {
  success: boolean;
  errors: string;
}

/**
 * App types that support build verification on the Oracle worker.
 * Now reads from StackRegistry — any stack with a non-empty `verify` command.
 */
export const BUILD_CHECK_TYPES = new Set<string>(
  Object.values(getStack as unknown as Record<string, unknown>)
    .filter((s): s is { verify: string; appType: string } => typeof s === 'object' && s !== null && 'verify' in s)
    .filter((s) => s.verify.length > 0)
    .map((s) => s.appType),
);

// Simpler: hardcode the set from the registry (avoids runtime introspection)
const SUPPORTED_APP_TYPES = new Set(['react', 'vue', 'nextjs', 'python', 'flutter', 'node-express']);

/**
 * Write files to a temp dir, run the stack's install + build commands, clean up.
 * Returns { success, errors } — errors is the truncated stderr/stdout on failure.
 *
 * Now stack-aware: Python uses pip, Flutter uses flutter, JS uses npm.
 */
export async function checkBuild(files: FileOperation[], appType: string): Promise<BuildCheckResult> {
  const stack = getStack(appType);

  // Skip verification if the stack has no verify command
  if (!stack.verify || stack.verify.length === 0) {
    logger.info(`[build-check] ${appType}: skipped (no verify command for stack '${stack.id}')`);
    return { success: true, errors: '' };
  }

  const dir = join(tmpdir(), `palmkit-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await mkdir(dir, { recursive: true });

    for (const file of files) {
      const dest = join(dir, file.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.content, 'utf8');
    }

    // Install dependencies (stack-specific)
    if (stack.install && stack.install.length > 0) {
      logger.info(`[build-check] ${stack.id}: install (${stack.install}) in ${dir}`);
      const installCmds = stack.install.split(' ');
      const install = await runWithTimeout(installCmds, dir, INSTALL_TIMEOUT_MS);

      if (!install.success) {
        return {
          success: false,
          errors: truncate(`${stack.install} failed:\n${install.stderr || install.stdout}`, MAX_ERROR_CHARS),
        };
      }
    }

    // Build / verify (stack-specific)
    if (stack.verify && stack.verify.length > 0) {
      logger.info(`[build-check] ${stack.id}: verify (${stack.verify})`);
      const verifyCmds = stack.verify.split(' ');
      const build = await runWithTimeout(verifyCmds, dir, BUILD_TIMEOUT_MS);

      if (!build.success) {
        return {
          success: false,
          errors: truncate(`${stack.verify} failed:\n${build.stderr || ''}\n${build.stdout || ''}`, MAX_ERROR_CHARS),
        };
      }
    }

    logger.info(`[build-check] ${stack.id}: SUCCESS`);
    return { success: true, errors: '' };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runWithTimeout(
  cmd: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn({ cmd, cwd, stdout: 'pipe', stderr: 'pipe' });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timer);

  if (timedOut) {
    return { success: false, stdout: '', stderr: `Process timed out after ${timeoutMs / 1000}s` };
  }

  return { success: code === 0, stdout, stderr };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n…(truncated)';
}
