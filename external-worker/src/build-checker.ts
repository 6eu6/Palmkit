/**
 * Phase 4 — Build Checker
 *
 * Writes generated files to a temp directory and runs `bun install + bun run build`
 * directly on the Oracle ARM64 server (free, no E2B needed).
 *
 * Supported app types: react, vue, nextjs
 * python / flutter / react-native are skipped (different runtimes).
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { FileOperation } from './generator';
import { logger } from './logger';

const INSTALL_TIMEOUT_MS = 120_000;
const BUILD_TIMEOUT_MS = 90_000;
const MAX_ERROR_CHARS = 4000;

export interface BuildCheckResult {
  success: boolean;
  errors: string;
}

/** App types that support `npm run build` verification. */
export const BUILD_CHECK_TYPES = new Set<string>(['react', 'vue', 'nextjs']);

/**
 * Write files to a temp dir, run bun install + bun run build, clean up.
 * Returns { success, errors } — errors is the truncated stderr/stdout on failure.
 */
export async function checkBuild(files: FileOperation[], appType: string): Promise<BuildCheckResult> {
  const dir = join(tmpdir(), `palmkit-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await mkdir(dir, { recursive: true });

    for (const file of files) {
      const dest = join(dir, file.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.content, 'utf8');
    }

    logger.info(`[build-check] ${appType}: install in ${dir}`);
    const install = await runWithTimeout(['bun', 'install', '--no-save'], dir, INSTALL_TIMEOUT_MS);

    if (!install.success) {
      return {
        success: false,
        errors: truncate(`bun install failed:\n${install.stderr || install.stdout}`, MAX_ERROR_CHARS),
      };
    }

    logger.info(`[build-check] ${appType}: build`);
    const build = await runWithTimeout(['bun', 'run', 'build'], dir, BUILD_TIMEOUT_MS);

    if (!build.success) {
      return {
        success: false,
        errors: truncate(`bun run build failed:\n${build.stderr || ''}\n${build.stdout || ''}`, MAX_ERROR_CHARS),
      };
    }

    logger.info(`[build-check] ${appType}: SUCCESS`);
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
