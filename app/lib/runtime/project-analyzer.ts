/**
 * Project Analyzer — determines the project type from the workbench file map
 * and routes it to the correct runtime:
 *
 *   static   → iframe preview (zero cost, instant, works on all devices)
 *   vite     → WebContainer (desktop) or E2B (mobile)
 *   nextjs   → E2B (needs a real server)
 *   node     → E2B (needs a runtime)
 *   unknown  → E2B as fallback
 *
 * The analyzer is called by RemotePreviewTrigger AFTER the AI finishes
 * generating files. If the project is "static", the trigger skips E2B
 * entirely and injects a blob URL directly into workbenchStore.previews.
 */

import type { FileMap } from '~/lib/common/llm/constants';

export type ProjectType = 'static' | 'vite' | 'nextjs' | 'node' | 'unknown';

export interface ProjectAnalysis {
  type: ProjectType;
  hasIndexHtml: boolean;
  hasPackageJson: boolean;
  hasVite: boolean;
  hasNextjs: boolean;
  hasNodeBackend: boolean;

  /** For static projects: the path to the entry HTML file. */
  entryHtmlPath?: string;

  /** Human-readable reason for the routing decision (for logging). */
  reason: string;
}

/**
 * Analyze the workbench file map and determine the project type.
 *
 * Decision tree:
 *  1. No package.json → static (HTML/CSS/JS) → iframe preview
 *  2. package.json + vite dep → vite → WebContainer/E2B
 *  3. package.json + next dep → nextjs → E2B
 *  4. package.json + express/koa/fastify → node → E2B
 *  5. package.json only → unknown → E2B fallback
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

  // Parse package.json if it exists
  let hasVite = false;
  let hasNextjs = false;
  let hasNodeBackend = false;

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
    } catch {
      // Malformed package.json — treat as unknown
    }
  }

  // Decision tree
  let type: ProjectType;
  let reason: string;

  if (!hasPackageJson) {
    // No package.json — pure static HTML/CSS/JS project
    if (hasIndexHtml) {
      type = 'static';
      reason = 'No package.json + has index.html → static iframe preview (zero cost)';
    } else {
      /*
       * No package.json and no index.html — could be a Python script or something
       * Check for common static entry points
       */
      const hasHtml = relPaths.some((p) => p.endsWith('.html'));
      const hasPython = relPaths.some((p) => p.endsWith('.py'));
      const hasGo = relPaths.some((p) => p.endsWith('.go'));

      if (hasHtml) {
        type = 'static';
        reason = 'No package.json + has .html file → static iframe preview';

        // Use the first HTML file found
        const htmlPath = relPaths.find((p) => p.endsWith('.html'));
        indexHtmlPath = htmlPath;
      } else if (hasPython || hasGo) {
        type = 'node';
        reason = 'No package.json + has .py/.go → needs runtime (E2B)';
      } else {
        type = 'unknown';
        reason = 'No package.json, no index.html → unknown (E2B fallback)';
      }
    }
  } else if (hasVite) {
    type = 'vite';
    reason = 'package.json + vite → Vite dev server (WebContainer/E2B)';
  } else if (hasNextjs) {
    type = 'nextjs';
    reason = 'package.json + next → Next.js server (E2B)';
  } else if (hasNodeBackend) {
    type = 'node';
    reason = 'package.json + express/koa/fastify → Node backend (E2B)';
  } else {
    type = 'unknown';
    reason = 'package.json but no known framework → E2B fallback';
  }

  return {
    type,
    hasIndexHtml,
    hasPackageJson,
    hasVite,
    hasNextjs,
    hasNodeBackend,
    entryHtmlPath: indexHtmlPath,
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
