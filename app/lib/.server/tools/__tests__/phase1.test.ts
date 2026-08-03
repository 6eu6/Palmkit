/**
 * Comprehensive Test Suite — Phase 1 Tool Registry
 * ================================================
 *
 * This file contains FOUR test categories:
 *   1. Schema validation (Zod schemas accept/reject correct inputs)
 *   2. Mode filtering (registry exposes the right tools per mode)
 *   3. Tool execution (each tool's execute() with mocked fetch)
 *   4. Intent detection (analyzing whether tool descriptions clearly
 *      signal when to use them — without actually calling an LLM)
 *
 * Run with: npx tsx app/lib/.server/tools/__tests__/phase1.test.ts
 *
 * The tests use Node's assert module (no test framework dependency).
 * Mocks are minimal — we monkey-patch global fetch for network tests.
 */

import assert from 'node:assert/strict';
import { webSearchSchema } from '~/lib/.server/tools/schemas/web-search';
import { readUrlSchema } from '~/lib/.server/tools/schemas/read-url';
import { scrapePageSchema, SCRAPE_PAGE_DEFAULT_FIELDS } from '~/lib/.server/tools/schemas/scrape-page';
import { toolRegistry } from '~/lib/.server/tools/registry';
import { isToolAvailableInMode, resolveToolMode, type ToolContext, type ToolMode } from '~/lib/.server/tools/types';
import { webSearchTool } from '~/lib/.server/tools/investigative/web-search';
import { readUrlTool } from '~/lib/.server/tools/investigative/read-url';
import { scrapePageTool } from '~/lib/.server/tools/investigative/scrape-page';

/*
 * ─── Test runner ───────────────────────────────────────────────────
 *
 * This file used to carry its own: a `test()` that caught every error,
 * counted it, and printed a tally. Written to be run by hand with
 * `npx tsx`. But it is named *.test.ts, so vitest collected it, found no
 * `describe` or `it` in it, and reported the whole file as a failure —
 * which is how a thousand real assertions came to be both permanently red
 * and never actually enforced. A broken expectation printed an X and the
 * run still went green.
 *
 * `test` is vitest's `it` now. Same assertions, run one at a time in
 * declaration order (which the old floating promises did not do), and a
 * failure is a failure.
 */
import { it as test } from 'vitest';

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
  return {
    mode: 'work',
    ...overrides,
  };
}

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 1: SCHEMA VALIDATION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 1. SCHEMA VALIDATION =======');

test('web_search schema accepts minimal input', () => {
  const result = webSearchSchema.safeParse({ query: 'react hooks' });
  assert.ok(result.success, 'Should accept minimal input');
});

test('web_search schema accepts full input', () => {
  const result = webSearchSchema.safeParse({ query: 'react hooks', maxResults: 10, includeAnswer: false });
  assert.ok(result.success);
});

test('web_search schema rejects empty query', () => {
  const result = webSearchSchema.safeParse({ query: '' });
  assert.ok(!result.success, 'Should reject empty query');
});

test('web_search schema rejects missing query', () => {
  const result = webSearchSchema.safeParse({});
  assert.ok(!result.success);
});

test('web_search schema rejects query > 500 chars', () => {
  const result = webSearchSchema.safeParse({ query: 'a'.repeat(501) });
  assert.ok(!result.success);
});

test('web_search schema rejects maxResults > 20', () => {
  const result = webSearchSchema.safeParse({ query: 'test', maxResults: 25 });
  assert.ok(!result.success);
});

test('read_url schema accepts valid URL', () => {
  const result = readUrlSchema.safeParse({ url: 'https://example.com' });
  assert.ok(result.success);
});

test('read_url schema rejects invalid URL', () => {
  const result = readUrlSchema.safeParse({ url: 'not-a-url' });
  assert.ok(!result.success);
});

test('read_url schema rejects URL without protocol', () => {
  const result = readUrlSchema.safeParse({ url: 'example.com' });
  assert.ok(!result.success);
});

