/**
 * Phase 3 Test Suite — generate_image, analyze_data, deep_search, read_and_extract
 * ==================================================================================
 *
 * Categories:
 *   1. Schema validation (Zod schemas accept/reject correct inputs)
 *   2. Tool execution (each tool's execute() with mocked fetch)
 *   3. Mode filtering (Phase 3 tools only in work mode)
 *   4. Intent detection (description quality)
 *   5. Cross-tool integrity (no overlap, correct names)
 *   6. Edge cases (empty data, malformed input, etc.)
 *   7. Legacy replacement verification (legacy tools are gone)
 *
 * Run with: pnpm run test:tools:phase3
 */

import assert from 'node:assert/strict';
import { ASPECT_RATIOS, generateImageSchema, resolveAspectRatio } from '~/lib/.server/tools/schemas/generate-image';
import { analyzeDataSchema } from '~/lib/.server/tools/schemas/analyze-data';
import { deepSearchSchema } from '~/lib/.server/tools/schemas/deep-search';
import { readAndExtractSchema, READ_AND_EXTRACT_DEFAULT_FIELDS } from '~/lib/.server/tools/schemas/read-and-extract';
import { toolRegistry } from '~/lib/.server/tools/registry';
import type { ToolContext } from '~/lib/.server/tools/types';
import { generateImageTool } from '~/lib/.server/tools/creative/generate-image';
import { analyzeDataTool } from '~/lib/.server/tools/analytics/analyze-data';
import { deepSearchTool } from '~/lib/.server/tools/investigative/deep-search';
import { readAndExtractTool } from '~/lib/.server/tools/investigative/read-and-extract';

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
  return { mode: 'work', ...overrides };
}

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 1: SCHEMA VALIDATION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 1. SCHEMA VALIDATION =======');

test('generate_image schema accepts minimal prompt', () => {
  const r = generateImageSchema.safeParse({ prompt: 'a red apple' });
  assert.ok(r.success);
});

test('generate_image schema rejects prompt < 3 chars', () => {
  const r = generateImageSchema.safeParse({ prompt: 'ab' });
  assert.ok(!r.success);
});

test('generate_image schema rejects prompt > 2000 chars', () => {
  const r = generateImageSchema.safeParse({ prompt: 'a'.repeat(2001) });
  assert.ok(!r.success);
});

test('generate_image schema accepts every aspect ratio it offers', () => {
  for (const r of ASPECT_RATIOS) {
    assert.ok(generateImageSchema.safeParse({ prompt: 'test', aspectRatio: r }).success, `${r} should be valid`);
  }
});

test('generate_image schema rejects a shape it cannot produce', () => {
  assert.ok(!generateImageSchema.safeParse({ prompt: 'test', aspectRatio: '2:1' as any }).success);
});

/*
 * The old pixel sizes are still accepted, because a model that learned the
 * old schema keeps emitting them and the nearest working shape beats a 400.
 */
test('the old pixel sizes resolve to the shape they were reaching for', () => {
  const cases: Record<string, string> = {
    '1024x1024': '1:1',
    '1344x768': '16:9',
    '1440x720': '16:9',
    '768x1344': '9:16',
    '720x1440': '9:16',
    '1152x864': '4:3',
    '864x1152': '3:4',
  };

  for (const [size, expected] of Object.entries(cases)) {
    assert.ok(generateImageSchema.safeParse({ prompt: 'test', size }).success, `size ${size} should still parse`);
    assert.equal(resolveAspectRatio({ size }), expected, `${size} should read as ${expected}`);
  }
});

test('a size nobody offered is measured, not rejected', () => {
  assert.equal(resolveAspectRatio({ size: '1600x900' }), '16:9');
  assert.equal(resolveAspectRatio({ size: '900x1600' }), '9:16');
  assert.equal(resolveAspectRatio({ size: '800x600' }), '4:3');
  assert.equal(resolveAspectRatio({ size: '512x512' }), '1:1');
  assert.equal(resolveAspectRatio({ size: 'nonsense' }), '1:1');
  assert.equal(resolveAspectRatio({}), '1:1');
});

test('an explicit aspectRatio wins over a legacy size', () => {
  assert.equal(resolveAspectRatio({ aspectRatio: '3:4', size: '1440x720' }), '3:4');
});

