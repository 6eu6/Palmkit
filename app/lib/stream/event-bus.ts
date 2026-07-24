/**
 * StreamEventBus — server-side event emitter for the new Stream Protocol.
 *
 * Wraps a ReadableStream controller and provides typed `emit()` methods.
 * Every event gets an auto-incrementing `seq` and `ts` for chronological
 * ordering and dedup on the client.
 *
 * Usage:
 *   const bus = new StreamEventBus();
 *   bus.emitStreamStart({ mode: 'discuss', intent: 'analyze', confidence: 0.95, messageId });
 *   bus.emitMessageStart({ role: 'assistant', messageId });
 *   bus.emitMessageDelta({ messageId, text: 'Hello' });
 *   bus.emitMessageEnd({ messageId });
 *   bus.emitStreamEnd({ reason: 'complete', messageId });
 *   bus.close();
 *
 * Then return `bus.response` from your action/loader (it's a Response with
 * the ReadableStream body, content-type text/event-stream).
 */

import type { StreamEvent, StreamMode, StreamIcon, Severity, EventPayload } from './types';

const ENCODER = new TextEncoder();

const SSE_CONTENT_TYPE = 'text/event-stream; charset=utf-8';

export interface StreamEventBusOptions {
  /**
   * Called when the client disconnects (ReadableStream cancel).
   * Use to abort upstream LLM fetches.
   */
  onCancel?: () => void;
}

export class StreamEventBus {
  private _controller!: ReadableStreamDefaultController<Uint8Array>;
  private _seq = 0;
  private _closed = false;
  readonly response: Response;

  constructor(opts: StreamEventBusOptions = {}) {
    const { onCancel } = opts;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this._controller = controller;
      },
      cancel: (reason) => {
        this._closed = true;
        onCancel?.();

        // reason is usually undefined or a string
        void reason;
      },
    });

    this.response = new Response(stream, {
      headers: {
        'Content-Type': SSE_CONTENT_TYPE,
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable nginx buffering
      },
    });
  }

  /**
   * Low-level emit — write any StreamEvent to the wire.
   * Most callers should use the typed helpers below.
   */
  emit<K extends StreamEvent['kind']>(kind: K, payload: EventPayload<K>): void {
    if (this._closed) {
      return;
    }

    const event = {
      kind,
      seq: ++this._seq,
      ts: Date.now(),
      ...payload,
    } as unknown as StreamEvent;

    const line = `data: ${JSON.stringify(event)}\n\n`;

    try {
      this._controller.enqueue(ENCODER.encode(line));
    } catch (err) {
      this._closed = true;

      // controller already closed — swallow
      void err;
    }
  }

  /* ─── Lifecycle ────────────────────────────────────────────── */

  emitStreamStart(p: { mode: StreamMode; intent: string; confidence: number; messageId: string }): void {
    this.emit('stream:start', p);
  }

  emitStreamEnd(p: {
    reason: 'complete' | 'cancelled' | 'error' | 'timeout';
    messageId: string;
    error?: string;
    stats?: { durationMs: number; tokenCount?: number; segments?: number };
  }): void {
    this.emit('stream:end', p);
    this.close();
  }

  /* ─── Messages ─────────────────────────────────────────────── */

  emitMessageStart(p: { role: 'user' | 'assistant'; messageId: string }): void {
    this.emit('message:start', p);
  }

  emitMessageDelta(p: { messageId: string; text: string }): void {
    this.emit('message:delta', p);
  }

  emitMessageEnd(p: { messageId: string }): void {
    this.emit('message:end', p);
  }

  /* ─── Reasoning ────────────────────────────────────────────── */

  emitReasoningStart(p: { messageId: string }): void {
    this.emit('reasoning:start', p);
  }

  emitReasoningDelta(p: { messageId: string; text: string }): void {
    this.emit('reasoning:delta', p);
  }

  emitReasoningEnd(p: { messageId: string }): void {
    this.emit('reasoning:end', p);
  }

  /* ─── Activity: Tool calls ─────────────────────────────────── */

  emitToolCall(p: {
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    icon: StreamIcon;
    label: string;
  }): void {
    this.emit('tool:call', p);
  }

  emitToolResult(p: {
    callId: string;
    ok: boolean;
    result?: unknown;
    durationMs?: number;
    icon: StreamIcon;
    summary?: string;
  }): void {
    this.emit('tool:result', p);
  }

  /* ─── Activity: Build progress ─────────────────────────────── */

  emitBuildStatus(p: {
    status: 'planning' | 'analyzing' | 'building' | 'verifying' | 'complete' | 'failed' | 'cancelled';
    message: string;
    icon: StreamIcon;
    severity: Severity;
  }): void {
    this.emit('build:status', p);
  }

  emitBuildFile(p: {
    path: string;
    action: 'create' | 'edit' | 'delete';
    linesAdded?: number;
    linesRemoved?: number;
  }): void {
    this.emit('build:file', p);
  }

  emitBuildRetry(p: { attempt: number; maxAttempts: number; reason: string; icon: StreamIcon }): void {
    this.emit('build:retry', p);
  }

  /* ─── Status bar ───────────────────────────────────────────── */

  emitStatusUpdate(p: { text: string; icon: StreamIcon; progress?: number }): void {
    this.emit('status:update', p);
  }

  /* ─── Diagnostics (silent in production UI) ────────────────── */

  emitKeepalive(source: string): void {
    this.emit('diag:keepalive', { source });
  }

  emitLog(p: { level: 'debug' | 'info' | 'warn' | 'error'; source: string; message: string }): void {
    this.emit('diag:log', p);
  }

  /* ─── Cleanup ──────────────────────────────────────────────── */

  close(): void {
    if (this._closed) {
      return;
    }

    this._closed = true;

    try {
      this._controller.close();
    } catch {
      // already closed
    }
  }

  get isClosed(): boolean {
    return this._closed;
  }

  get sequence(): number {
    return this._seq;
  }
}

/**
 * Decode a SSE-formatted chunk into StreamEvent objects.
 * Used by the client to parse the response stream.
 *
 * Handles partial chunks (events split across network boundaries).
 */
export function decodeStreamEvents(buffer: { text: string }, chunk: string): StreamEvent[] {
  buffer.text += chunk;

  const events: StreamEvent[] = [];

  // SSE messages are separated by \n\n
  let separatorIdx: number;

  while ((separatorIdx = buffer.text.indexOf('\n\n')) !== -1) {
    const raw = buffer.text.slice(0, separatorIdx);
    buffer.text = buffer.text.slice(separatorIdx + 2);

    // Each message is "data: <json>"
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();

      if (!trimmed.startsWith('data:')) {
        continue;
      }

      const jsonStr = trimmed.slice(5).trim();

      if (!jsonStr) {
        continue;
      }

      try {
        const event = JSON.parse(jsonStr) as StreamEvent;
        events.push(event);
      } catch {
        // skip malformed lines
      }
    }
  }

  return events;
}
