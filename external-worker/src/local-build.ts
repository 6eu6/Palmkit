/**
 * Local Build Runner — builds projects on the Oracle ARM64 server instead of E2B.
 *
 * WHY: E2B sandbox has only ~478MB RAM (no swap). Complex React projects with
 * many dependencies (recharts, dnd, UI libs) need 600-800MB for npm install,
 * which causes OOM kills → no node_modules → no build → white screen.
 *
 * Oracle has 5.5GB RAM + 4GB swap — 10x the capacity. Running bun install +
 * bun run build here succeeds where E2B fails.
 *
 * NOTE: Oracle only has Bun (no npm/node). We use bun install + bun run build.
 * Bun is 3-5x faster than npm and uses less memory.
 *
 * FLOW:
 *   1. Project files already exist on disk at ~/palmkit-projects/{projectId}/
 *   2. Patch vite.config to set base path for preview serving
 *   3. Run stack-specific install + build commands using Bun
 *   4. Read the dist/ directory output
 *   5. Rewrite HTML asset paths from /assets/ to relative ./assets/
 *   6. Upload each dist file to R2 at projects/{projectId}/dist/{path}
 *   7. Copy dist to /var/www/preview-dist/{projectId}/ for nginx
 *   8. Return the dist file list + success status
 */

import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { putFile } from './r2-client';
import { getStack } from './stack-registry';
import { logger } from './logger';

const PROJECTS_ROOT = process.env.PALMKIT_PROJECTS_ROOT || `${process.env.HOME || '/home/opc'}/palmkit-projects`;

const INSTALL_TIMEOUT_MS = 180_000;  // 3 min
const BUILD_TIMEOUT_MS = 120_000;    // 2 min
const MAX_ERROR_CHARS = 4000;

export interface LocalBuildResult {
  success: boolean;
  distFiles: Array<{ path: string; content: string; sizeBytes: number }>;
  errors: string;
  buildLog: string;
}

function getContentType(path: string): string {
  const ext = extname(path).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.webp': 'image/webp',
    '.wasm': 'application/wasm',
    '.map': 'application/json',
  };
  return types[ext] || 'application/octet-stream';
}

async function readDirRecursive(dir: string, basePath: string = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const subFiles = await readDirRecursive(fullPath, relPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ['bash', '-c', command],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });

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

/**
 * Patch vite.config.js/ts to set base path for preview serving.
 * This ensures that asset references in the built HTML use the correct
 * path prefix instead of absolute /assets/ which breaks preview.
 * 
 * CRITICAL: VITE_BASE env var does NOT set Vite's base option.
 * We must modify the vite.config file directly.
 */
async function patchViteConfig(projectDir: string, projectId: string): Promise<boolean> {
  const configFiles = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
  
  for (const cfgFile of configFiles) {
    const cfgPath = join(projectDir, cfgFile);
    try {
      const content = await readFile(cfgPath, 'utf-8');
      
      // Check if base is already set
      if (content.includes('base:')) {
        logger.info(`[local-build] vite config already has base option in ${cfgFile}`);
        return true;
      }
      
      // ROOT FIX: use relative base ('./') instead of absolute '/preview-dist/{projectId}/'.
      // The old absolute path required a matching route on Cloudflare Pages that
      // doesn't exist — the Pages Function at /preview/ serves the HTML, but the
      // script tags pointed to /preview-dist/{projectId}/assets/... which 404'd.
      // Using './' makes all asset references relative to the current URL, so
      // /preview/ can serve the HTML and the browser resolves /preview/assets/... correctly.
      let patched = content;

      if (patched.includes('defineConfig')) {
        const idx = patched.indexOf('{', patched.indexOf('defineConfig'));
        if (idx !== -1) {
          patched = patched.slice(0, idx + 1) +
            `\n    base: './',` +
            patched.slice(idx + 1);

          await writeFile(cfgPath, patched, 'utf-8');
          logger.info(`[local-build] Patched ${cfgFile} with base: './' (relative)`);
          return true;
        }
      }
      
      // If no defineConfig, try wrapping with defineConfig
      logger.warn(`[local-build] Could not patch ${cfgFile} - no defineConfig found`);
    } catch {
      // File doesn't exist, try next
      continue;
    }
  }
  
  logger.warn('[local-build] No vite.config file found to patch');
  return false;
}

