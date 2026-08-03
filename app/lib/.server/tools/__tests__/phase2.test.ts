/**
 * Phase 2 Test Suite — Office + Analytics Tools
 * ==============================================
 *
 * Categories:
 *   1. Schema validation for all 6 new tools
 *   2. Tool execution (with real markdown → HTML conversion)
 *   3. Mode filtering (Phase 2 tools only in work mode)
 *   4. Intent detection (description quality)
 *   5. Cross-tool integrity (no overlap, correct names)
 *   6. Edge cases (empty data, mismatched rows, etc.)
 *
 * Run with: pnpm run test:tools:phase2
 */

import assert from 'node:assert/strict';
import { createPdfSchema } from '~/lib/.server/tools/schemas/create-pdf';
import { createDocxSchema } from '~/lib/.server/tools/schemas/create-docx';
import { createXlsxSchema } from '~/lib/.server/tools/schemas/create-xlsx';
import { readDocumentSchema } from '~/lib/.server/tools/schemas/read-document';
import { makeChartSchema } from '~/lib/.server/tools/schemas/make-chart';
import { buildTableSchema } from '~/lib/.server/tools/schemas/build-table';
import { toolRegistry } from '~/lib/.server/tools/registry';
import type { ToolContext } from '~/lib/.server/tools/types';
import { createPdfTool } from '~/lib/.server/tools/office/create-pdf';
import { createDocxTool } from '~/lib/.server/tools/office/create-docx';
import { createXlsxTool } from '~/lib/.server/tools/office/create-xlsx';
import { readDocumentTool } from '~/lib/.server/tools/office/read-document';
import { makeChartTool } from '~/lib/.server/tools/analytics/make-chart';
import { buildTableTool } from '~/lib/.server/tools/analytics/build-table';

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

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { mode: 'work', ...overrides };
}

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 1: SCHEMA VALIDATION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 1. SCHEMA VALIDATION =======');

test('create_pdf schema accepts minimal input', () => {
  const r = createPdfSchema.safeParse({ title: 'My Report', content: '# Hello' });
  assert.ok(r.success);
});

test('create_pdf schema rejects empty title', () => {
  const r = createPdfSchema.safeParse({ title: '', content: 'x' });
  assert.ok(!r.success);
});

test('create_pdf schema rejects empty content', () => {
  const r = createPdfSchema.safeParse({ title: 'T', content: '' });
  assert.ok(!r.success);
});

test('create_pdf schema accepts optional author + subject', () => {
  const r = createPdfSchema.safeParse({
    title: 'T',
    content: 'C',
    author: 'Jane',
    subject: 'Subj',
  });
  assert.ok(r.success);
});

test('create_pdf schema rejects title > 200 chars', () => {
  const r = createPdfSchema.safeParse({ title: 'a'.repeat(201), content: 'c' });
  assert.ok(!r.success);
});

test('create_docx schema accepts minimal input', () => {
  const r = createDocxSchema.safeParse({ title: 'Doc', content: '# H1' });
  assert.ok(r.success);
});

test('create_docx schema accepts headings=numbered', () => {
  const r = createDocxSchema.safeParse({ title: 'Doc', content: 'x', headings: 'numbered' });
  assert.ok(r.success);
});

test('create_docx schema rejects invalid headings value', () => {
  const r = createDocxSchema.safeParse({ title: 'Doc', content: 'x', headings: 'invalid' as any });
  assert.ok(!r.success);
});

test('create_xlsx schema accepts single sheet', () => {
  const r = createXlsxSchema.safeParse({
    sheets: [{ name: 'Sheet1', headers: ['A', 'B'], rows: [['x', 1]] }],
  });
  assert.ok(r.success);
});

test('create_xlsx schema accepts multiple sheets', () => {
  const r = createXlsxSchema.safeParse({
    sheets: [
      { name: 'A', headers: ['x'], rows: [[1]] },
      { name: 'B', headers: ['y'], rows: [[2]] },
    ],
  });
  assert.ok(r.success);
});

test('create_xlsx schema rejects > 10 sheets', () => {
  const sheets = Array.from({ length: 11 }, (_, i) => ({
    name: `S${i}`,
    headers: ['x'],
    rows: [[1]],
  }));
  const r = createXlsxSchema.safeParse({ sheets });
  assert.ok(!r.success);
});