test('read_url schema accepts format=markdown', () => {
  const result = readUrlSchema.safeParse({ url: 'https://example.com', format: 'markdown' });
  assert.ok(result.success);
});

test('read_url schema rejects invalid format', () => {
  const result = readUrlSchema.safeParse({ url: 'https://example.com', format: 'pdf' as any });
  assert.ok(!result.success);
});

test('scrape_page schema accepts minimal URL', () => {
  const result = scrapePageSchema.safeParse({ url: 'https://example.com' });
  assert.ok(result.success);
});

test('scrape_page schema accepts extract array', () => {
  const result = scrapePageSchema.safeParse({
    url: 'https://example.com',
    extract: ['title', 'content'],
  });
  assert.ok(result.success);
});

test('scrape_page schema rejects invalid extract field', () => {
  const result = scrapePageSchema.safeParse({
    url: 'https://example.com',
    extract: ['title', 'invalid_field' as any],
  });
  assert.ok(!result.success);
});

test('SCRAPE_PAGE_DEFAULT_FIELDS has 6 fields', () => {
  assert.equal(SCRAPE_PAGE_DEFAULT_FIELDS.length, 6);
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 2: MODE FILTERING
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 2. MODE FILTERING =======');

test('resolveToolMode: build -> code', () => {
  assert.equal(resolveToolMode('build', 'chat'), 'code');
  assert.equal(resolveToolMode('build', 'work'), 'code');
  assert.equal(resolveToolMode('build', 'code'), 'code');
  assert.equal(resolveToolMode('build', undefined), 'code');
});

test('resolveToolMode: discuss + work -> work', () => {
  assert.equal(resolveToolMode('discuss', 'work'), 'work');
});

test('resolveToolMode: discuss + chat -> chat', () => {
  assert.equal(resolveToolMode('discuss', 'chat'), 'chat');
});

test('resolveToolMode: discuss + undefined -> chat', () => {
  assert.equal(resolveToolMode('discuss', undefined), 'chat');
});

test('resolveToolMode: discuss + code -> code', () => {
  assert.equal(resolveToolMode('discuss', 'code'), 'code');
});

test('web_search available in all 3 modes', () => {
  assert.ok(isToolAvailableInMode(webSearchTool, 'chat'));
  assert.ok(isToolAvailableInMode(webSearchTool, 'work'));
  assert.ok(isToolAvailableInMode(webSearchTool, 'code'));
});

test('read_url available in all 3 modes', () => {
  assert.ok(isToolAvailableInMode(readUrlTool, 'chat'));
  assert.ok(isToolAvailableInMode(readUrlTool, 'work'));
  assert.ok(isToolAvailableInMode(readUrlTool, 'code'));
});

test('scrape_page available in work mode only', () => {
  assert.ok(!isToolAvailableInMode(scrapePageTool, 'chat'));
  assert.ok(isToolAvailableInMode(scrapePageTool, 'work'));
  assert.ok(!isToolAvailableInMode(scrapePageTool, 'code'));
});

test('registry.listToolsForMode(chat) returns lightweight set', () => {
  const tools = toolRegistry.listToolsForMode('chat');
  const names = tools.map((t) => t.name);

  assert.ok(names.includes('web_search'), 'chat should have web_search');
  assert.ok(names.includes('read_url'), 'chat should have read_url');
  assert.ok(!names.includes('scrape_page'), 'chat should NOT have scrape_page');
  assert.ok(!names.includes('read_file'), 'chat should NOT have read_file');
  assert.ok(!names.includes('grep'), 'chat should NOT have grep');
  assert.ok(names.includes('generate_image'), 'chat should have generate_image');
});

test('registry.listToolsForMode(work) returns expanded set', () => {
  const tools = toolRegistry.listToolsForMode('work');
  const names = tools.map((t) => t.name);

  assert.ok(names.includes('web_search'));
  assert.ok(names.includes('read_url'));
  assert.ok(names.includes('scrape_page'), 'work should have scrape_page');
  assert.ok(names.includes('generate_image'), 'work should have generate_image');
  assert.ok(names.includes('create_pdf'), 'work should have create_pdf (Phase 2)');
  assert.ok(names.includes('create_docx'), 'work should have create_docx (Phase 2)');
  assert.ok(names.includes('create_xlsx'), 'work should have create_xlsx (Phase 2)');
  assert.ok(names.includes('read_document'), 'work should have read_document (Phase 2)');
  assert.ok(names.includes('make_chart'), 'work should have make_chart (Phase 2)');
  assert.ok(names.includes('build_table'), 'work should have build_table (Phase 2)');
  assert.ok(names.includes('analyze_data'), 'work should have analyze_data');
  assert.ok(names.includes('deep_search'), 'work should have deep_search');

  // Phase 2 replacements: create_document and format_table replaced by natives
  assert.ok(!names.includes('create_document'), 'create_document should be replaced by create_pdf/docx');
  assert.ok(!names.includes('format_table'), 'format_table should be replaced by build_table');

  assert.ok(!names.includes('read_file'), 'work should NOT have read_file');
  assert.ok(!names.includes('grep'), 'work should NOT have grep');
  assert.ok(!names.includes('run_shell'), 'work should NOT have run_shell');
});

test('registry.listToolsForMode(code) returns dev toolset', () => {
  const tools = toolRegistry.listToolsForMode('code');
  const names = tools.map((t) => t.name);

  assert.ok(names.includes('web_search'));
  assert.ok(names.includes('read_url'));
  assert.ok(names.includes('read_file'), 'code should have read_file');
  assert.ok(names.includes('list_files'), 'code should have list_files');
  assert.ok(names.includes('grep'), 'code should have grep');
  assert.ok(names.includes('run_shell'), 'code should have run_shell');

  assert.ok(!names.includes('scrape_page'), 'code should NOT have scrape_page');
  assert.ok(names.includes('generate_image'), 'code should have generate_image');
});

/**
 * Every tool the registry knows about.
 *
 * By name, not by count. `Expected 19 tools, got 20` was the old assertion,
 * and when `create_md` was added it said exactly that — a number that tells
 * you something moved but not what, so the honest reading is indistinguishable
 * from an accidental registration. Adding a tool on purpose is one line here,
 * and the diff then says which tool.
 */
const ALL_TOOL_NAMES = [
  // investigative
  'web_search',
  'read_url',
  'scrape_page',
  'deep_search',
  'read_and_extract',

  // office
  'create_pdf',
  'create_docx',
  'create_xlsx',
  'create_md',
  'read_document',

  // analytics
  'make_chart',
  'build_table',
  'analyze_data',

  // creative
  'generate_image',

  // code
  'read_file',
  'list_files',
  'grep',
  'run_shell',
  'screenshot',
  'read_sandbox_file',
];

test('registry.listAllTools returns exactly the registered tools', () => {
  const all = toolRegistry.listAllTools().map((t) => t.name);
  assert.deepEqual([...all].sort(), [...ALL_TOOL_NAMES].sort());
});

test('registry.getToolByName returns definition', () => {
  const t = toolRegistry.getToolByName('web_search');
  assert.ok(t);
  assert.equal(t!.name, 'web_search');
});

test('registry.getToolByName returns undefined for unknown', () => {
  const t = toolRegistry.getToolByName('nonexistent_tool');
  assert.equal(t, undefined);
});

test('registry.getToolsForMode returns AI SDK tool objects with execute', () => {
  const ctx = makeCtx({ mode: 'work' });
  const tools = toolRegistry.getToolsForMode('work', ctx);

  for (const [name, t] of Object.entries(tools)) {
    assert.ok((t as any).description, `${name} missing description`);
    assert.ok((t as any).parameters, `${name} missing parameters`);
    assert.ok(typeof (t as any).execute === 'function', `${name} missing execute`);
  }
});

/*
 * The registry binds the ToolContext into each tool's execute, so the AI SDK
 * can call it with only its own arguments.
 *
 * This used to be checked by executing web_search for real and asserting the
 * result had an `ok` field — which reached the network with a fake key, took
 * half a second, and failed whenever the connection hiccupped. It also did
 * not check the thing it claimed: any result shape passed, bound context or
 * not. Intercepting the request proves the key from ctx actually arrived.
 */
test('registry.getToolsForMode binds ctx via closure', async () => {
  let sawKey: string | undefined;

  mockFetch({ 'tavily.com': { body: { results: [] } } });

  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    try {
      sawKey = JSON.parse(init?.body ?? '{}').api_key;
    } catch {
      sawKey = undefined;
    }

    return original(url, init);
  }) as any;

  /* The `tvly-` prefix is how the tool picks Tavily over SerpApi. */
  const ctx = makeCtx({ mode: 'work', searchApiKey: 'tvly-test-key-12345' });
  const webSearch = toolRegistry.getToolsForMode('work', ctx).web_search;

  assert.ok(typeof webSearch.execute === 'function');

  const result = await webSearch.execute({ query: 'test' }, { toolCallId: 'test' } as any);

  assert.equal(sawKey, 'tvly-test-key-12345', 'the key from ctx must reach the request');
  assert.equal((result as any).ok, true);

  restoreFetch();
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 3: TOOL EXECUTION (with mocked fetch)
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 3. TOOL EXECUTION =======');

/**
 * Unconfigured search throws; it does not return `{ ok: false }`.
 *
 * That is deliberate and the tool says why: the AI SDK treats a returned
 * error object as a tool that ran successfully, so the model reads the error
 * text, assumes its query was wrong, and tries again — fifteen to twenty
 * times. Throwing marks the call failed and the model stops. This test used
 * to assert the shape that caused the retry storm.
 */
test('web_search throws when search is not configured', async () => {
  const ctx = makeCtx({ mode: 'chat', searchApiKey: undefined });

  await assert.rejects(async () => webSearchTool.execute({ query: 'test' }, ctx), /not configured/);
});

test('web_search returns results from Tavily', async () => {
  mockFetch({
    'api.tavily.com/search': {
      body: {
        answer: 'React Hooks are...',
        results: [
          { title: 'React Docs', url: 'https://react.dev/hooks', content: 'Hooks are...' },
          { title: 'Tutorial', url: 'https://example.com/tut', content: 'Learn hooks...' },
        ],
      },
    },
  });

  const ctx = makeCtx({ mode: 'chat', searchApiKey: 'tvly-test-key' });
  const result = await webSearchTool.execute({ query: 'react hooks', maxResults: 5 }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).provider, 'tavily');
    assert.equal((result as any).results.length, 2);
    assert.equal((result as any).results[0].title, 'React Docs');
  }

  restoreFetch();
});