test('generate_image schema accepts transparent flag', () => {
  const r = generateImageSchema.safeParse({ prompt: 'logo', transparent: true });
  assert.ok(r.success);
});

test('analyze_data schema accepts CSV string', () => {
  const r = analyzeDataSchema.safeParse({ data: 'name,age\nAlice,30' });
  assert.ok(r.success);
});

test('analyze_data schema accepts JSON string', () => {
  const r = analyzeDataSchema.safeParse({ data: '[{"a":1}]' });
  assert.ok(r.success);
});

test('analyze_data schema rejects empty data', () => {
  const r = analyzeDataSchema.safeParse({ data: '' });
  assert.ok(!r.success);
});

test('analyze_data schema accepts format + delimiter', () => {
  const r = analyzeDataSchema.safeParse({ data: 'a;b', format: 'csv', delimiter: ';' });
  assert.ok(r.success);
});

test('analyze_data schema rejects invalid format', () => {
  const r = analyzeDataSchema.safeParse({ data: 'x', format: 'xml' as any });
  assert.ok(!r.success);
});

test('deep_search schema accepts minimal topic', () => {
  const r = deepSearchSchema.safeParse({ topic: 'React hooks' });
  assert.ok(r.success);
});

test('deep_search schema rejects empty topic', () => {
  const r = deepSearchSchema.safeParse({ topic: '' });
  assert.ok(!r.success);
});

test('deep_search schema accepts depth variations', () => {
  for (const d of ['quick', 'standard', 'thorough'] as const) {
    const r = deepSearchSchema.safeParse({ topic: 'test', depth: d });
    assert.ok(r.success, `depth ${d} should be valid`);
  }
});

test('deep_search schema rejects invalid depth', () => {
  const r = deepSearchSchema.safeParse({ topic: 'test', depth: 'invalid' as any });
  assert.ok(!r.success);
});

test('read_and_extract schema accepts URL', () => {
  const r = readAndExtractSchema.safeParse({ url: 'https://example.com' });
  assert.ok(r.success);
});

test('read_and_extract schema rejects invalid URL', () => {
  const r = readAndExtractSchema.safeParse({ url: 'not-a-url' });
  assert.ok(!r.success);
});

test('read_and_extract schema accepts extract array', () => {
  const r = readAndExtractSchema.safeParse({ url: 'https://example.com', extract: ['title', 'content'] });
  assert.ok(r.success);
});

test('read_and_extract schema rejects invalid extract field', () => {
  const r = readAndExtractSchema.safeParse({ url: 'https://example.com', extract: ['invalid' as any] });
  assert.ok(!r.success);
});

test('READ_AND_EXTRACT_DEFAULT_FIELDS has 5 fields', () => {
  assert.equal(READ_AND_EXTRACT_DEFAULT_FIELDS.length, 5);
  assert.ok(READ_AND_EXTRACT_DEFAULT_FIELDS.includes('title'));
  assert.ok(READ_AND_EXTRACT_DEFAULT_FIELDS.includes('keyPoints'));
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 2: TOOL EXECUTION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 2. TOOL EXECUTION =======');

/*
 * Three bugs shipped in generate_image at once, and each was silent: the
 * model chose the tool correctly, wrote a good prompt, and the user got an
 * error about a missing config file. These cover all three.
 */

const imageRoute = async () => ({
  model: 'google/gemini-2.5-flash-image',
  descriptor: {} as never,
  reason: 'test',
});

test('generate_image says so plainly when no key is connected', async () => {
  const result = await generateImageTool.execute({ prompt: 'a red apple' }, makeCtx({ apiKeys: {} }));

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.match(result.error, /no openrouter key/i);
    assert.match(result.hint ?? '', /Model providers/);
  }
});

test('generate_image reads the key from the account, not the environment', async () => {
  let sawAuth = '';
  mockFetch({ 'openrouter.ai': { status: 401, body: 'Unauthorized' } });

  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    sawAuth = new Headers(init?.headers).get('authorization') ?? '';
    return original(url, init);
  }) as any;

  await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({ apiKeys: { OpenRouter: 'user-key' }, routeModel: imageRoute }),
  );

  assert.equal(sawAuth, 'Bearer user-key', "must send the signed-in user's key");
  restoreFetch();
});

