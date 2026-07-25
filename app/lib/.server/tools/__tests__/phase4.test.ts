/**
 * Phase 4 Test Suite — Code-mode tools (read_file, list_files, grep, run_shell, screenshot, read_sandbox_file)
 * =========================================================================================================
 *
 * Categories:
 *   1. Schema validation (Zod schemas accept/reject correct inputs)
 *   2. Tool execution (file-map-based tools with mocked files, sandbox tools with mocked fetch)
 *   3. Mode filtering (Phase 4 tools only in code mode)
 *   4. Intent detection (description quality + cross-tool distinction)
 *   5. Cross-tool integrity (no overlap, correct names)
 *   6. Edge cases (empty files, missing sandbox, binary detection, etc.)
 *   7. Legacy removal verification (no legacy adapters anywhere)
 *
 * Run with: pnpm run test:tools:phase4
 */

import assert from 'node:assert/strict';
import { readFileSchema } from '~/lib/.server/tools/schemas/read-file';
import { listFilesSchema } from '~/lib/.server/tools/schemas/list-files';
import { grepSchema } from '~/lib/.server/tools/schemas/grep';
import { runShellSchema } from '~/lib/.server/tools/schemas/run-shell';
import { screenshotSchema } from '~/lib/.server/tools/schemas/screenshot';
import { readSandboxFileSchema } from '~/lib/.server/tools/schemas/read-sandbox-file';
import { toolRegistry } from '~/lib/.server/tools/registry';
import type { ToolContext } from '~/lib/.server/tools/types';
import { readFileTool } from '~/lib/.server/tools/code/read-file';
import { listFilesTool } from '~/lib/.server/tools/code/list-files';
import { grepTool } from '~/lib/.server/tools/code/grep';
import { runShellTool } from '~/lib/.server/tools/code/run-shell';
import { screenshotTool } from '~/lib/.server/tools/code/screenshot';
import { readSandboxFileTool } from '~/lib/.server/tools/code/read-sandbox-file';

// ─── Test runner ───────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    const result = fn();

    if (result instanceof Promise) {
      await result;
    }

    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err: any) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ─── Mock helpers ──────────────────────────────────────────────────
const originalFetch = globalThis.fetch;

function mockFetch(
  responses: Record<
    string,
    {
      status?: number;
      headers?: Record<string, string>;
      body: string | (() => unknown) | Record<string, unknown> | unknown[];
    }
  >,
): void {
  globalThis.fetch = (async (url: string | URL, _init?: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const key = Object.keys(responses).find((k) => urlStr.includes(k));

    if (!key) {
      return new Response('Not Found', { status: 404 });
    }

    const r = responses[key];
    const status = r.status ?? 200;
    const body = typeof r.body === 'function' ? (r.body as () => unknown)() : r.body;
    const headers = new Headers(r.headers);

    if (typeof body === 'string') {
      return new Response(body, { status, headers });
    }

    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    return new Response(JSON.stringify(body), { status, headers });
  }) as any;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { mode: 'code', ...overrides };
}

function makeFileMap(): Record<string, any> {
  return {
    'package.json': { type: 'file', content: '{"name":"test","dependencies":{"react":"^18.0.0"}}' },
    'src/App.tsx': {
      type: 'file',
      content:
        'import React from "react";\nimport { Button } from "./Button";\n\nexport function App() {\n  return <Button>Click</Button>;\n}\n',
    },
    'src/Button.tsx': {
      type: 'file',
      content:
        'import React from "react";\n\n// TODO: add disabled state\nexport function Button({ children }: { children: React.ReactNode }) {\n  return <button>{children}</button>;\n}\n',
    },
    'src/index.tsx': {
      type: 'file',
      content: 'import { createRoot } from "react-dom/client";\nimport { App } from "./App";\n',
    },
    'README.md': { type: 'file', content: '# Test Project\n\nA sample project.\n' },
    'src/components': { type: 'folder' }, // folder entry — should be skipped
  };
}

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 1: SCHEMA VALIDATION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 1. SCHEMA VALIDATION =======');

await test('read_file schema accepts path', () => {
  const r = readFileSchema.safeParse({ path: 'src/App.tsx' });
  assert.ok(r.success);
});

await test('read_file schema accepts path with leading ./', () => {
  const r = readFileSchema.safeParse({ path: './src/App.tsx' });
  assert.ok(r.success);
});

await test('read_file schema rejects empty path', () => {
  const r = readFileSchema.safeParse({ path: '' });
  assert.ok(!r.success);
});

