import { describe, expect, it } from 'vitest';
import { foldEvents } from './BuildStream';
import type { WorkerEvent } from '~/lib/stores/build-status';

let seq = 0;

function ev(type: string, message: string, payload: Record<string, unknown> = {}): WorkerEvent {
  return {
    id: `ev-${seq}`,
    type,
    seq: seq++,
    message,
    payload,
    created_at: new Date(1700000000000 + seq * 1000).toISOString(),
  } as unknown as WorkerEvent;
}

function start(): WorkerEvent {
  return ev('agent_started', '🤖 Palmkit agent starting...', { agent: 'Palmkit', role: 'brain' });
}

describe('foldEvents live status', () => {
  it('renders agent_thinking as a trailing progress row while it is the latest signal', () => {
    const sections = foldEvents([
      start(),
      ev('file_chunk', '🧠 Palmkit is processing your request (0.2KB, ~51 tokens)...', {
        agent: 'Palmkit',
        kind: 'agent_thinking',
      }),
    ]);

    const rows = sections.flatMap((s) => s.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'progress' });
    expect((rows[0] as { text: string }).text).toContain('processing your request');
  });

  it('renders a trailing heartbeat as the live status row', () => {
    const sections = foldEvents([
      start(),
      ev('reasoning', '💭 Palmkit: Building', { agent: 'Palmkit', text: 'Building the app', stepId: 0 }),
      ev('file_chunk', '⏳ Building... (41s)'),
    ]);

    const rows = sections.flatMap((s) => s.rows);
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ kind: 'progress' });
    expect((last as { text: string }).text).toContain('41s');
  });

  it('drops the live status once a real row supersedes it', () => {
    const sections = foldEvents([
      start(),
      ev('file_chunk', '⏳ Building... (41s)'),
      ev('file_written', '📝 src/App.jsx (10 lines)', { path: 'src/App.jsx', lines: 10 }),
    ]);

    const rows = sections.flatMap((s) => s.rows);
    expect(rows.some((r) => r.kind === 'progress')).toBe(false);
    expect(rows.some((r) => r.kind === 'file')).toBe(true);
  });
});

describe('foldEvents status kinds', () => {
  it('renders git checkpoints as system rows', () => {
    const sections = foldEvents([
      start(),
      ev('file_written', '📝 index.html', { path: 'index.html' }),
      ev('file_chunk', '🕘 Checkpoint saved (fd7db1f)', { kind: 'checkpoint', hash: 'fd7db1f' }),
    ]);

    const rows = sections.flatMap((s) => s.rows);
    const sys = rows.find((r) => r.kind === 'system') as { text: string } | undefined;
    expect(sys?.text).toContain('Checkpoint saved (fd7db1f)');
  });

  it('renders salvaged completions and stall retries as system rows', () => {
    const sections = foldEvents([
      start(),
      ev('file_written', '📝 index.html', { path: 'index.html' }),
      ev(
        'file_chunk',
        '✅ Build completed and verified (12 files). A non-essential final step failed and was skipped.',
        {
          kind: 'salvaged_success',
        },
      ),
      ev('file_chunk', '🔁 The model went silent for 400s — restarting the agent (attempt 1/3)…', {
        reason: 'stall_retry',
      }),
    ]);

    const texts = sections.flatMap((s) => s.rows).filter((r) => r.kind === 'system') as Array<{ text: string }>;
    expect(texts.some((r) => r.text.includes('Build completed and verified'))).toBe(true);
    expect(texts.some((r) => r.text.includes('restarting the agent'))).toBe(true);
  });
});