test('create_xlsx schema rejects sheet name > 31 chars', () => {
  const r = createXlsxSchema.safeParse({
    sheets: [{ name: 'a'.repeat(32), headers: ['x'], rows: [[1]] }],
  });
  assert.ok(!r.success);
});

test('create_xlsx schema accepts null cells', () => {
  const r = createXlsxSchema.safeParse({
    sheets: [{ name: 'S', headers: ['x', 'y'], rows: [[1, null]] }],
  });
  assert.ok(r.success);
});

test('read_document schema accepts minimal input', () => {
  const r = readDocumentSchema.safeParse({
    filename: 'test.txt',
    contentBase64: 'aGVsbG8=',
  });
  assert.ok(r.success);
});

test('read_document schema rejects empty filename', () => {
  const r = readDocumentSchema.safeParse({ filename: '', contentBase64: 'x' });
  assert.ok(!r.success);
});

test('read_document schema rejects empty contentBase64', () => {
  const r = readDocumentSchema.safeParse({ filename: 'x.txt', contentBase64: '' });
  assert.ok(!r.success);
});

test('make_chart schema accepts bar chart', () => {
  const r = makeChartSchema.safeParse({
    type: 'bar',
    title: 'Sales',
    labels: ['Jan', 'Feb'],
    datasets: [{ label: 'Revenue', data: [100, 200] }],
  });
  assert.ok(r.success);
});

test('make_chart schema rejects invalid type', () => {
  const r = makeChartSchema.safeParse({
    type: 'invalid' as any,
    title: 'X',
    labels: ['a'],
    datasets: [{ label: 'Y', data: [1] }],
  });
  assert.ok(!r.success);
});

test('make_chart schema rejects empty labels', () => {
  const r = makeChartSchema.safeParse({
    type: 'bar',
    title: 'X',
    labels: [],
    datasets: [{ label: 'Y', data: [] }],
  });
  assert.ok(!r.success);
});

test('make_chart schema accepts multiple datasets', () => {
  const r = makeChartSchema.safeParse({
    type: 'line',
    title: 'X',
    labels: ['a', 'b'],
    datasets: [
      { label: 'A', data: [1, 2] },
      { label: 'B', data: [3, 4] },
    ],
  });
  assert.ok(r.success);
});

test('build_table schema accepts minimal input', () => {
  const r = buildTableSchema.safeParse({
    headers: ['A', 'B'],
    rows: [['x', 'y']],
  });
  assert.ok(r.success);
});

test('build_table schema accepts format=html', () => {
  const r = buildTableSchema.safeParse({
    headers: ['A'],
    rows: [['x']],
    format: 'html',
  });
  assert.ok(r.success);
});