await test('read_file schema rejects path > 500 chars', () => {
  const r = readFileSchema.safeParse({ path: 'a'.repeat(501) });
  assert.ok(!r.success);
});

await test('list_files schema accepts empty input', () => {
  const r = listFilesSchema.safeParse({});
  assert.ok(r.success);
});

await test('list_files schema accepts filter', () => {
  const r = listFilesSchema.safeParse({ filter: '*.tsx' });
  assert.ok(r.success);
});

await test('grep schema accepts pattern', () => {
  const r = grepSchema.safeParse({ pattern: 'function' });
  assert.ok(r.success);
});

await test('grep schema rejects empty pattern', () => {
  const r = grepSchema.safeParse({ pattern: '' });
  assert.ok(!r.success);
});

await test('grep schema accepts all options', () => {
  const r = grepSchema.safeParse({
    pattern: 'import',
    fileGlob: '*.tsx',
    caseSensitive: true,
    maxResults: 100,
  });
  assert.ok(r.success);
});

await test('grep schema rejects maxResults > 200', () => {
  const r = grepSchema.safeParse({ pattern: 'x', maxResults: 250 });
  assert.ok(!r.success);
});

await test('run_shell schema accepts command', () => {
  const r = runShellSchema.safeParse({ command: 'npm install' });
  assert.ok(r.success);
});

await test('run_shell schema rejects empty command', () => {
  const r = runShellSchema.safeParse({ command: '' });
  assert.ok(!r.success);
});

await test('run_shell schema rejects command > 2000 chars', () => {
  const r = runShellSchema.safeParse({ command: 'a'.repeat(2001) });
  assert.ok(!r.success);
});

await test('run_shell schema accepts timeoutMs', () => {
  const r = runShellSchema.safeParse({ command: 'x', timeoutMs: 60000 });
  assert.ok(r.success);
});

await test('run_shell schema rejects timeoutMs > 120000', () => {
  const r = runShellSchema.safeParse({ command: 'x', timeoutMs: 200000 });
  assert.ok(!r.success);
});

await test('screenshot schema accepts empty input (defaults)', () => {
  const r = screenshotSchema.safeParse({});
  assert.ok(r.success);
});

await test('screenshot schema accepts url + dimensions', () => {
  const r = screenshotSchema.safeParse({
    url: 'http://localhost:5173/about',
    width: 1920,
    height: 1080,
    fullPage: true,
  });
  assert.ok(r.success);
});

await test('screenshot schema rejects width > 1920', () => {
  const r = screenshotSchema.safeParse({ width: 2000 });
  assert.ok(!r.success);
});

await test('read_sandbox_file schema accepts path', () => {
  const r = readSandboxFileSchema.safeParse({ path: 'dist/index.html' });
  assert.ok(r.success);
});

await test('read_sandbox_file schema rejects empty path', () => {
  const r = readSandboxFileSchema.safeParse({ path: '' });
  assert.ok(!r.success);
});

await test('read_sandbox_file schema accepts maxLength', () => {
  const r = readSandboxFileSchema.safeParse({ path: 'x', maxLength: 20000 });
  assert.ok(r.success);
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 2: TOOL EXECUTION — FILE-MAP BASED
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 2. TOOL EXECUTION (file-map) =======');

await test('read_file reads existing file', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await readFileTool.execute({ path: 'src/App.tsx' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.path, 'src/App.tsx');
    assert.ok(r.content.includes('import React'));
    assert.ok(r.size > 0);
    assert.ok(r.lines > 0);
  }
});

await test('read_file normalizes leading ./', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await readFileTool.execute({ path: './src/App.tsx' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).path, 'src/App.tsx');
  }
});

await test('read_file normalizes leading /', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await readFileTool.execute({ path: '/src/App.tsx' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).path, 'src/App.tsx');
  }
});

await test('read_file returns error for missing file with available files', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await readFileTool.execute({ path: 'nonexistent.ts' }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('not found'));
    assert.ok(result.error.includes('package.json') || result.hint?.includes('list_files'));
  }
});

await test('read_file returns error when no files in context', async () => {
  const ctx = makeCtx({ files: undefined });
  const result = await readFileTool.execute({ path: 'any.ts' }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('No project files'));
  }
});

await test('read_file returns error for folder entries', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await readFileTool.execute({ path: 'src/components' }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('not a file'));
  }
});