/*
 * The bug that made every call fail: /images/generations requires `model`,
 * and the old code never sent one, so the endpoint answered 400 every time.
 */
test('generate_image sends the model field the endpoint requires', async () => {
  let body: any = null;
  mockFetch({ 'openrouter.ai': { status: 200, body: { data: [{ b64_json: 'aGk=' }] } } });

  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    body = JSON.parse(init.body);
    return original(url, init);
  }) as any;

  const result = await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  assert.equal(body?.model, 'google/gemini-2.5-flash-image');
  assert.equal(result.ok, true);

  if (result.ok) {
    // 'aGk=' is not an image, so the sniffer reports what it truly is.
    assert.match(result.dataUrl as string, /^data:application\/octet-stream;base64,/);
    assert.equal(result.model, 'google/gemini-2.5-flash-image');
  }

  restoreFetch();
});

/*
 * The result used to be labelled data:image/png no matter what came back.
 * gemini-3.1-flash-lite-image returns JPEG, so a download saved JPEG bytes
 * under a .png name. The header decides the label now.
 */
/*
 * The result travels two ways at once: to the browser, which needs the
 * pixels, and back into the model's context, which does not. A 673KB JPEG is
 * about 224,000 tokens of base64 against a 204,800 context, so returning it
 * inline made "an image, then a video from it" impossible — the second turn
 * had nowhere to fit.
 */
test('generate_image returns a link, not the whole picture', async () => {
  mockFetch({ 'openrouter.ai': { status: 200, body: { data: [{ b64_json: 'aGk=' }] } } });

  const result = await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({
      apiKeys: { OpenRouter: 'k' },
      routeModel: imageRoute,
      storeMedia: async () => ({ url: 'https://p.supabase.co/stored/1.jpg', path: 'u/1.jpg' }),
    }),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.url, 'https://p.supabase.co/stored/1.jpg');
    assert.equal(result.dataUrl, null, 'the picture itself must not be in the result');
  }
});

test('generate_image still returns the image inline when storage is unavailable', async () => {
  mockFetch({ 'openrouter.ai': { status: 200, body: { data: [{ b64_json: 'aGk=' }] } } });

  const result = await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute, storeMedia: async () => undefined }),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.url, null);
    assert.match(result.dataUrl as string, /^data:/);
  }
});

test('generate_image labels JPEG bytes as JPEG', async () => {
  // Minimal JPEG: SOI, then a SOF0 declaring 1024x1024.
  const jpeg = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x00, 0x04, 0x00, 0x03, 0x01, 0x11, 0x00];
  const b64 = Buffer.from(jpeg).toString('base64');

  mockFetch({ 'openrouter.ai': { status: 200, body: { data: [{ b64_json: b64 }] } } });

  const result = await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.format, 'image/jpeg');
    assert.match(result.dataUrl as string, /^data:image\/jpeg;base64,/);

    // Dimensions read from the header, not echoed from the request.
    assert.equal(result.size, '1024x1024');
  }

  restoreFetch();
});

test('generate_image still labels PNG bytes as PNG', async () => {
  // PNG signature + IHDR declaring 512x256.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    (() => {
      const b = Buffer.alloc(8);
      b.writeUInt32BE(512, 0);
      b.writeUInt32BE(256, 4);

      return b;
    })(),
  ]);

  mockFetch({ 'openrouter.ai': { status: 200, body: { data: [{ b64_json: png.toString('base64') }] } } });

  const result = await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.format, 'image/png');
    assert.equal(result.size, '512x256');
  }

  restoreFetch();
});

/*
 * Without `size` the provider chooses its own shape — 1408x768 rather than
 * the square that was requested — so it must be sent. But the two families
 * disagree about what a size is, and six of the seven the schema used to
 * offer were refused by both. Measured against OpenRouter:
 *
 *   gemini-3.1-flash-lite-image  1024x1024 ok, 1344x768 400, 1440x720 400
 *   gpt-5-image-mini             "Supported sizes are 1024x1024,
 *                                 1024x1536, 1536x1024, and auto."
 *
 * So the shape is resolved to a size the chosen model takes.
 */
