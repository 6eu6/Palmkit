/**
 * Project Analyzer — determines the project type from the workbench file map
 * and routes it to the correct runtime with the correct install/dev commands.
 *
 * Supported project types:
 *
 *   static   → iframe preview (zero cost, instant, works on all devices)
 *   vite     → WebContainer (desktop) or E2B (mobile) — React/Vue/Svelte + Vite
 *   nextjs   → E2B (needs a real Node server)
 *   node     → E2B (Express/Koa/Fastify/NestJS backend)
 *   python   → E2B (Flask/FastAPI/Django)
 *   unknown  → E2B as fallback
 *
 * Each non-static type includes the correct `installCommand` and `devCommand`
 * so api.sb.ts knows exactly how to install deps and start the dev server.
 */

import type { FileMap } from '~/lib/common/llm/constants';

export type ProjectType = 'static' | 'vite' | 'nextjs' | 'node' | 'python' | 'unknown';

export interface ProjectAnalysis {
  type: ProjectType;
  hasIndexHtml: boolean;
  hasPackageJson: boolean;
  hasVite: boolean;
  hasNextjs: boolean;
  hasNodeBackend: boolean;
  hasPython: boolean;

  /** For static projects: the path to the entry HTML file. */
  entryHtmlPath?: string;

  /**
   * For non-static projects: the shell command to install dependencies.
   * Passed to E2B's `sandbox.commands.run()`.
   */
  installCommand?: string;

  /**
   * For non-static projects: the shell command to start the dev server.
   * Passed to E2B's `sandbox.commands.run()`.
   * Must bind to 0.0.0.0 so the preview proxy can reach it.
   */
  devCommand?: string;

  /** Human-readable reason for the routing decision (for logging). */
  reason: string;
}

/** Default port for all dev servers inside the sandbox. */
export const PREVIEW_PORT = 3000;

/**
 * Analyze the workbench file map and determine the project type + commands.
 *
 * Decision tree (ordered by specificity):
 *  1. No package.json + has .html        → static  → iframe
 *  2. No package.json + has .py          → python  → E2B (pip + python)
 *  3. No package.json + has .go/.rs      → unknown → E2B fallback
 *  4. package.json + next dep            → nextjs  → E2B (next dev)
 *  5. package.json + vite dep            → vite    → E2B/WebContainer (vite)
 *  6. package.json + express/koa/fastify → node    → E2B (node server.js)
 *  7. package.json + has server.js/.ts   → node    → E2B (node server.js)
 *  8. package.json only                  → unknown → E2B fallback (npm run dev)
 */