test('read_url returns text content from HTML', async () => {
  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>Test</title></head><body><h1>Hello</h1><p>World</p></body></html>',
    },
  });

  const ctx = makeCtx({ mode: 'chat' });
  const result = await readUrlTool.execute({ url: 'https://example.com' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).format, 'text');
    assert.ok((result as any).content.includes('Hello'));
    assert.ok((result as any).content.includes('World'));
  }

  restoreFetch();
});

test('read_url returns JSON for JSON endpoints', async () => {
  mockFetch({
    'api.example.com': {
      headers: { 'content-type': 'application/json' },
      body: { hello: 'world', count: 42 },
    },
  });

  const ctx = makeCtx({ mode: 'chat' });
  const result = await readUrlTool.execute({ url: 'https://api.example.com' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).format, 'json');
    assert.ok((result as any).content.includes('"hello": "world"'));
  }

  restoreFetch();
});

test('read_url returns error for 404', async () => {
  mockFetch({
    'notfound.example.com': {
      status: 404,
      body: 'Not Found',
    },
  });

  const ctx = makeCtx({ mode: 'chat' });
  const result = await readUrlTool.execute({ url: 'https://notfound.example.com' }, ctx);

  assert.equal(result.ok, false);
  assert.ok((result as any).error.includes('404'));

  restoreFetch();
});