function captureBodies(status = 200, body: unknown = { data: [{ b64_json: 'aGk=' }] }) {
  const sent: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as any;

  return sent;
}

test('generate_image sends a size the chosen model accepts', async () => {
  const sent = captureBodies();

  await generateImageTool.execute(
    { prompt: 'a red apple', aspectRatio: '16:9' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  /* Gemini reads a size as a ratio plus a tier; over 1024 on either axis is refused. */
  assert.equal(sent.length, 1, 'a known family should not need a retry');
  assert.equal(sent[0]?.size, '1024x576');
  restoreFetch();
});

test('generate_image sends OpenAI its own size vocabulary', async () => {
  const sent = captureBodies();

  await generateImageTool.execute(
    { prompt: 'a red apple', aspectRatio: '16:9' },
    makeCtx({
      apiKeys: { OpenRouter: 'k' },
      routeModel: async () => ({ model: 'openai/gpt-5-image-mini', descriptor: {} as never, reason: 'test' }),
    }),
  );

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.size, '1536x1024');
  restoreFetch();
});

test('a legacy pixel size still reaches a size that works', async () => {
  const sent = captureBodies();

  await generateImageTool.execute(
    { prompt: 'a red apple', size: '1440x720' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  /* The request that used to come back as 'does not support aspect_ratio "2:1"'. */
  assert.equal(sent[0]?.size, '1024x576');
  restoreFetch();
});

test('generate_image tries another size when the provider rejects the shape', async () => {
  const sent: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    sent.push(JSON.parse(init.body));

    if (sent.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'Image size 2K is not supported for this model' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data: [{ b64_json: 'aGk=' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  const result = await generateImageTool.execute(
    { prompt: 'a red apple', aspectRatio: '4:3' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  assert.equal(result.ok, true, 'a size complaint should not end the attempt');
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1].size, sent[0].size, 'the retry should change the size, not repeat it');
  restoreFetch();
});

test('the last attempt drops the size rather than failing', async () => {
  const sent: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sent.push(body);

    if (body.size) {
      return new Response(JSON.stringify({ error: { message: 'Request contains an invalid argument.' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data: [{ b64_json: 'aGk=' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  const result = await generateImageTool.execute(
    { prompt: 'a red apple', aspectRatio: '9:16' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  assert.equal(result.ok, true, 'a provider default beats no image at all');
  assert.equal(sent.at(-1)?.size, undefined);
  restoreFetch();
});

/*
 * A rejected key says the same thing whatever shape the picture is, so
 * retrying it just spends the user's time.
 */
test('generate_image does not retry a failure that is not about size', async () => {
  const sent = captureBodies(401, 'Unauthorized');

  const result = await generateImageTool.execute(
    { prompt: 'a red apple', aspectRatio: '16:9' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: imageRoute }),
  );

  assert.equal(result.ok, false);
  assert.equal(sent.length, 1);
  restoreFetch();
});

test('generate_image reports a routing failure instead of calling blindly', async () => {
  const result = await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({ apiKeys: { OpenRouter: 'k' }, routeModel: async () => undefined }),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.match(result.error, /no image-generating model/i);
  }
});

test('generate_image explains a rejected key', async () => {
  mockFetch({ 'openrouter.ai': { status: 401, body: 'Unauthorized' } });

  const result = await generateImageTool.execute(
    { prompt: 'a red apple' },
    makeCtx({ apiKeys: { OpenRouter: 'invalid' }, routeModel: imageRoute }),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.match(result.error, /401/);
    assert.match(result.hint ?? '', /Replace it/);
  }

  restoreFetch();
});

test('analyze_data parses simple CSV', async () => {
  const csv = 'name,age\nAlice,30\nBob,25\nCarol,35';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.format, 'csv');
    assert.equal(r.totalRows, 3);
    assert.equal(r.totalColumns, 2);
    assert.equal(r.columns.age.type, 'numeric');
    assert.equal(r.columns.age.min, 25);
    assert.equal(r.columns.age.max, 35);
    assert.equal(r.columns.age.mean, 30);
    assert.equal(r.columns.name.type, 'text');
    assert.equal(r.columns.name.unique, 3);
  }
});

test('analyze_data parses JSON array', async () => {
  const json = '[{"name":"Alice","age":30},{"name":"Bob","age":25}]';
  const result = await analyzeDataTool.execute({ data: json }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.format, 'json');
    assert.equal(r.totalRows, 2);
    assert.equal(r.columns.age.type, 'numeric');
  }
});

test('analyze_data computes standard deviation', async () => {
  // values: 10, 20, 30, 40, 50 → mean=30, variance=200, stddev≈14.14
  const csv = 'val\n10\n20\n30\n40\n50';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.columns.val.stddev > 14 && r.columns.val.stddev < 15);
  }
});

test('analyze_data detects outliers', async () => {
  // values: 1, 2, 3, 4, 5, 200 → mean≈35.83, stddev≈73.4, 200 is > 2 stddevs from mean (z≈2.23)
  const csv = 'val\n1\n2\n3\n4\n5\n200';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.columns.val.outliers >= 1, `expected outliers, got ${r.columns.val.outliers}`);

    // Insights should mention the outlier
    assert.ok(r.insights.some((i: string) => i.includes('outlier')));
  }
});

test('analyze_data detects constant column', async () => {
  const csv = 'status\nactive\nactive\nactive';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.insights.some((i: string) => i.includes('constant column')));
  }
});

test('analyze_data detects ID column (all unique text)', async () => {
  /*
   * Use TEXT IDs (not numbers) so the column is detected as 'text' type,
   * then the `unique === values.length && values.length > 5` check fires.
   */
  const csv = 'id\nA001\nA002\nA003\nA004\nA005\nA006\nA007';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.columns.id.type, 'text');
    assert.equal(r.columns.id.unique, 7);
    assert.ok(
      r.insights.some((i: string) => i.includes('ID column')),
      `expected ID column insight, got: ${JSON.stringify(r.insights)}`,
    );
  }
});

test('analyze_data handles CSV with quoted fields', async () => {
  const csv = 'name,note\n"Alice, Jr.","hello"\n"Bob","world, test"';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.totalRows, 2);

    // "Alice, Jr." should be a single value, not split
    assert.equal(r.sample[0].name, 'Alice, Jr.');
  }
});

