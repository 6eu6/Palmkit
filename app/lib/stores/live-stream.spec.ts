import { describe, expect, it } from 'vitest';
import { applyLiveChunks, type LiveStreamState } from './live-stream';

const empty: LiveStreamState = {
  text: '',
  thinking: '',
  thinkingStartedAt: 0,
  tool: null,
  active: false,
  updatedAt: 0,
};

describe('applyLiveChunks', () => {
  it('accumulates text deltas token by token', () => {
    let s = applyLiveChunks(empty, [{ t: 'd', x: 'Buil' }], 1);
    s = applyLiveChunks(
      s,
      [
        { t: 'd', x: 'ding the ' },
        { t: 'd', x: 'app' },
      ],
      2,
    );

    expect(s.text).toBe('Building the app');
    expect(s.active).toBe(true);
  });

  it('records the in-flight tool with its detail', () => {
    const s = applyLiveChunks(empty, [{ t: 'tool', n: 'write_files', d: '8 files' }], 1);

    expect(s.tool).toEqual({ name: 'write_files', detail: '8 files' });
  });

  it('clears text and tool on a step boundary', () => {
    let s = applyLiveChunks(empty, [
      { t: 'd', x: 'thinking…' },
      { t: 'tool', n: 'run_shell', d: 'npm install' },
    ]);
    s = applyLiveChunks(s, [{ t: 'step' }]);

    expect(s.text).toBe('');
    expect(s.tool).toBeNull();
  });

  it('caps the tail so an unbounded stream cannot grow memory', () => {
    let s = empty;

    for (let i = 0; i < 100; i++) {
      s = applyLiveChunks(s, [{ t: 'd', x: 'x'.repeat(100) }]);
    }

    expect(s.text.length).toBeLessThanOrEqual(4000);
  });

  it('ignores malformed chunks without touching state', () => {
    const s = applyLiveChunks(empty, [null as never, { t: 'd' }, { t: 'tool' } as never, {} as never]);

    expect(s).toBe(empty);
  });
});
