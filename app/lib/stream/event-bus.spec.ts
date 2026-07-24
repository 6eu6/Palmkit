/**
 * StreamEventBus — unit tests
 *
 * Tests cover:
 *   - Event emission (all kinds)
 *   - Wire format (SSE framing)
 *   - Sequence numbering
 *   - close() behavior
 *   - decodeStreamEvents round-trip
 *   - Partial chunk handling
 */

import { describe, it, expect } from 'vitest';
import { StreamEventBus, decodeStreamEvents } from './event-bus';
import type { StreamEvent } from './types';

describe('StreamEventBus — emission', () => {
  it('emits stream:start with correct payload', async () => {
    const bus = new StreamEventBus();
    bus.emitStreamStart({
      mode: 'discuss',
      intent: 'analyze-repo',
      confidence: 0.95,
      messageId: 'msg-1',
    });
    bus.close();

    const events = await readAllEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'stream:start',
      mode: 'discuss',
      intent: 'analyze-repo',
      confidence: 0.95,
      messageId: 'msg-1',
      seq: 1,
    });
    expect(events[0].ts).toBeTypeOf('number');
  });

  it('emits message:start + message:delta + message:end in order', async () => {
    const bus = new StreamEventBus();
    bus.emitMessageStart({ role: 'assistant', messageId: 'msg-1' });
    bus.emitMessageDelta({ messageId: 'msg-1', text: 'Hello ' });
    bus.emitMessageDelta({ messageId: 'msg-1', text: 'world' });
    bus.emitMessageEnd({ messageId: 'msg-1' });
    bus.close();

    const events = await readAllEvents(bus);
    expect(events.map((e) => e.kind)).toEqual(['message:start', 'message:delta', 'message:delta', 'message:end']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('emits tool:call + tool:result with correlation id', async () => {
    const bus = new StreamEventBus();
    bus.emitToolCall({
      callId: 'call-1',
      toolName: 'read_file',
      args: { path: 'src/App.tsx' },
      icon: 'ph:file-text-duotone',
      label: 'Read src/App.tsx',
    });
    bus.emitToolResult({
      callId: 'call-1',
      ok: true,
      durationMs: 12,
      icon: 'ph:file-text-duotone',
      summary: '32 lines',
    });
    bus.close();

    const events = await readAllEvents(bus);
    expect(events[0]).toMatchObject({
      kind: 'tool:call',
      callId: 'call-1',
      toolName: 'read_file',
    });
    expect(events[1]).toMatchObject({
      kind: 'tool:result',
      callId: 'call-1',
      ok: true,
      durationMs: 12,
    });
  });

  it('emits build:status with all required fields', async () => {
    const bus = new StreamEventBus();
    bus.emitBuildStatus({
      status: 'building',
      message: 'Generating files',
      icon: 'ph:hammer-duotone',
      severity: 'info',
    });
    bus.close();

    const events = await readAllEvents(bus);
    expect(events[0]).toMatchObject({
      kind: 'build:status',
      status: 'building',
      message: 'Generating files',
      icon: 'ph:hammer-duotone',
      severity: 'info',
    });
  });

  it('emits build:retry with attempt counter', async () => {
    const bus = new StreamEventBus();
    bus.emitBuildRetry({
      attempt: 1,
      maxAttempts: 2,
      reason: 'missing package.json',
      icon: 'ph:spinner-duotone',
    });
    bus.close();

    const events = await readAllEvents(bus);
    expect(events[0]).toMatchObject({
      kind: 'build:retry',
      attempt: 1,
      maxAttempts: 2,
      reason: 'missing package.json',
    });
  });

  it('emits stream:end with stats and closes the bus', async () => {
    const bus = new StreamEventBus();
    bus.emitStreamEnd({
      reason: 'complete',
      messageId: 'msg-1',
      stats: { durationMs: 1234, tokenCount: 500, segments: 1 },
    });

    // Further emissions are dropped
    bus.emitMessageStart({ role: 'assistant', messageId: 'msg-2' });

    const events = await readAllEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'stream:end',
      reason: 'complete',
      stats: { durationMs: 1234, tokenCount: 500 },
    });
    expect(bus.isClosed).toBe(true);
  });
});