test('analyze_data auto-detects semicolon delimiter', async () => {
  const csv = 'name;age\nAlice;30\nBob;25';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.delimiter, ';');
    assert.equal(r.totalColumns, 2);
  }
});

test('analyze_data handles mixed-type column', async () => {
  const csv = 'val\n1\n2\nthree\n4\nfive';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;

    // >50% numeric but not all → mixed
    assert.equal(r.columns.val.type, 'mixed');
  }
});

test('analyze_data rejects malformed JSON', async () => {
  const result = await analyzeDataTool.execute({ data: '{invalid json' }, makeCtx());
  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('JSON'));
  }
});

test('analyze_data rejects CSV with only header', async () => {
  const result = await analyzeDataTool.execute({ data: 'name,age' }, makeCtx());
  assert.equal(result.ok, false);
});

test('deep_search generates query variations', async () => {
  // Without search API key, uses DuckDuckGo fallback
  mockFetch({
    'duckduckgo.com': {
      headers: { 'content-type': 'text/html' },
      body: '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle">Test Article</a><a class="result__snippet">This is a test snippet about React hooks.</a>',
    },
  });

  const result = await deepSearchTool.execute({ topic: 'React hooks', depth: 'quick' }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.depth, 'quick');
    assert.ok(r.queriesUsed.length >= 2); // quick = 2 queries
    assert.ok(Array.isArray(r.results));
    assert.ok(Array.isArray(r.findings));
  }

  restoreFetch();
});

test('deep_search respects depth parameter', async () => {
  mockFetch({
    'duckduckgo.com': {
      headers: { 'content-type': 'text/html' },
      body: '',
    },
  });

  const quick = await deepSearchTool.execute({ topic: 'test', depth: 'quick' }, makeCtx());
  const standard = await deepSearchTool.execute({ topic: 'test', depth: 'standard' }, makeCtx());
  const thorough = await deepSearchTool.execute({ topic: 'test', depth: 'thorough' }, makeCtx());

  if (quick.ok) {
    assert.equal((quick as any).queriesUsed.length, 2);
  }

  if (standard.ok) {
    assert.equal((standard as any).queriesUsed.length, 3);
  }

  if (thorough.ok) {
    assert.equal((thorough as any).queriesUsed.length, 5);
  }

  restoreFetch();
});