test('read_url supports format=markdown', async () => {
  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: '<h1>Title</h1><p>Paragraph</p><a href="https://x.com">Link</a>',
    },
  });

  const ctx = makeCtx({ mode: 'chat' });
  const result = await readUrlTool.execute({ url: 'https://example.com', format: 'markdown' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).format, 'markdown');
    assert.ok((result as any).content.includes('# Title'));
    assert.ok((result as any).content.includes('[Link]'));
  }

  restoreFetch();
});

test('scrape_page returns structured data', async () => {
  const html = `
    <html>
    <head>
      <title>Test Page</title>
      <meta name="description" content="A test page">
      <meta property="og:title" content="OG Title">
    </head>
    <body>
      <nav>Navigation</nav>
      <main>
        <h1>Main Heading</h1>
        <h2>Subheading</h2>
        <p>This is the main content of the page.</p>
        <a href="/about">About</a>
        <a href="https://external.com">External</a>
        <img src="/img.png" alt="Test image" width="100" height="50">
        <ul><li>Item 1</li><li>Item 2</li></ul>
      </main>
      <footer>Footer</footer>
    </body>
    </html>
  `;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute({ url: 'https://example.com' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.url, 'https://example.com');
    assert.equal(r.title, 'Test Page');
    assert.ok(r.metadata);
    assert.equal(r.metadata.description, 'A test page');
    assert.equal(r.metadata['og:title'], 'OG Title');
    assert.ok(r.headings.length >= 2);
    assert.equal(r.headings[0].level, 1);
    assert.equal(r.headings[0].text, 'Main Heading');
    assert.ok(r.content.includes('main content'));
    assert.ok(!r.content.includes('Navigation'));
    assert.ok(!r.content.includes('Footer'));
    assert.ok(r.links.length >= 2);
    assert.ok(r.links.some((l: any) => l.url === 'https://example.com/about'));
    assert.ok(r.links.some((l: any) => l.url === 'https://external.com'));
    assert.ok(r.images.length >= 1);
    assert.equal(r.images[0].alt, 'Test image');
    assert.equal(r.images[0].width, 100);
  }

  restoreFetch();
});