/**
 * Rewrite asset paths in HTML from absolute to relative.
 * Changes src="/assets/..." to src="./assets/..." and href="/assets/..." to href="./assets/..."
 * This makes the preview work regardless of the serving path.
 */
function rewriteHtmlAssetPaths(html: string): string {
  // Replace absolute asset paths with relative ones
  // src="/assets/..." -> src="./assets/..."
  // href="/assets/..." -> href="./assets/..."
  let result = html;
  result = result.replace(/(src|href)=(["'])\/assets\//g, '$1=$2./assets/');
  // Also handle /vite.svg and other root-relative common assets
  result = result.replace(/(src|href)=(["'])\/vite\.svg/g, '$1=$2./vite.svg');
  return result;
}

export async function buildLocally(
  projectId: string,
  appType: string,
): Promise<LocalBuildResult> {
  const projectDir = join(PROJECTS_ROOT, projectId);
  const stack = getStack(appType);

  logger.info(`[local-build] Starting build for project ${projectId} (appType=${appType}, stack=${stack.id})`);
  logger.info(`[local-build] Project dir: ${projectDir}`);

  // Verify project directory exists
  try {
    const dirStat = await stat(projectDir);
    if (!dirStat.isDirectory()) {
      return { success: false, distFiles: [], errors: `Not a directory: ${projectDir}`, buildLog: '' };
    }
  } catch {
    return { success: false, distFiles: [], errors: `Project directory not found: ${projectDir}`, buildLog: '' };
  }

  const buildLog: string[] = [];

  // Step 0: Patch vite.config for correct base path (BEFORE install/build)
  if (stack.id === 'react' || stack.id === 'vue' || stack.id === 'phaser' || stack.id === 'threejs') {
    await patchViteConfig(projectDir, projectId);
  }

  // Step 1: Install dependencies using Bun
  if (stack.install && stack.install.length > 0) {
    const bunInstallCmd = 'bun install';
    logger.info(`[local-build] Running install: ${bunInstallCmd}`);
    buildLog.push(`$ ${bunInstallCmd}`);

    const installResult = await runShellCommand(
      bunInstallCmd,
      projectDir,
      INSTALL_TIMEOUT_MS,
      {
        NODE_OPTIONS: '--max-old-space-size=2048',
      },
    );

    buildLog.push(installResult.stdout.slice(-2000));
    if (installResult.stderr) buildLog.push(installResult.stderr.slice(-2000));

    if (!installResult.success) {
      const errMsg = `bun install failed: ${(installResult.stderr || installResult.stdout).slice(0, MAX_ERROR_CHARS)}`;
      logger.error(`[local-build] Install failed for ${projectId}: ${errMsg}`);
      return {
        success: false,
        distFiles: [],
        errors: errMsg,
        buildLog: buildLog.join('\n'),
      };
    }

    logger.info(`[local-build] Install succeeded for ${projectId}`);
  }

  // Step 2: Build using Bun
  if (stack.build && stack.build.length > 0) {
    const bunBuildCmd = stack.build.replace(/^npm\s+run\s+/, 'bun run ');
    logger.info(`[local-build] Running build: ${bunBuildCmd}`);
    buildLog.push(`$ ${bunBuildCmd}`);

    const buildResult = await runShellCommand(
      bunBuildCmd,
      projectDir,
      BUILD_TIMEOUT_MS,
      {
        NODE_OPTIONS: '--max-old-space-size=2048',
      },
    );

    buildLog.push(buildResult.stdout.slice(-2000));
    if (buildResult.stderr) buildLog.push(buildResult.stderr.slice(-2000));

    if (!buildResult.success) {
      const errMsg = `Build failed: ${(buildResult.stderr || buildResult.stdout).slice(0, MAX_ERROR_CHARS)}`;
      logger.error(`[local-build] Build failed for ${projectId}: ${errMsg}`);
      return {
        success: false,
        distFiles: [],
        errors: errMsg,
        buildLog: buildLog.join('\n'),
      };
    }

    logger.info(`[local-build] Build succeeded for ${projectId}`);
  } else {
    logger.info(`[local-build] No build step for stack ${stack.id} — skipping`);
  }

  // Step 3: Read dist/ directory
  const distDir = join(projectDir, 'dist');
  let distFilePaths: string[] = [];
  let actualDistDir = distDir;

  try {
    distFilePaths = await readDirRecursive(distDir);
    logger.info(`[local-build] Found ${distFilePaths.length} files in dist/`);
  } catch {
    for (const altDir of ['out']) {
      try {
        const altPath = join(projectDir, altDir);
        const altFiles = await readDirRecursive(altPath);
        if (altFiles.length > 0) {
          distFilePaths = altFiles;
          actualDistDir = altPath;
          logger.info(`[local-build] Found ${altFiles.length} files in ${altDir}/`);
          break;
        }
      } catch {
        continue;
      }
    }

    if (distFilePaths.length === 0) {
      return {
        success: false,
        distFiles: [],
        errors: 'No dist/ directory found after build.',
        buildLog: buildLog.join('\n'),
      };
    }
  }

  // Step 4: Read each dist file, rewrite HTML paths, and upload to R2
  const distFiles: Array<{ path: string; content: string; sizeBytes: number }> = [];
  let uploadErrors = 0;

  for (const filePath of distFilePaths) {
    try {
      const fullPath = join(actualDistDir, filePath);
      let content = await readFile(fullPath, 'utf-8');
      
      // Rewrite HTML asset paths from absolute to relative
      if (filePath.endsWith('.html')) {
        content = rewriteHtmlAssetPaths(content);
        // Also write the patched HTML back to disk for nginx serving
        try {
          await writeFile(fullPath, content, 'utf-8');
        } catch { /* non-fatal */ }
      }

      const sizeBytes = Buffer.byteLength(content, 'utf-8');

      // Upload to R2 at projects/{projectId}/dist/{filePath}
      const r2Key = `projects/${projectId}/dist/${filePath}`;
      await putFile(r2Key, content);

      distFiles.push({ path: filePath, content, sizeBytes });
      logger.debug(`[local-build] Uploaded ${r2Key} (${sizeBytes} bytes)`);
    } catch (err) {
      uploadErrors++;
      logger.warn(`[local-build] Failed to read/upload dist file ${filePath}: ${err}`);
    }
  }

  if (distFiles.length === 0) {
    return {
      success: false,
      distFiles: [],
      errors: `No dist files could be read. ${uploadErrors} read/upload errors.`,
      buildLog: buildLog.join('\n'),
    };
  }

  // Step 5: Copy dist to /var/www/ for nginx serving (before return!)
  try {
    const wwwDir = '/var/www/preview-dist/' + projectId;
    await runShellCommand(
      `sudo mkdir -p ${wwwDir} && sudo cp -r ${actualDistDir}/* ${wwwDir}/ && sudo chmod -R 755 ${wwwDir}`,
      projectDir,
      30_000,
    );
    logger.info(`[local-build] Copied dist to ${wwwDir} for nginx serving`);
  } catch (copyErr) {
    logger.warn(`[local-build] Failed to copy to /var/www/ (non-fatal): ${copyErr}`);
  }

  logger.info(
    `[local-build] Build complete for ${projectId}: ${distFiles.length} dist files uploaded to R2` +
    (uploadErrors > 0 ? ` (${uploadErrors} errors)` : ''),
  );

  return {
    success: true,
    distFiles,
    errors: uploadErrors > 0 ? `${uploadErrors} files failed to upload` : '',
    buildLog: buildLog.join('\n'),
  };
}

export async function checkPrebuiltDist(
  projectId: string,
): Promise<{ hasPrebuilt: boolean; files: string[] }> {
  const { listObjects } = await import('./r2-client');
  const prefix = `projects/${projectId}/dist/`;

  try {
    const keys = await listObjects(prefix);
    const files = keys.map(k => k.slice(prefix.length)).filter(Boolean);
    return { hasPrebuilt: files.length > 0, files };
  } catch (err) {
    logger.warn(`[local-build] Failed to check prebuilt dist for ${projectId}: ${err}`);
    return { hasPrebuilt: false, files: [] };
  }
}