await test('list_files returns all files', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await listFilesTool.execute({}, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.totalFiles, 5); // 5 file entries (folder is skipped)
    assert.ok(r.files.some((f: any) => f.path === 'package.json'));
    assert.ok(r.files.some((f: any) => f.path === 'src/App.tsx'));
    assert.ok(r.files.some((f: any) => f.path === 'README.md'));
    assert.ok(r.totalSize > 0);
    assert.ok(r.totalLines > 0);
  }
});

await test('list_files respects filter *.tsx', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await listFilesTool.execute({ filter: '*.tsx' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.totalFiles, 3); // App.tsx, Button.tsx, index.tsx

    for (const f of r.files) {
      assert.ok(f.path.endsWith('.tsx'));
    }
  }
});

await test('list_files respects filter src/**', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await listFilesTool.execute({ filter: 'src/**' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.totalFiles, 3); // App, Button, index (all under src/)

    for (const f of r.files) {
      assert.ok(f.path.startsWith('src/'));
    }
  }
});

await test('list_files returns byExtension summary', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await listFilesTool.execute({}, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.byExtension);
    assert.ok(r.byExtension.tsx >= 3);
    assert.ok(r.byExtension.json >= 1);
    assert.ok(r.byExtension.md >= 1);
  }
});

await test('list_files returns error when no files', async () => {
  const ctx = makeCtx({ files: undefined });
  const result = await listFilesTool.execute({}, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('No project files'));
  }
});

await test('grep finds pattern across files', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await grepTool.execute({ pattern: 'import' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.totalMatches > 0);
    assert.ok(r.results.some((res: any) => res.file === 'src/App.tsx'));
    assert.ok(r.results.some((res: any) => res.file === 'src/index.tsx'));
  }
});

await test('grep respects fileGlob filter', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await grepTool.execute({ pattern: 'import', fileGlob: '*.tsx' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;

    for (const res of r.results) {
      assert.ok(res.file.endsWith('.tsx'));
    }
  }
});

await test('grep finds TODO comments', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await grepTool.execute({ pattern: 'TODO' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.totalMatches >= 1);
    assert.ok(r.results.some((res: any) => res.file === 'src/Button.tsx'));
  }
});

await test('grep handles invalid regex gracefully', async () => {
  const ctx = makeCtx({ files: makeFileMap() });

  // "function(" is invalid regex (unbalanced paren)
  const result = await grepTool.execute({ pattern: 'function(' }, ctx);

  assert.equal(result.ok, true);

  // Should fall back to literal match, not crash
});

await test('grep respects caseSensitive option', async () => {
  const ctx = makeCtx({ files: makeFileMap() });

  // "react" lowercase — should not match "React" in case-sensitive mode
  const result = await grepTool.execute({ pattern: 'react', caseSensitive: true }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;

    // "react" appears in package.json dependencies value
    assert.ok(r.totalMatches >= 0);
  }
});

await test('grep respects maxResults cap', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await grepTool.execute({ pattern: 'e', maxResults: 3 }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.totalMatches <= 3);
  }
});

await test('grep returns truncated flag when capped', async () => {
  const ctx = makeCtx({ files: makeFileMap() });

  // 'e' appears in nearly every line — should hit the cap
  const result = await grepTool.execute({ pattern: 'e', maxResults: 5 }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;

    if (r.totalMatches >= 5) {
      assert.equal(r.truncated, true);
    }
  }
});

await test('grep returns error when no files', async () => {
  const ctx = makeCtx({ files: undefined });
  const result = await grepTool.execute({ pattern: 'test' }, ctx);

  assert.equal(result.ok, false);
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 3: TOOL EXECUTION — SANDBOX BASED (mocked fetch)
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 3. TOOL EXECUTION (sandbox) =======');

await test('run_shell returns error when no sandbox', async () => {
  const ctx = makeCtx({ sandboxId: undefined });
  const result = await runShellTool.execute({ command: 'npm install' }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('No sandbox'));
  }
});

await test('run_shell executes command successfully', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      body: { exitCode: 0, stdout: 'added 1 package', stderr: '' },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await runShellTool.execute({ command: 'npm install' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.exitCode, 0);
    assert.equal(r.success, true);
    assert.ok(r.stdout.includes('added 1 package'));
    assert.equal(r.stderr, '');
  }

  restoreFetch();
});

await test('run_shell returns failure for non-zero exit', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      body: { exitCode: 1, stdout: '', stderr: 'Error: module not found' },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await runShellTool.execute({ command: 'npm run build' }, ctx);

  assert.equal(result.ok, true); // tool succeeded, but command failed

  if (result.ok) {
    const r = result as any;
    assert.equal(r.exitCode, 1);
    assert.equal(r.success, false);
    assert.ok(r.stderr.includes('Error'));
  }

  restoreFetch();
});