test('scrape_page respects extract filter', async () => {
  const html = `<html><head><title>T</title></head><body><h1>H</h1><p>content</p></body></html>`;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute(
    {
      url: 'https://example.com',
      extract: ['title'],
    },
    ctx,
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.title, 'T');
    assert.equal(r.headings, undefined);
    assert.equal(r.content, undefined);
    assert.equal(r.links, undefined);
  }

  restoreFetch();
});

test('scrape_page extracts tables', async () => {
  const html = `
    <html><body>
    <table>
      <caption>Sales</caption>
      <tr><th>Month</th><th>Revenue</th></tr>
      <tr><td>Jan</td><td>$1000</td></tr>
      <tr><td>Feb</td><td>$1500</td></tr>
    </table>
    </body></html>
  `;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute(
    {
      url: 'https://example.com',
      extract: ['tables'],
    },
    ctx,
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.tables);
    assert.equal(r.tables.length, 1);
    assert.equal(r.tables[0].caption, 'Sales');
    assert.equal(r.tables[0].rows.length, 3);
    assert.deepEqual(r.tables[0].rows[0], ['Month', 'Revenue']);
  }

  restoreFetch();
});

test('scrape_page extracts code blocks with language', async () => {
  const html = `
    <html><body>
    <pre><code class="language-typescript">const x: number = 42;</code></pre>
    <pre>plain text</pre>
    </body></html>
  `;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute(
    {
      url: 'https://example.com',
      extract: ['code'],
    },
    ctx,
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.codeBlocks);
    assert.equal(r.codeBlocks.length, 2);
    assert.equal(r.codeBlocks[0].language, 'typescript');
    assert.ok(r.codeBlocks[0].code.includes('const x'));
  }

  restoreFetch();
});