export function analyzeProject(files: FileMap): ProjectAnalysis {
  const filePaths = Object.keys(files).filter((p) => files[p]?.type === 'file');
  const prefix = '/home/project/';

  // Strip the workdir prefix to get relative paths
  const relPaths = filePaths.map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));

  // Find key files
  let indexHtmlPath = relPaths.find((p) => p === 'index.html' || p.endsWith('/index.html'));
  const packageJsonPath = relPaths.find((p) => p === 'package.json');
  const hasIndexHtml = Boolean(indexHtmlPath);
  const hasPackageJson = Boolean(packageJsonPath);

  // Check for Python entry points
  const hasRequirementsTxt = relPaths.some((p) => p === 'requirements.txt');
  const pyEntryFile = relPaths.find((p) => p === 'app.py' || p === 'main.py' || p === 'server.py' || p === 'manage.py');
  const hasPython = hasRequirementsTxt || Boolean(pyEntryFile);

  // Check for Go/Rust (future support)
  const hasGo = relPaths.some((p) => p.endsWith('.go'));
  const hasRust = relPaths.some((p) => p === 'Cargo.toml');

  // Parse package.json if it exists
  let hasVite = false;
  let hasNextjs = false;
  let hasNodeBackend = false;
  let pkgScripts: Record<string, string> = {};

  if (packageJsonPath && files[`${prefix}${packageJsonPath}`]?.type === 'file') {
    const content = (files[`${prefix}${packageJsonPath}`] as { content: string }).content;

    try {
      const pkg = JSON.parse(content);
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      hasVite = Boolean(allDeps.vite);
      hasNextjs = Boolean(allDeps.next);
      hasNodeBackend = Boolean(allDeps.express || allDeps.koa || allDeps.fastify || allDeps['@nestjs/core']);
      pkgScripts = pkg.scripts || {};
    } catch {
      // Malformed package.json — treat as unknown
    }
  }

  // Check for server entry files (even without known backend deps)
  const hasServerFile = relPaths.some((p) => p === 'server.js' || p === 'server.ts' || p === 'server.mjs');

  // ─── Decision tree ───────────────────────────────────────────────────
  let type: ProjectType;
  let reason: string;
  let installCommand: string | undefined;
  let devCommand: string | undefined;

  if (!hasPackageJson) {
    // ── No package.json ──
    if (hasIndexHtml || relPaths.some((p) => p.endsWith('.html'))) {
      // Static HTML/CSS/JS project — iframe preview
      type = 'static';
      reason = 'No package.json + has .html → static iframe preview (zero cost)';

      if (!indexHtmlPath) {
        indexHtmlPath = relPaths.find((p) => p.endsWith('.html'));
      }
    } else if (hasPython) {
      // Python project — Flask/FastAPI/Django
      type = 'python';
      reason = 'No package.json + has .py/requirements.txt → Python (E2B)';

      installCommand = hasRequirementsTxt ? 'pip install -r requirements.txt' : 'pip install flask';
      devCommand = pyEntryFile ? `python ${pyEntryFile}` : 'python app.py';
    } else if (hasGo) {
      // Go project (future — for now E2B fallback)
      type = 'unknown';
      reason = 'No package.json + has .go → unknown (E2B fallback)';
      installCommand = 'echo "Go project — no install needed"';
      devCommand = 'echo "Go not yet supported"';
    } else if (hasRust) {
      type = 'unknown';
      reason = 'No package.json + has Cargo.toml → unknown (E2B fallback)';
      installCommand = 'echo "Rust project — no install needed"';
      devCommand = 'echo "Rust not yet supported"';
    } else {
      type = 'unknown';
      reason = 'No package.json, no index.html → unknown (E2B fallback)';
    }
  } else if (hasNextjs) {
    // ── Next.js ──
    type = 'nextjs';
    reason = 'package.json + next → Next.js server (E2B)';
    installCommand = 'npm install --no-audit --no-fund';

    /*
     * Next.js dev server needs --hostname (not --host) and doesn't use
     * --base (it serves at /). The preview proxy strips /preview/ for
     * the initial HTML request, then Next.js takes over.
     */
    devCommand = `npm run dev -- --hostname 0.0.0.0 --port ${PREVIEW_PORT}`;
  } else if (hasVite) {
    // ── Vite (React/Vue/Svelte/Astro) ──
    type = 'vite';
    reason = 'package.json + vite → Vite dev server (WebContainer/E2B)';
    installCommand = 'npm install --no-audit --no-fund';
    devCommand = `npm run dev -- --host 0.0.0.0 --port ${PREVIEW_PORT} --base=/preview/`;
  } else if (hasNodeBackend || hasServerFile) {
    // ── Node backend (Express/Koa/Fastify/NestJS) ──
    type = 'node';
    reason = hasNodeBackend
      ? 'package.json + express/koa/fastify → Node backend (E2B)'
      : 'package.json + server.js → Node backend (E2B)';
    installCommand = 'npm install --no-audit --no-fund';

    /*
     * For Node backends, use the start script from package.json if it exists.
     * Otherwise, run server.js directly. The server must bind to 0.0.0.0
     * so the E2B preview proxy can reach it.
     */
    if (pkgScripts.start && !pkgScripts.start.includes('vite')) {
      // Use `npm start` but override the host/port via env vars
      devCommand = `PORT=${PREVIEW_PORT} HOST=0.0.0.0 npm start`;
    } else if (pkgScripts.dev && !pkgScripts.dev.includes('vite')) {
      devCommand = `PORT=${PREVIEW_PORT} HOST=0.0.0.0 npm run dev`;
    } else {
      // Find the server entry file
      const serverFile =
        relPaths.find((p) => p === 'server.js') ||
        relPaths.find((p) => p === 'server.ts') ||
        relPaths.find((p) => p === 'server.mjs') ||
        relPaths.find((p) => p === 'app.js') ||
        relPaths.find((p) => p === 'index.js') ||
        'server.js';
      devCommand = `PORT=${PREVIEW_PORT} HOST=0.0.0.0 node ${serverFile}`;
    }
  } else {
    // ── Unknown package.json project — try npm run dev as fallback ──
    type = 'unknown';
    reason = 'package.json but no known framework → E2B fallback (npm run dev)';
    installCommand = 'npm install --no-audit --no-fund';
    devCommand = `npm run dev -- --host 0.0.0.0 --port ${PREVIEW_PORT} --base=/preview/ 2>/dev/null || npm start 2>/dev/null || echo "Could not start dev server"`;
  }

  return {
    type,
    hasIndexHtml,
    hasPackageJson,
    hasVite,
    hasNextjs,
    hasNodeBackend,
    hasPython,
    entryHtmlPath: indexHtmlPath,
    installCommand,
    devCommand,
    reason,
  };
}

