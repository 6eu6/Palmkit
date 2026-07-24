/**
 * Stream Event Router — client-side dispatcher.
 *
 * Takes a stream of bytes from the server (SSE-formatted), decodes it into
 * StreamEvent objects, and routes each event to the appropriate store
 * based on its kind.
 *
 * Usage:
 *   const router = new StreamEventRouter();
 *   await router.consume(fetchResponse.body);
 *
 * The router is single-use: create a new one per stream. It exposes no
 * public state — components subscribe to the stores directly.
 */

import { decodeStreamEvents } from './event-bus';
import {
  appendBuildFile,
  appendBuildRetry,
  appendBuildStatus,
  appendMessageDelta,
  appendMessageEnd,
  appendMessageStart,
  appendReasoningDelta,
  appendReasoningEnd,
  appendReasoningStart,
  appendToolCall,
  appendToolResult,
  setStreamEnd,
  setStreamStart,
  setStreamStatusUpdate,
} from './stores';
import type { StreamEvent } from './types';

export interface StreamEventRouterOptions {
  /** Called for every event (after routing) — useful for debugging. */
  onEvent?: (event: StreamEvent) => void;

  /** Called when the stream errors (network failure, malformed bytes). */
  onError?: (err: unknown) => void;

  /** Called when the stream completes (clean close or stream:end). */
  onComplete?: () => void;
}

export class StreamEventRouter {
  private _buffer = { text: '' };
  private _closed = false;
  private _opts: StreamEventRouterOptions;
  private _reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(opts: StreamEventRouterOptions = {}) {
    this._opts = opts;
  }

  /**
   * Consume a ReadableStream<Uint8Array> from fetch().body.
   * Resolves when the stream closes (clean), errors, or close() is called.
   */
  async consume(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!body) {
      this._opts.onError?.(new Error('Stream body is null'));

      return;
    }

    this._reader = body.getReader();

    const decoder = new TextDecoder();

    try {
      while (!this._closed) {
        const { done, value } = await this._reader.read();

        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        const events = decodeStreamEvents(this._buffer, text);

        for (const event of events) {
          if (this._closed) {
            break;
          }

          this.route(event);
        }
      }

      // Flush any remaining buffered text (only if not cancelled)
      if (!this._closed && this._buffer.text.length > 0) {
        const events = decodeStreamEvents(this._buffer, '\n\n');

        for (const event of events) {
          this.route(event);
        }
      }

      if (!this._closed) {
        this._opts.onComplete?.();
      }
    } catch (err) {
      if (!this._closed) {
        this._opts.onError?.(err);
      }
    } finally {
      this._releaseReader();
    }
  }

  /** Route a single event to its store. Exposed for testing. */
  route(event: StreamEvent): void {
    this._opts.onEvent?.(event);

    switch (event.kind) {
      case 'stream:start':
        setStreamStart(event);
        break;
      case 'stream:end':
        setStreamEnd(event);
        break;
      case 'message:start':
        appendMessageStart(event);
        break;
      case 'message:delta':
        appendMessageDelta(event);
        break;
      case 'message:end':
        appendMessageEnd(event);
        break;
      case 'reasoning:start':
        appendReasoningStart(event);
        break;
      case 'reasoning:delta':
        appendReasoningDelta(event);
        break;
      case 'reasoning:end':
        appendReasoningEnd(event);
        break;
      case 'tool:call':
        appendToolCall(event);
        break;
      case 'tool:result':
        appendToolResult(event);
        break;
      case 'build:status':
        appendBuildStatus(event);
        break;
      case 'build:file':
        appendBuildFile(event);
        break;
      case 'build:retry':
        appendBuildRetry(event);
        break;
      case 'status:update':
        setStreamStatusUpdate(event);
        break;
      case 'diag:keepalive':
      case 'diag:log':
        // Drop — no UI surface in production
        break;
      default: {
        // Exhaustiveness check — TS errors if a new kind is added without a case
        const _exhaustive: never = event;
        void _exhaustive;
      }
    }
  }

  /**
   * Stop processing further events and cancel the underlying stream.
   * Safe to call multiple times.
   */
  close(): void {
    if (this._closed) {
      return;
    }

    this._closed = true;
    this._releaseReader();
  }

  private _releaseReader(): void {
    if (!this._reader) {
      return;
    }

    try {
      this._reader.releaseLock();
    } catch {
      // Already released — ignore
    }

    this._reader = null;
  }
}