test('build_table schema rejects > 20 headers', () => {
  const r = buildTableSchema.safeParse({
    headers: Array.from({ length: 21 }, (_, i) => `col${i}`),
    rows: [['x']],
  });
  assert.ok(!r.success);
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 2: TOOL EXECUTION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 2. TOOL EXECUTION =======');

test('create_pdf generates valid HTML with title', async () => {
  const result = await createPdfTool.execute(
    {
      title: 'Quarterly Report',
      content: '# Introduction\n\nThis is the **first** section.',
      author: 'Jane Doe',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.content.includes('<!DOCTYPE html>'));
    assert.ok(r.content.includes('Quarterly Report'));
    assert.ok(r.content.includes('Jane Doe'));
    assert.ok(r.content.includes('<h1>Introduction</h1>'));
    assert.ok(r.content.includes('<strong>first</strong>'));
    assert.ok(r.filename.endsWith('.html'));
    assert.equal(r.mimeType, 'text/html');
  }
});

test('create_pdf handles page breaks', async () => {
  const result = await createPdfTool.execute(
    {
      title: 'T',
      content: 'Page 1\n\n---page-break---\n\nPage 2',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.ok((result as any).content.includes('page-break-after'));
  }
});

test('create_pdf handles tables in markdown', async () => {
  const result = await createPdfTool.execute(
    {
      title: 'T',
      content: '| Col1 | Col2 |\n| --- | --- |\n| a | b |',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const c = (result as any).content;
    assert.ok(c.includes('<table>'));
    assert.ok(c.includes('<th>Col1</th>'));
    assert.ok(c.includes('<td>a</td>'));
  }
});

test('create_docx generates Word-compatible HTML', async () => {
  const result = await createDocxTool.execute(
    {
      title: 'Memo',
      content: '# Subject\n\nBody text here.',
      author: 'Bob',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.content.includes('xmlns:o="urn:schemas-microsoft-com:office:office"'));
    assert.ok(r.content.includes('WordDocument'));
    assert.ok(r.content.includes('Memo'));
    assert.ok(r.filename.endsWith('.doc'));
    assert.equal(r.mimeType, 'application/msword');
  }
});

test('create_docx supports numbered headings', async () => {
  const result = await createDocxTool.execute(
    {
      title: 'T',
      content: '# One\n\n## Two\n\n### Three',
      headings: 'numbered',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const c = (result as any).content;
    assert.ok(c.includes('1. One'));
    assert.ok(c.includes('1.1. Two'));
    assert.ok(c.includes('1.1.1. Three'));
  }
});

test('create_xlsx generates CSV from structured data', async () => {
  const result = await createXlsxTool.execute(
    {
      filename: 'sales',
      sheets: [
        {
          name: 'Q1',
          headers: ['Month', 'Revenue'],
          rows: [
            ['Jan', 1000],
            ['Feb', 1500],
            ['Mar', 2000],
          ],
        },
      ],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.content.includes('Month,Revenue'));
    assert.ok(r.content.includes('Jan,1000'));
    assert.ok(r.content.includes('Feb,1500'));
    assert.ok(r.filename.endsWith('.csv'));
    assert.equal(r.mimeType, 'text/csv');
    assert.equal(r.totalRows, 3);
    assert.equal(r.totalCols, 2);
  }
});

test('create_xlsx handles multiple sheets', async () => {
  const result = await createXlsxTool.execute(
    {
      sheets: [
        { name: 'A', headers: ['x'], rows: [[1]] },
        { name: 'B', headers: ['y'], rows: [[2]] },
      ],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.content.includes('# Sheet: A'));
    assert.ok(r.content.includes('# Sheet: B'));
    assert.equal(r.sheets.length, 2);
  }
});

test('create_xlsx properly escapes commas in CSV', async () => {
  const result = await createXlsxTool.execute(
    {
      sheets: [
        {
          name: 'S',
          headers: ['name'],
          rows: [['Smith, John']],
        },
      ],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.ok((result as any).content.includes('"Smith, John"'));
  }
});

test('create_xlsx rejects mismatched row width', async () => {
  const result = await createXlsxTool.execute(
    {
      sheets: [
        {
          name: 'S',
          headers: ['a', 'b', 'c'],
          rows: [['x', 'y']], // only 2 cells, headers has 3
        },
      ],
    },
    makeCtx(),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('row 1 has 2 cells'));
  }
});

test('read_document reads plain text', async () => {
  // "Hello, World!" in base64
  const b64 = Buffer.from('Hello, World!').toString('base64');
  const result = await readDocumentTool.execute(
    {
      filename: 'test.txt',
      contentBase64: b64,
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.format, 'text');
    assert.equal(r.content, 'Hello, World!');
    assert.equal(r.originalLength, 13);
  }
});

test('read_document reads markdown', async () => {
  const md = '# Title\n\nSome **bold** text.';
  const b64 = Buffer.from(md).toString('base64');
  const result = await readDocumentTool.execute(
    {
      filename: 'doc.md',
      contentBase64: b64,
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).content, md);
  }
});

test('read_document returns pdfExtractionRequired for PDF', async () => {
  /*
   * %PDF-1.4 magic bytes — server returns ok=true with pdfExtractionRequired flag
   * The client renderer then offers an "Extract text" button using pdfjs-dist
   */
  const pdfBytes = Buffer.from('%PDF-1.4\n%binary\n');
  const b64 = pdfBytes.toString('base64');
  const result = await readDocumentTool.execute(
    {
      filename: 'file.pdf',
      contentBase64: b64,
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.format, 'pdf');
    assert.equal(r.pdfExtractionRequired, true);
    assert.ok(r.pdfContentBase64, 'should include base64 for client-side extraction');
    assert.ok(r.hint);
  }
});

test('read_document handles JSON files', async () => {
  const json = JSON.stringify({ name: 'test', value: 42 }, null, 2);
  const b64 = Buffer.from(json).toString('base64');
  const result = await readDocumentTool.execute(
    {
      filename: 'data.json',
      contentBase64: b64,
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).format, 'text');
    assert.ok((result as any).content.includes('"name": "test"'));
  }
});

test('make_chart generates bar chart config', async () => {
  const result = await makeChartTool.execute(
    {
      type: 'bar',
      title: 'Sales by Quarter',
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      datasets: [{ label: 'Revenue', data: [100, 200, 150, 300] }],
      yAxisLabel: 'USD',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.chartType, 'bar');
    assert.equal(r.title, 'Sales by Quarter');
    assert.equal(r.renderer, 'chart.js');
    assert.equal(r.labelsCount, 4);
    assert.equal(r.datasetsCount, 1);

    // Config should be valid Chart.js v4
    assert.equal(r.config.type, 'bar');
    assert.ok(r.config.data.labels.includes('Q1'));
    assert.equal(r.config.data.datasets[0].data[0], 100);
    assert.ok(r.config.options.plugins.title.display);
    assert.ok(r.config.options.scales.y.title.display);
  }
});

test('make_chart auto-assigns colors when omitted', async () => {
  const result = await makeChartTool.execute(
    {
      type: 'bar',
      title: 'X',
      labels: ['a', 'b'],
      datasets: [{ label: 'Y', data: [1, 2] }],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(r.config.data.datasets[0].backgroundColor);
  }
});

test('make_chart assigns per-slice colors for pie', async () => {
  const result = await makeChartTool.execute(
    {
      type: 'pie',
      title: 'Distribution',
      labels: ['A', 'B', 'C'],
      datasets: [{ label: 'X', data: [30, 50, 20] }],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.ok(Array.isArray(r.config.data.datasets[0].backgroundColor));
    assert.equal(r.config.data.datasets[0].backgroundColor.length, 3);
  }
});

test('make_chart rejects mismatched data length', async () => {
  const result = await makeChartTool.execute(
    {
      type: 'bar',
      title: 'X',
      labels: ['a', 'b', 'c'],
      datasets: [{ label: 'Y', data: [1, 2] }], // only 2 values
    },
    makeCtx(),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('2 values'));
  }
});

test('make_chart rejects multi-dataset pie', async () => {
  const result = await makeChartTool.execute(
    {
      type: 'pie',
      title: 'X',
      labels: ['a', 'b'],
      datasets: [
        { label: 'A', data: [1, 2] },
        { label: 'B', data: [3, 4] },
      ],
    },
    makeCtx(),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('single dataset'));
  }
});

test('build_table generates markdown table', async () => {
  const result = await buildTableTool.execute(
    {
      headers: ['Name', 'Age'],
      rows: [
        ['Alice', 30],
        ['Bob', 25],
      ],
      caption: 'Team Members',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.format, 'markdown');
    assert.ok(r.content.includes('**Team Members**'));
    assert.ok(r.content.includes('| Name | Age |'));
    assert.ok(r.content.includes('| --- | --- |'));
    assert.ok(r.content.includes('| Alice | 30 |'));
    assert.equal(r.rows, 2);
    assert.equal(r.columns, 2);
  }
});

test('build_table generates HTML format', async () => {
  const result = await buildTableTool.execute(
    {
      headers: ['A'],
      rows: [['x']],
      format: 'html',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.format, 'html');
    assert.ok(r.content.includes('<table>'));
    assert.ok(r.content.includes('<th>A</th>'));
    assert.ok(r.content.includes('<td>x</td>'));
  }
});

test('build_table generates CSV format', async () => {
  const result = await buildTableTool.execute(
    {
      headers: ['A', 'B'],
      rows: [
        ['x', 'y'],
        ['1', '2'],
      ],
      format: 'csv',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.format, 'csv');
    assert.ok(r.content.includes('A,B'));
    assert.ok(r.content.includes('x,y'));
  }
});

test('build_table handles null cells', async () => {
  const result = await buildTableTool.execute(
    {
      headers: ['A', 'B'],
      rows: [['x', null]],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    // Empty cell between pipes
    assert.ok((result as any).content.includes('| x |  |'));
  }
});

test('build_table rejects mismatched row width', async () => {
  const result = await buildTableTool.execute(
    {
      headers: ['a', 'b', 'c'],
      rows: [['x', 'y']],
    },
    makeCtx(),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('Row 1'));
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 3: MODE FILTERING
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 3. MODE FILTERING =======');

/*
 * Making a document is a chat and /work job. Reading one is not.
 *
 * These shipped work-mode-only, were widened to every mode because "make
 * that a PDF" is something people ask wherever they are, and then had to
 * come back out of /code. A tool called `create_md` reads like "create a
 * file" to a model building a project, and it is not one: it returns a
 * document to download. Asked for a restaurant landing page, the model
 * called create_md with filename "index.html" four times in a row, nothing
 * reached the project, and it kept trying. Project files are file actions.
 *
 * `read_document` stays everywhere — a user dropping a spec into /code is
 * exactly when reading one is useful.
 */
const DOCUMENT_TOOLS = ['create_pdf', 'create_docx', 'create_xlsx', 'create_md'];
const ANALYTICS_TOOLS = ['make_chart', 'build_table'];

test('documents can be created from chat and work, but not in a project', () => {
  for (const mode of ['chat', 'work'] as const) {
    const names = toolRegistry.listToolsForMode(mode).map((t) => t.name);

    for (const name of DOCUMENT_TOOLS) {
      assert.ok(names.includes(name), `${name} should be in ${mode} mode`);
    }
  }

  const code = toolRegistry.listToolsForMode('code').map((t) => t.name);

  for (const name of DOCUMENT_TOOLS) {
    assert.ok(!code.includes(name), `${name} must NOT be in code mode — it competes with the file action`);
  }
});

test('reading a document is still possible while building', () => {
  const code = toolRegistry.listToolsForMode('code').map((t) => t.name);
  assert.ok(code.includes('read_document'));
});

test('analytics tools stay in work mode', () => {
  const inMode = (m: 'chat' | 'work' | 'code') => toolRegistry.listToolsForMode(m).map((t) => t.name);

  for (const name of ANALYTICS_TOOLS) {
    assert.ok(inMode('work').includes(name), `${name} should be in work mode`);
    assert.ok(!inMode('chat').includes(name), `${name} should NOT be in chat mode`);
    assert.ok(!inMode('code').includes(name), `${name} should NOT be in code mode`);
  }
});

test('Phase 2 native tools replaced legacy adapters', () => {
  const workTools = toolRegistry.listToolsForMode('work').map((t) => t.name);

  // create_document → create_pdf + create_docx
  assert.ok(!workTools.includes('create_document'), 'legacy create_document should be removed');
  assert.ok(workTools.includes('create_pdf'), 'create_pdf should replace it');
  assert.ok(workTools.includes('create_docx'), 'create_docx should replace it');

  // format_table → build_table
  assert.ok(!workTools.includes('format_table'), 'legacy format_table should be removed');
  assert.ok(workTools.includes('build_table'), 'build_table should replace it');
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 4: INTENT DETECTION
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 4. INTENT DETECTION =======');

test('create_pdf description mentions PDF and report', () => {
  const desc = createPdfTool.description.toLowerCase();
  assert.ok(desc.includes('pdf'), 'should mention PDF');
  assert.ok(desc.includes('report') || desc.includes('document'), 'should mention report/document');
});

test('create_pdf description distinguishes from create_xlsx and create_docx', () => {
  const desc = createPdfTool.description.toLowerCase();
  assert.ok(desc.includes('create_xlsx') || desc.includes('spreadsheets'), 'should mention xlsx/spreadsheets');
  assert.ok(desc.includes('create_docx') || desc.includes('word'), 'should mention docx/word');
});

test('create_docx description mentions Word', () => {
  const desc = createDocxTool.description.toLowerCase();
  assert.ok(desc.includes('word') || desc.includes('.docx'), 'should mention Word/.docx');
  assert.ok(desc.includes('editable'), 'should mention editable');
});

test('create_xlsx description mentions spreadsheet', () => {
  const desc = createXlsxTool.description.toLowerCase();
  assert.ok(desc.includes('spreadsheet') || desc.includes('excel'), 'should mention spreadsheet/excel');
});

test('read_document description mentions extract', () => {
  const desc = readDocumentTool.description.toLowerCase();
  assert.ok(desc.includes('extract'), 'should mention extract');
  assert.ok(desc.includes('pdf') || desc.includes('docx') || desc.includes('txt'), 'should mention file types');
});

test('make_chart description mentions visualize', () => {
  const desc = makeChartTool.description.toLowerCase();
  assert.ok(desc.includes('visualize') || desc.includes('chart'), 'should mention visualize/chart');
  assert.ok(desc.includes('bar') && desc.includes('line'), 'should mention chart types');
});

test('build_table description mentions table format', () => {
  const desc = buildTableTool.description.toLowerCase();
  assert.ok(desc.includes('table'), 'should mention table');
  assert.ok(desc.includes('markdown'), 'should mention markdown');
});

test('every Phase 2 tool has description > 100 chars', () => {
  const phase2Tools = [createPdfTool, createDocxTool, createXlsxTool, readDocumentTool, makeChartTool, buildTableTool];

  for (const t of phase2Tools) {
    assert.ok(t.description.length > 100, `${t.name} description too short (${t.description.length})`);
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 5: CROSS-TOOL INTEGRITY
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 5. CROSS-TOOL INTEGRITY =======');

test('all Phase 2 tool names are snake_case', () => {
  const phase2Tools = [createPdfTool, createDocxTool, createXlsxTool, readDocumentTool, makeChartTool, buildTableTool];

  for (const t of phase2Tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${t.name} is not snake_case`);
  }
});

test('all Phase 2 tools have unique names', () => {
  const all = toolRegistry.listAllTools();
  const names = all.map((t) => t.name);
  const unique = new Set(names);
  assert.equal(names.length, unique.size, 'Duplicate tool names detected');
});

test('each Phase 2 tool declares the modes it is meant for', () => {
  const expected: [{ name: string; availableIn: ReadonlyArray<string> }, string[]][] = [
    [createPdfTool, ['chat', 'work']],
    [createDocxTool, ['chat', 'work']],
    [createXlsxTool, ['chat', 'work']],
    [readDocumentTool, ['chat', 'work', 'code']],
    [makeChartTool, ['work']],
    [buildTableTool, ['work']],
  ];

  for (const [tool, modes] of expected) {
    assert.deepEqual([...tool.availableIn], modes, `${tool.name} declares ${JSON.stringify([...tool.availableIn])}`);
  }
});

/*
 * ════════════════════════════════════════════════════════════════════
 * CATEGORY 6: EDGE CASES
 * ════════════════════════════════════════════════════════════════════
 */

console.log('\n======= 6. EDGE CASES =======');

test('create_pdf handles special characters in title', async () => {
  const result = await createPdfTool.execute(
    {
      title: 'Report: "Q3 <2024>" & Beyond',
      content: 'Body',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    // Should be HTML-escaped
    assert.ok((result as any).content.includes('&quot;Q3 &lt;2024&gt;&quot;'));
    assert.ok((result as any).content.includes('&amp;'));
  }
});

test('create_pdf handles code blocks', async () => {
  const result = await createPdfTool.execute(
    {
      title: 'T',
      content: '```python\nprint("hello")\n```',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const c = (result as any).content;
    assert.ok(c.includes('<pre><code'));
    assert.ok(c.includes('language-python'));
    assert.ok(c.includes('print('));
  }
});

test('create_xlsx handles empty rows array', async () => {
  const result = await createXlsxTool.execute(
    {
      sheets: [{ name: 'S', headers: ['a'], rows: [] }],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).totalRows, 0);
  }
});

test('create_xlsx handles boolean values', async () => {
  const result = await createXlsxTool.execute(
    {
      sheets: [
        {
          name: 'S',
          headers: ['flag'],
          rows: [[true], [false]],
        },
      ],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.ok((result as any).content.includes('TRUE'));
    assert.ok((result as any).content.includes('FALSE'));
  }
});

test('make_chart handles single data point', async () => {
  const result = await makeChartTool.execute(
    {
      type: 'bar',
      title: 'X',
      labels: ['only'],
      datasets: [{ label: 'Y', data: [42] }],
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal((result as any).labelsCount, 1);
  }
});

test('build_table handles boolean cells as checkmarks', async () => {
  const result = await buildTableTool.execute(
    {
      headers: ['done'],
      rows: [[true], [false]],
      format: 'markdown',
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.ok((result as any).content.includes('✓'));
    assert.ok((result as any).content.includes('✗'));
  }
});

test('read_document handles empty file', async () => {
  const b64 = Buffer.from('').toString('base64');
  const result = await readDocumentTool.execute(
    {
      filename: 'empty.txt',
      contentBase64: b64,
    },
    makeCtx(),
  );

  assert.equal(result.ok, false);

  if (!result.ok) {
    assert.ok(result.error.includes('empty'));
  }
});

test('read_document respects maxLength', async () => {
  const longText = 'x'.repeat(30000);
  const b64 = Buffer.from(longText).toString('base64');
  const result = await readDocumentTool.execute(
    {
      filename: 'big.txt',
      contentBase64: b64,
      maxLength: 5000,
    },
    makeCtx(),
  );

  assert.equal(result.ok, true);

  if (result.ok) {
    const r = result as any;
    assert.equal(r.truncated, true);
    assert.ok(r.content.length < 6000); // ~5000 + truncation marker
  }
});