/**
 * Build a self-contained HTML string for static projects.
 *
 * Reads the index.html, inlines all local CSS (<link href="style.css">)
 * and JS (<script src="script.js">) references from the file map, and
 * returns a single HTML string that can be used as an iframe srcdoc.
 *
 * This eliminates the need for a dev server — the iframe renders the
 * full app instantly with zero infrastructure cost.
 */
export function buildStaticPreviewHtml(files: FileMap, entryHtmlPath?: string): string {
  const prefix = '/home/project/';
  const rel = entryHtmlPath || 'index.html';
  const fullPath = `${prefix}${rel}`;

  const file = files[fullPath];

  if (!file || file.type !== 'file') {
    // Try finding any HTML file
    const htmlPath = Object.keys(files).find((p) => p.endsWith('.html'));

    if (!htmlPath || files[htmlPath]?.type !== 'file') {
      return '<!DOCTYPE html><html><body><p>No HTML file found</p></body></html>';
    }

    return (files[htmlPath] as { content: string }).content;
  }

  let html = file.content;

  // Inline <link href="style.css"> → <style>...</style>
  html = html.replace(/<link[^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href: string) => {
    // Only inline local files (not http://, https://, data:, etc.)
    if (/^(https?:)?\/\//i.test(href) || href.startsWith('data:')) {
      return match; // Keep external links as-is
    }

    // Resolve the path relative to the entry HTML's directory
    const cssPath = resolvePath(rel, href);
    const fullCssPath = `${prefix}${cssPath}`;
    const cssFile = files[fullCssPath];

    if (cssFile?.type === 'file') {
      return `<style>\n${cssFile.content}\n</style>`;
    }

    return match; // File not found — keep the original link
  });

  // Inline <script src="script.js"> → <script>...</script>
  html = html.replace(/<script[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi, (match, src: string) => {
    // Only inline local files
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) {
      return match; // Keep external scripts as-is
    }

    // Check if it's a module script (type="module")
    const isModule = /type=["']module["']/i.test(match);
    const jsPath = resolvePath(rel, src);
    const fullJsPath = `${prefix}${jsPath}`;
    const jsFile = files[fullJsPath];

    if (jsFile?.type === 'file') {
      const typeAttr = isModule ? ' type="module"' : '';
      return `<script${typeAttr}>\n${jsFile.content}\n</script>`;
    }

    return match; // File not found — keep the original script tag
  });

  /*
   * Inline <img src="image.svg"> as data URIs for SVG files
   * (only for local SVGs — binary images would need base64 which is expensive)
   */
  html = html.replace(/<img[^>]*src=["']([^"']+)["'][^>]*>/gi, (match, src: string) => {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) {
      return match;
    }

    if (src.endsWith('.svg')) {
      const svgPath = resolvePath(rel, src);
      const fullSvgPath = `${prefix}${svgPath}`;
      const svgFile = files[fullSvgPath];

      if (svgFile?.type === 'file') {
        const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgFile.content)}`;
        return match.replace(src, dataUri);
      }
    }

    return match;
  });

  return html;
}

/**
 * Resolve a relative path against a base path.
 * e.g., resolvePath('index.html', './style.css') → 'style.css'
 *       resolvePath('src/index.html', '../styles/main.css') → 'styles/main.css'
 */
function resolvePath(basePath: string, relativePath: string): string {
  // Remove leading ./
  const rel = relativePath.replace(/^\.\//, '');

  // If the relative path starts with /, it's absolute from the project root
  if (rel.startsWith('/')) {
    return rel.slice(1);
  }

  // Split base path into directory + filename
  const baseDir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/')) : '';

  // Split both into segments
  const baseSegments = baseDir ? baseDir.split('/') : [];
  const relSegments = rel.split('/');

  // Process ../ segments
  const result: string[] = [...baseSegments];

  for (const seg of relSegments) {
    if (seg === '..') {
      result.pop();
    } else if (seg !== '.') {
      result.push(seg);
    }
  }

  return result.join('/');
}