describe('StreamEventBus — sequence numbering', () => {
  it('increments seq across different event kinds', async () => {
    const bus = new StreamEventBus();
    bus.emitStreamStart({ mode: 'build', intent: 'test', confidence: 1, messageId: 'm1' });
    bus.emitBuildStatus({
      status: 'building',
      message: '...',
      icon: 'ph:hammer-duotone',
      severity: 'info',
    });
    bus.emitBuildFile({ path: 'src/App.tsx', action: 'create', linesAdded: 10 });
    bus.emitStreamEnd({ reason: 'complete', messageId: 'm1' });

    const events = await readAllEvents(bus);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('does not increment seq after close', async () => {
    const bus = new StreamEventBus();
    bus.emitMessageStart({ role: 'user', messageId: 'm1' });
    bus.close();

    const seqBefore = bus.sequence;
    bus.emitMessageDelta({ messageId: 'm1', text: 'dropped' });
    expect(bus.sequence).toBe(seqBefore);
  });
});

describe('decodeStreamEvents — partial chunks', () => {
  it('decodes a single complete event', () => {
    const buffer = { text: '' };
    const chunk = `data: ${JSON.stringify({ kind: 'message:delta', seq: 1, ts: 1000, messageId: 'm1', text: 'hi' })}\n\n`;

    const events = decodeStreamEvents(buffer, chunk);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'message:delta', text: 'hi' });
    expect(buffer.text).toBe('');
  });

  it('handles partial event split across chunks', () => {
    const buffer = { text: '' };
    const json = JSON.stringify({
      kind: 'message:delta',
      seq: 1,
      ts: 1000,
      messageId: 'm1',
      text: 'hello',
    });
    const full = `data: ${json}\n\n`;

    // Split in the middle
    const mid = Math.floor(full.length / 2);
    const chunk1 = full.slice(0, mid);
    const chunk2 = full.slice(mid);

    const events1 = decodeStreamEvents(buffer, chunk1);
    expect(events1).toHaveLength(0); // not complete yet

    const events2 = decodeStreamEvents(buffer, chunk2);
    expect(events2).toHaveLength(1);
    expect(events2[0]).toMatchObject({ kind: 'message:delta', text: 'hello' });
  });

  it('decodes multiple events in one chunk', () => {
    const buffer = { text: '' };
    const e1 = `data: ${JSON.stringify({ kind: 'message:start', seq: 1, ts: 1, role: 'user', messageId: 'm1' })}\n\n`;
    const e2 = `data: ${JSON.stringify({ kind: 'message:delta', seq: 2, ts: 2, messageId: 'm1', text: 'hi' })}\n\n`;
    const e3 = `data: ${JSON.stringify({ kind: 'message:end', seq: 3, ts: 3, messageId: 'm1' })}\n\n`;

    const events = decodeStreamEvents(buffer, e1 + e2 + e3);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(['message:start', 'message:delta', 'message:end']);
  });

  it('skips malformed JSON lines gracefully', () => {
    const buffer = { text: '' };
    const chunk = `data: not-valid-json\n\ndata: ${JSON.stringify({ kind: 'message:end', seq: 1, ts: 1, messageId: 'm1' })}\n\n`;

    const events = decodeStreamEvents(buffer, chunk);
    expect(events).toHaveLength(1); // only the valid one
    expect(events[0].kind).toBe('message:end');
  });

  it('ignores non-data lines (comments, heartbeats)', () => {
    const buffer = { text: '' };
    const chunk = `: heartbeat\n\nevent: ping\ndata: ${JSON.stringify({ kind: 'message:end', seq: 1, ts: 1, messageId: 'm1' })}\n\n`;

    const events = decodeStreamEvents(buffer, chunk);
    expect(events).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────── */
/*  Helpers                                                       */
/* ────────────────────────────────────────────────────────────── */

async function readAllEvents(bus: StreamEventBus): Promise<StreamEvent[]> {
  const reader = bus.response.body!.getReader();
  const decoder = new TextDecoder();
  const buffer = { text: '' };
  const events: StreamEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    const text = decoder.decode(value, { stream: true });
    events.push(...decodeStreamEvents(buffer, text));
  }

  return events;
}