test('read_and_extract returns structured data', async () => {
  const html = `
    <html><head>
      <title>Test Page</title>
      <meta name="description" content="A test page">
      <meta property="og:title" content="OG Title">
    </head><body>
      <main>
        <h1>Main Heading</h1>
        <p>This is the first paragraph about the topic. It contains important information.</p>
        <p>The second paragraph continues the discussion with more details and context.</p>
        <p>Finally, a third paragraph summarizes the key takeaways from this article.</p>
        <a href="/about">About</a>
        <a href="https://external.com">External</a>
        <img src="/img.png" alt="Test image">
        <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
      </main>
    </body></html>
  `;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const result = await readAndExtractTool.execute({ url: 'https://example.com' }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.title, 'Test Page');
    assert.ok(r.metadata);
    assert.equal(r.metadata.description, 'A test page');
    assert.ok(r.content.includes('Main Heading'));
    assert.ok(Array.isArray(r.keyPoints));
    assert.ok(r.keyPoints.length > 0, 'should extract at least 1 key point');
    assert.ok(r.links.length >= 1);
    assert.ok(r.images.length >= 1);
    assert.ok(r.tables.length >= 1);
  }

  restoreFetch();
});

test('read_and_extract respects extract filter', async () => {
  const html = `<html><head><title>T</title></head><body><p>content</p></body></html>`;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const result = await readAndExtractTool.execute(
    {
      url: 'https://example.com',
      extract: ['title'],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.title, 'T');
    assert.equal(r.content, undefined);
    assert.equal(r.keyPoints, undefined);
    assert.equal(r.links, undefined);
  }

  restoreFetch();
});

test('read_and_extract returns error for non-HTML', async () => {
  mockFetch({
    'api.example.com': {
      headers: { 'content-type': 'application/json' },
      body: { hello: 'world' },
    },
  });

  const result = await readAndExtractTool.execute({ url: 'https://api.example.com' }, makeCtx());

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('HTML'));
  }

  restoreFetch();
});

test('read_and_extract returns error for 404', async () => {
  mockFetch({
    'notfound.example.com': {
      status: 404,
      body: 'Not Found',
    },
  });

  const result = await readAndExtractTool.execute({ url: 'https://notfound.example.com' }, makeCtx());

  assert.equal(result.ok, false);
  assert.ok((result as any).error.includes('404'));

  restoreFetch();
});