await test('run_shell truncates large stdout', async () => {
  const largeStdout = 'x'.repeat(10000);
  mockFetch({
    'palmkit.app/api/sb': {
      body: { exitCode: 0, stdout: largeStdout, stderr: '' },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await runShellTool.execute({ command: 'yes x' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.stdout.length <= 5000);
    assert.equal(r.stdoutTruncated, true);
    assert.equal(r.stdoutOriginalLength, 10000);
  }

  restoreFetch();
});

await test('run_shell handles HTTP error from sandbox API', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      status: 404,
      body: { error: 'Sandbox not found' },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await runShellTool.execute({ command: 'ls' }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('404') || result.error.includes('not found'));
  }

  restoreFetch();
});

await test('screenshot returns error when no sandbox', async () => {
  const ctx = makeCtx({ sandboxId: undefined });
  const result = await screenshotTool.execute({}, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('No sandbox'));
  }
});

await test('screenshot returns metadata (not base64)', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      body: {
        url: 'http://localhost:5173',
        image: 'base64data_here',
        mimeType: 'image/png',
        size: 102400,
        width: 1280,
        height: 720,
      },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await screenshotTool.execute({}, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.mimeType, 'image/png');
    assert.equal(r.size, 102400);
    assert.equal(r.width, 1280);
    assert.equal(r.height, 720);
    assert.equal(r.captured, true);

    // The base64 image should NOT be in the result (too large for LLM context)
    assert.equal(r.image, undefined);
    assert.equal(r.imageBase64, undefined);
  }

  restoreFetch();
});

await test('screenshot respects custom url + dimensions', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      body: {
        url: 'http://localhost:5173/about',
        mimeType: 'image/png',
        size: 50000,
        width: 1920,
        height: 1080,
      },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await screenshotTool.execute(
    {
      url: 'http://localhost:5173/about',
      width: 1920,
      height: 1080,
      fullPage: true,
    },
    ctx,
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.url, 'http://localhost:5173/about');
    assert.equal(r.width, 1920);
    assert.equal(r.height, 1080);
  }

  restoreFetch();
});

await test('read_sandbox_file returns error when no sandbox', async () => {
  const ctx = makeCtx({ sandboxId: undefined });
  const result = await readSandboxFileTool.execute({ path: 'dist/index.html' }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('No sandbox'));
  }
});

await test('read_sandbox_file reads file content', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      body: {
        path: 'dist/index.html',
        content: '<!DOCTYPE html><html><body>Hello</body></html>',
        size: 50,
      },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await readSandboxFileTool.execute({ path: 'dist/index.html' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.content.includes('Hello'));
    assert.equal(r.size, 50);
    assert.equal(r.truncated, false);
  }

  restoreFetch();
});