test('scrape_page returns error for non-HTML', async () => {
  mockFetch({
    'api.example.com': {
      headers: { 'content-type': 'application/json' },
      body: { hello: 'world' },
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute({ url: 'https://api.example.com' }, ctx);

  assert.equal(result.ok, false);
  assert.ok((result as any).error.includes('only supports HTML'));

  restoreFetch();
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 4: INTENT DETECTION (description quality)
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 4. INTENT DETECTION (description quality) =======');

test('web_search description mentions search and web', () => {
  const desc = webSearchTool.description.toLowerCase();
  assert.ok(desc.includes('search'), 'should mention "search"');
  assert.ok(desc.includes('web'), 'should mention "web"');
  assert.ok(
    desc.includes('documentation') || desc.includes('examples') || desc.includes('information'),
    'should mention what to search for',
  );
});

test('web_search description warns against using it for URLs', () => {
  const desc = webSearchTool.description.toLowerCase();
  assert.ok(desc.includes('url') || desc.includes('do not'), 'should mention URL anti-pattern');
});

test('read_url description mentions fetch and content', () => {
  const desc = readUrlTool.description.toLowerCase();
  assert.ok(desc.includes('fetch'), 'should mention "fetch"');
  assert.ok(desc.includes('content') || desc.includes('text'), 'should mention "content"/"text"');
});

test('read_url description distinguishes from scrape_page', () => {
  const desc = readUrlTool.description.toLowerCase();
  assert.ok(desc.includes('scrape_page'), 'should mention scrape_page as alternative');
});

test('scrape_page description mentions analyze and structured', () => {
  const desc = scrapePageTool.description.toLowerCase();
  assert.ok(desc.includes('analyze') || desc.includes('extract'), 'should mention analyze/extract');
  assert.ok(desc.includes('structured'), 'should mention structured');
});

test('scrape_page description restricts to work mode', () => {
  const desc = scrapePageTool.description.toLowerCase();
  assert.ok(desc.includes('work mode'), 'should mention work mode');
});

test('every tool has a non-trivial description (>100 chars)', () => {
  const all = toolRegistry.listAllTools();

  for (const t of all) {
    assert.ok(t.description.length > 100, `${t.name} description too short (${t.description.length} chars)`);
  }
});

test('every tool name is snake_case', () => {
  const all = toolRegistry.listAllTools();

  for (const t of all) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${t.name} is not snake_case`);
  }
});

test('every tool name is unique', () => {
  const all = toolRegistry.listAllTools();
  const names = all.map((t) => t.name);
  const unique = new Set(names);
  assert.equal(names.length, unique.size, 'Duplicate tool names detected');
});

test('every tool has at least one mode in availableIn', () => {
  const all = toolRegistry.listAllTools();

  for (const t of all) {
    assert.ok(t.availableIn.length > 0, `${t.name} has no modes in availableIn`);
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 5: CROSS-MODE INTEGRITY
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 5. CROSS-MODE INTEGRITY =======');

/**
 * The exact tool set each mode exposes.
 *
 * This was a has/notHas pair, and both halves drifted: the office tools were
 * deliberately widened to every mode (a user in /chat who asks for a PDF
 * should get one), `create_md` was added, and `create_document` and
 * `format_table` were replaced — but the lists still described the shape of
 * the registry two changes ago, naming tools that no longer exist.
 *
 * An exact set cannot drift halfway. A tool that appears where it should not,
 * or vanishes from where it should be, fails the same assertion, and the diff
 * names it.
 */
const MODE_TOOLS: Record<ToolMode, string[]> = {
  chat: [
    'web_search',
    'read_url',
    'create_pdf',
    'create_docx',
    'create_xlsx',
    'create_md',
    'read_document',
    'generate_image',
  ],
  work: [
    'web_search',
    'read_url',
    'scrape_page',
    'deep_search',
    'read_and_extract',
    'create_pdf',
    'create_docx',
    'create_xlsx',
    'create_md',
    'read_document',
    'make_chart',
    'build_table',
    'analyze_data',
    'generate_image',
  ],
  code: [
    'web_search',
    'read_url',
    'create_pdf',
    'create_docx',
    'create_xlsx',
    'create_md',
    'read_document',
    'read_file',
    'list_files',
    'grep',
    'run_shell',
    'screenshot',
    'read_sandbox_file',
    'generate_image',
  ],
};

for (const mode of ['chat', 'work', 'code'] as ToolMode[]) {
  test(`mode=${mode}: exposes exactly its tools`, () => {
    const names = toolRegistry.listToolsForMode(mode).map((t) => t.name);
    assert.deepEqual([...names].sort(), [...MODE_TOOLS[mode]].sort());
  });

  /*
   * `listToolsForMode` strips `availableIn`, so the listing and the
   * declaration are two separate readings of the same fact — worth checking
   * they agree in both directions, not just one.
   */
  test(`mode=${mode}: the listing matches what each tool declares`, () => {
    const listed = new Set(toolRegistry.listToolsForMode(mode).map((t) => t.name));

    for (const t of toolRegistry.listAllTools()) {
      assert.equal(
        listed.has(t.name),
        isToolAvailableInMode(t, mode),
        `${t.name}: listed for ${mode}=${listed.has(t.name)} but declares ${JSON.stringify(t.availableIn)}`,
      );
    }
  });
}

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 6: EDGE CASES
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 6. EDGE CASES =======');

test('read_url handles empty response body', async () => {
  mockFetch({
    'empty.example.com': {
      headers: { 'content-type': 'text/html' },
      body: '',
    },
  });

  const ctx = makeCtx({ mode: 'chat' });
  const result = await readUrlTool.execute({ url: 'https://empty.example.com' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).content, '');
  }

  restoreFetch();
});

test('scrape_page handles page with no main content', async () => {
  mockFetch({
    'empty.example.com': {
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>Empty</title></head><body></body></html>',
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute({ url: 'https://empty.example.com' }, ctx);

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;

    // Title is still extracted (it's in <head>, not in <main>)
    assert.equal(r.title, 'Empty');

    // No <main>/<article> → content extraction returns undefined
    assert.equal(r.content, undefined);

    // No headings, links, images
    assert.equal(r.headings, undefined);
    assert.equal(r.links, undefined);
    assert.equal(r.images, undefined);
  }

  restoreFetch();
});

test('scrape_page handles relative URLs in links', async () => {
  const html = `<html><body><a href="/about">About</a><a href="https://ext.com">Ext</a></body></html>`;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute(
    {
      url: 'https://example.com',
      extract: ['links'],
    },
    ctx,
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.links[0].url, 'https://example.com/about');
    assert.equal(r.links[1].url, 'https://ext.com');
  }

  restoreFetch();
});

test('scrape_page deduplicates links by URL', async () => {
  const html = `<html><body>
    <a href="/about">About</a>
    <a href="/about">About again</a>
    <a href="https://ext.com">Ext</a>
  </body></html>`;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute(
    {
      url: 'https://example.com',
      extract: ['links'],
    },
    ctx,
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.links.length, 2);
  }

  restoreFetch();
});

test('scrape_page skips javascript: and mailto: links', async () => {
  const html = `<html><body>
    <a href="javascript:alert(1)">JS</a>
    <a href="mailto:test@example.com">Email</a>
    <a href="#anchor">Anchor</a>
    <a href="/real">Real</a>
  </body></html>`;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const ctx = makeCtx({ mode: 'work' });
  const result = await scrapePageTool.execute(
    {
      url: 'https://example.com',
      extract: ['links'],
    },
    ctx,
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.links.length, 1);
    assert.equal(r.links[0].url, 'https://example.com/real');
  }

  restoreFetch();
});