test('read_and_extract keyPoints are sentences', async () => {
  const html = `
    <html><head><title>React Hooks Guide</title></head><body><main>
      <p>React hooks are functions that let you use state and lifecycle features in functional components.</p>
      <p>The most common hooks are useState and useEffect, which handle state and side effects respectively.</p>
      <p>Hooks were introduced in React 16.8 and have become the standard way to write React components.</p>
    </main></body></html>
  `;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const result = await readAndExtractTool.execute(
    {
      url: 'https://example.com',
      extract: ['title', 'content', 'keyPoints'],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.keyPoints.length > 0);

    // Key points should be actual sentences (end with .)
    for (const point of r.keyPoints) {
      assert.ok(point.length > 20, `key point too short: "${point}"`);
      assert.ok(
        point.endsWith('.') || point.endsWith('!') || point.endsWith('?'),
        `key point should end with punctuation: "${point}"`,
      );
    }
  }

  restoreFetch();
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 3: MODE FILTERING
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 3. MODE FILTERING =======');

/*
 * `generate_image` reaches every mode; the research and analysis tools do
 * not. "Draw me a logo" is something people ask wherever they are, and a
 * work-mode-only image tool meant that request had no tool at all in /chat —
 * so the model apologised instead of drawing. Deep research and CSV analysis
 * are different: they answer a question you opened /work to ask.
 */
test('generate_image is available in every mode', () => {
  for (const mode of ['chat', 'work', 'code'] as const) {
    const names = toolRegistry.listToolsForMode(mode).map((t) => t.name);
    assert.ok(names.includes('generate_image'), `generate_image should be in ${mode} mode`);
  }
});

test('the research and analysis tools stay in work mode', () => {
  const inMode = (m: 'chat' | 'work' | 'code') => toolRegistry.listToolsForMode(m).map((t) => t.name);

  for (const name of ['analyze_data', 'deep_search', 'read_and_extract']) {
    assert.ok(inMode('work').includes(name), `${name} should be in work mode`);
    assert.ok(!inMode('chat').includes(name), `${name} should NOT be in chat mode`);
    assert.ok(!inMode('code').includes(name), `${name} should NOT be in code mode`);
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 4: INTENT DETECTION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 4. INTENT DETECTION =======');

test('generate_image description mentions image and prompt', () => {
  const desc = generateImageTool.description.toLowerCase();
  assert.ok(desc.includes('image'), 'should mention image');
  assert.ok(desc.includes('prompt') || desc.includes('description'), 'should mention prompt/description');
  assert.ok(desc.includes('logos') || desc.includes('illustration'), 'should mention use cases');
});

test('generate_image description distinguishes from make_chart', () => {
  const desc = generateImageTool.description.toLowerCase();
  assert.ok(desc.includes('make_chart') || desc.includes('charts'), 'should mention make_chart anti-pattern');
});

test('analyze_data description mentions statistical insights', () => {
  const desc = analyzeDataTool.description.toLowerCase();
  assert.ok(desc.includes('statistical') || desc.includes('stats') || desc.includes('analysis'));
  assert.ok(desc.includes('csv') || desc.includes('json'));
});

test('analyze_data description distinguishes from make_chart and build_table', () => {
  const desc = analyzeDataTool.description.toLowerCase();
  assert.ok(desc.includes('make_chart') || desc.includes('build_table'));
});

test('deep_search description mentions research', () => {
  const desc = deepSearchTool.description.toLowerCase();
  assert.ok(desc.includes('research') || desc.includes('comprehensive'));
  assert.ok(desc.includes('multi-query') || desc.includes('multiple'));
});

test('deep_search description distinguishes from web_search', () => {
  const desc = deepSearchTool.description.toLowerCase();
  assert.ok(desc.includes('web_search'), 'should mention web_search as alternative');
});

test('read_and_extract description mentions extract', () => {
  const desc = readAndExtractTool.description.toLowerCase();
  assert.ok(desc.includes('extract'));
  assert.ok(desc.includes('key points') || desc.includes('keypoints'));
});

test('read_and_extract description distinguishes from read_url and scrape_page', () => {
  const desc = readAndExtractTool.description.toLowerCase();
  assert.ok(desc.includes('read_url'), 'should mention read_url');
  assert.ok(desc.includes('scrape_page'), 'should mention scrape_page');
});

test('every Phase 3 tool has description > 100 chars', () => {
  const phase3Tools = [generateImageTool, analyzeDataTool, deepSearchTool, readAndExtractTool];

  for (const t of phase3Tools) {
    assert.ok(t.description.length > 100, `${t.name} too short`);
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 5: CROSS-TOOL INTEGRITY
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 5. CROSS-TOOL INTEGRITY =======');

test('all Phase 3 tool names are snake_case', () => {
  const phase3Tools = [generateImageTool, analyzeDataTool, deepSearchTool, readAndExtractTool];

  for (const t of phase3Tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${t.name} not snake_case`);
  }
});

test('each Phase 3 tool declares the modes it is meant for', () => {
  assert.deepEqual([...generateImageTool.availableIn], ['chat', 'work', 'code']);

  for (const t of [analyzeDataTool, deepSearchTool, readAndExtractTool]) {
    assert.deepEqual([...t.availableIn], ['work'], `${t.name} should be work-only`);
  }
});

test('all tool names remain unique', () => {
  const all = toolRegistry.listAllTools();
  const names = all.map((t) => t.name);
  const unique = new Set(names);
  assert.equal(names.length, unique.size, 'duplicates found');
});

/*
 * The whole registry is asserted by name, once, in phase1 — ALL_TOOL_NAMES
 * and MODE_TOOLS. Three of these four files each carried their own running
 * total of it as well ("19 total", "13 work", "8 code"), and every one of
 * them went stale the day `create_md` was added, all saying the same
 * uninformative thing: a number moved. One exact set beats four counts, so
 * what stays here is what is actually about Phase 3.
 */

const PHASE_3_TOOLS = ['generate_image', 'analyze_data', 'deep_search', 'read_and_extract'];

test('the Phase 3 tools are registered, once each', () => {
  const names = toolRegistry.listAllTools().map((t) => t.name);

  for (const name of PHASE_3_TOOLS) {
    assert.equal(names.filter((n) => n === name).length, 1, `${name} should be registered exactly once`);
  }
});

test('the Phase 3 tools are in work mode', () => {
  const names = toolRegistry.listToolsForMode('work').map((t) => t.name);

  for (const name of PHASE_3_TOOLS) {
    assert.ok(names.includes(name), `${name} should be in work mode`);
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 6: EDGE CASES
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 6. EDGE CASES =======');

test('analyze_data handles single-row CSV', async () => {
  const csv = 'name,age\nAlice,30';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).totalRows, 1);
  }
});

test('analyze_data handles tab-separated', async () => {
  const tsv = 'name\tage\nAlice\t30\nBob\t25';
  const result = await analyzeDataTool.execute({ data: tsv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.delimiter, '\t');
    assert.equal(r.totalColumns, 2);
  }
});

test('analyze_data handles missing values', async () => {
  const csv = 'name,age\nAlice,30\nBob,\nCarol,35';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.totalRows, 3);
    assert.equal(r.columns.age.missing, 1);
  }
});

test('analyze_data handles large numeric range', async () => {
  const csv = 'val\n0\n1000000\n500000';
  const result = await analyzeDataTool.execute({ data: csv }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.columns.val.min, 0);
    assert.equal(r.columns.val.max, 1000000);
  }
});

test('deep_search returns findings even with empty results', async () => {
  mockFetch({
    'duckduckgo.com': {
      headers: { 'content-type': 'text/html' },
      body: '',
    },
  });

  const result = await deepSearchTool.execute({ topic: 'nonexistent topic xyz123' }, makeCtx());

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.findings.length > 0); // at least the "no results" finding
  }

  restoreFetch();
});

test('read_and_extract handles page with no main container', async () => {
  const html = `<html><head><title>Plain</title></head><body><p>Just text.</p></body></html>`;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const result = await readAndExtractTool.execute(
    {
      url: 'https://example.com',
      extract: ['title', 'content'],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.title, 'Plain');
    assert.ok(r.content.includes('Just text'));
  }

  restoreFetch();
});

test('read_and_extract skips layout tables (1-row)', async () => {
  const html = `<html><body>
    <table><tr><td>layout</td></tr></table>
    <table><tr><th>A</th></tr><tr><td>1</td></tr><tr><td>2</td></tr></table>
  </body></html>`;

  mockFetch({
    'example.com': {
      headers: { 'content-type': 'text/html' },
      body: html,
    },
  });

  const result = await readAndExtractTool.execute(
    {
      url: 'https://example.com',
      extract: ['tables'],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;

    // Only the 3-row table should be returned (1-row layout table skipped)
    assert.equal(r.tables.length, 1);
  }

  restoreFetch();
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 7: LEGACY REPLACEMENT VERIFICATION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 7. LEGACY REPLACEMENT VERIFICATION =======');

/*
 * Each Phase 3 tool replaced a legacy adapter of the same name. The public
 * API cannot tell you which one you are holding, so the original test proved
 * it indirectly, by counting: if both had survived the total would be higher.
 * A count that also moves when an unrelated tool is added proves nothing, so
 * check the thing itself — a name registered twice is the overlap.
 */
test('no tool name is registered twice', () => {
  const names = toolRegistry.listAllTools().map((t) => t.name);
  assert.deepEqual(names, [...new Set(names)], 'a duplicate name means a legacy adapter survived its replacement');
});

test('code mode has its six sandbox tools', () => {
  const names = toolRegistry.listToolsForMode('code').map((t) => t.name);

  for (const name of ['read_file', 'list_files', 'grep', 'run_shell', 'screenshot', 'read_sandbox_file']) {
    assert.ok(names.includes(name), `${name} should be in code mode`);
  }

  // Search reaches every mode; the sandbox tools reach only this one.
  assert.ok(names.includes('web_search') && names.includes('read_url'));
});