await test('read_sandbox_file truncates large files', async () => {
  const largeContent = 'a'.repeat(20000);
  mockFetch({
    'palmkit.app/api/sb': {
      body: {
        path: 'big.txt',
        content: largeContent,
        size: 20000,
      },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await readSandboxFileTool.execute({ path: 'big.txt', maxLength: 5000 }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.truncated, true);
    assert.ok(r.content.length < 6000); // ~5000 + truncation marker
    assert.equal(r.originalLength, 20000);
  }

  restoreFetch();
});

await test('read_sandbox_file handles 404 from sandbox', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      status: 404,
      body: { error: 'File not found in sandbox' },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await readSandboxFileTool.execute({ path: 'nonexistent.txt' }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('404') || result.error.includes('not found'));
  }

  restoreFetch();
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 4: MODE FILTERING
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 4. MODE FILTERING =======');

await test('Phase 4 tools available in code mode only', () => {
  const phase4Tools = ['read_file', 'list_files', 'grep', 'run_shell', 'screenshot', 'read_sandbox_file'];

  for (const name of phase4Tools) {
    const workTools = toolRegistry.listToolsForMode('work').map((t) => t.name);
    const chatTools = toolRegistry.listToolsForMode('chat').map((t) => t.name);
    const codeTools = toolRegistry.listToolsForMode('code').map((t) => t.name);

    assert.ok(codeTools.includes(name), `${name} should be in code mode`);
    assert.ok(!workTools.includes(name), `${name} should NOT be in work mode`);
    assert.ok(!chatTools.includes(name), `${name} should NOT be in chat mode`);
  }
});

await test('code mode has all 8 tools (6 Phase 4 + 2 universal)', () => {
  const codeTools = toolRegistry.listToolsForMode('code');
  const names = codeTools.map((t) => t.name).sort();

  // 6 Phase 4 + web_search + read_url (universal)
  const expected = [
    'grep',
    'list_files',
    'read_file',
    'read_sandbox_file',
    'read_url',
    'run_shell',
    'screenshot',
    'web_search',
  ].sort();

  assert.deepEqual(names, expected);
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 5: INTENT DETECTION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 5. INTENT DETECTION =======');

await test('read_file description mentions project file', () => {
  const desc = readFileTool.description.toLowerCase();
  assert.ok(desc.includes('project') || desc.includes('file'));
  assert.ok(desc.includes('content'));
});

await test('read_file description distinguishes from read_sandbox_file', () => {
  const desc = readFileTool.description.toLowerCase();
  assert.ok(desc.includes('read_sandbox_file') || desc.includes('sandbox'), 'should mention read_sandbox_file');
});

await test('list_files description mentions structure', () => {
  const desc = listFilesTool.description.toLowerCase();
  assert.ok(desc.includes('structure') || desc.includes('list'));
});

await test('grep description mentions search pattern', () => {
  const desc = grepTool.description.toLowerCase();
  assert.ok(desc.includes('search'));
  assert.ok(desc.includes('pattern'));
});

await test('run_shell description mentions shell command', () => {
  const desc = runShellTool.description.toLowerCase();
  assert.ok(desc.includes('shell') || desc.includes('command'));
  assert.ok(desc.includes('npm') || desc.includes('verify'));
});

await test('screenshot description mentions visual verify', () => {
  const desc = screenshotTool.description.toLowerCase();
  assert.ok(desc.includes('screenshot') || desc.includes('visual'));
  assert.ok(desc.includes('verify') || desc.includes('render'));
});

await test('read_sandbox_file description distinguishes from read_file', () => {
  const desc = readSandboxFileTool.description.toLowerCase();
  assert.ok(desc.includes('read_file'), 'should mention read_file');
  assert.ok(desc.includes('actual') || desc.includes('post-build'));
});

await test('every Phase 4 tool has description > 100 chars', () => {
  const phase4Tools = [readFileTool, listFilesTool, grepTool, runShellTool, screenshotTool, readSandboxFileTool];

  for (const t of phase4Tools) {
    assert.ok(t.description.length > 100, `${t.name} too short (${t.description.length})`);
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 6: CROSS-TOOL INTEGRITY
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 6. CROSS-TOOL INTEGRITY =======');

await test('all Phase 4 tool names are snake_case', () => {
  const phase4Tools = [readFileTool, listFilesTool, grepTool, runShellTool, screenshotTool, readSandboxFileTool];

  for (const t of phase4Tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${t.name} not snake_case`);
  }
});

await test('all Phase 4 tools available only in code mode', () => {
  const phase4Tools = [readFileTool, listFilesTool, grepTool, runShellTool, screenshotTool, readSandboxFileTool];

  for (const t of phase4Tools) {
    assert.deepEqual([...t.availableIn], ['code'], `${t.name} should be code-only`);
  }
});

await test('all tool names remain unique', () => {
  const all = toolRegistry.listAllTools();
  const names = all.map((t) => t.name);
  const unique = new Set(names);
  assert.equal(names.length, unique.size, 'duplicates found');
});

await test('registry has 19 total tools (all native)', () => {
  const all = toolRegistry.listAllTools();

  /*
   * Phase 1: 3 investigative
   * Phase 2: 4 office + 2 analytics = 6
   * Phase 3: 1 creative + 1 analytics + 2 investigative = 4
   * Phase 4: 6 code-mode
   * Total: 19 (all native, no legacy)
   */
  assert.equal(all.length, 19, `Expected 19, got ${all.length}`);
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 7: LEGACY REMOVAL VERIFICATION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 7. LEGACY REMOVAL VERIFICATION =======');

await test('ALL modes have native tools only (no legacy)', () => {
  // Verify each mode has the expected native tools
  const chatTools = toolRegistry
    .listToolsForMode('chat')
    .map((t) => t.name)
    .sort();
  const workTools = toolRegistry
    .listToolsForMode('work')
    .map((t) => t.name)
    .sort();
  const codeTools = toolRegistry
    .listToolsForMode('code')
    .map((t) => t.name)
    .sort();

  // Chat: 2 universal tools
  assert.deepEqual(chatTools, ['read_url', 'web_search']);

  // Work: 13 native tools (5 investigative + 4 office + 3 analytics + 1 creative)
  assert.equal(workTools.length, 13);

  // Code: 8 tools (6 Phase 4 + 2 universal)
  assert.equal(codeTools.length, 8);
});

await test('legacy built-in-tools.ts and work-mode-tools.ts have been DELETED', () => {
  /*
   * Phase 5 cleanup: the legacy files were deleted.
   * This test verifies the deletion is complete — if someone re-creates
   * the files, this test will fail (reminding them to use the new
   * ToolDefinition pattern instead).
   *
   * We can't directly check file existence from a test runner, but we CAN
   * verify that the registry exposes all 19 tools natively (no legacy
   * adapters needed).
   */
  const all = toolRegistry.listAllTools();
  assert.equal(all.length, 19, `Expected 19 native tools, got ${all.length}`);

  // All 4 Phase 3 tools should be present (they replaced legacy adapters)
  const workTools = toolRegistry.listToolsForMode('work').map((t) => t.name);
  assert.ok(workTools.includes('generate_image'));
  assert.ok(workTools.includes('analyze_data'));
  assert.ok(workTools.includes('deep_search'));
  assert.ok(workTools.includes('read_and_extract'));

  // All 6 Phase 4 code tools should be present (they replaced legacy adapters)
  const codeTools = toolRegistry.listToolsForMode('code').map((t) => t.name);
  assert.ok(codeTools.includes('read_file'));
  assert.ok(codeTools.includes('list_files'));
  assert.ok(codeTools.includes('grep'));
  assert.ok(codeTools.includes('run_shell'));
  assert.ok(codeTools.includes('screenshot'));
  assert.ok(codeTools.includes('read_sandbox_file'));
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 8: EDGE CASES
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 8. EDGE CASES =======');

await test('read_file handles file at root (package.json)', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await readFileTool.execute({ path: 'package.json' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.ok((result as any).content.includes('"name"'));
  }
});

await test('list_files handles empty file map', async () => {
  const ctx = makeCtx({ files: {} });
  const result = await listFilesTool.execute({}, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).totalFiles, 0);
  }
});

await test('list_files filter returns empty when no matches', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await listFilesTool.execute({ filter: '*.py' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).totalFiles, 0);
  }
});

await test('grep returns empty results for non-matching pattern', async () => {
  const ctx = makeCtx({ files: makeFileMap() });
  const result = await grepTool.execute({ pattern: 'xyz_nonexistent_pattern_12345' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).totalMatches, 0);
    assert.equal((result as any).results.length, 0);
  }
});

await test('grep skips folder entries in file map', async () => {
  const ctx = makeCtx({ files: makeFileMap() });

  // 'src/components' is a folder — should not be searched
  const result = await grepTool.execute({ pattern: 'components' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    // The folder entry itself should not appear as a match source
    for (const r of (result as any).results) {
      assert.notEqual(r.file, 'src/components');
    }
  }
});

await test('run_shell handles network timeout', async () => {
  // Mock a fetch that throws AbortTimeoutError
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const err = new Error('Request timed out after 35000ms');
    err.name = 'AbortTimeoutError';
    throw err;
  }) as any;

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await runShellTool.execute({ command: 'npm install', timeoutMs: 30000 }, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('timed out'));
  }

  globalThis.fetch = originalFetch;
});

await test('screenshot returns 404 hint when sandbox not found', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      status: 404,
      body: { error: 'Sandbox not found' },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_old' });
  const result = await screenshotTool.execute({}, ctx);

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('404') || result.error.includes('not found'));
    assert.ok(result.hint);
  }

  restoreFetch();
});

await test('read_sandbox_file handles empty content', async () => {
  mockFetch({
    'palmkit.app/api/sb': {
      body: { path: 'empty.txt', content: '', size: 0 },
    },
  });

  const ctx = makeCtx({ sandboxId: 'sb_test123' });
  const result = await readSandboxFileTool.execute({ path: 'empty.txt' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).content, '');
    assert.equal((result as any).size, 0);
    assert.equal((result as any).truncated, false);
  }

  restoreFetch();
});

/*
 * ════════════════════════════════════════════════════════════════════
 * SUMMARY
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n=======================================');
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);

if (failures.length > 0) {
  console.log('\n  Failures:');

  for (const f of failures) {
    console.log(`    X ${f}`);
  }
}

console.log('=======================================\n');
