/**
 * Stream Event Protocol — Layered Event Bus
 *
 * Replaces the previous mixed-protocol approach (Vercel AI SDK Data Stream
 * Protocol v2, Supabase Realtime job_events, client-side workerEventsStore)
 * with ONE typed protocol for all stream events.
 *
 * Each event has a `kind` discriminator and a typed payload. The server
 * emits events via StreamEventBus; the client routes them via
 * StreamEventRouter to the appropriate store (messages / activity /
 * reasoning / status).
 *
 * Design principles:
 *   1. NO EMOJI. Use Phosphor icon names instead.
 *   2. Typed: every event has a unique kind; payload is statically known.
 *   3. Layered: chat / activity / reasoning / status / diagnostic are
 *      separate channels so the UI can render them in different panels.
 *   4. Chronological: events carry `seq` for ordering across sources.
 *   5. Cancellable: every lifecycle event includes a correlation id
 *      (messageId or jobId) so the client can drop events from cancelled
 *      streams.
 *
 * Wire format: one JSON object per line, prefixed with "data: " and
 * terminated with "\n\n" (SSE-style framing on a single response stream).
 */

/**
 * Stream mode — decided by Intent Classifier BEFORE the stream begins.
 *
 * - discuss: analysis, Q&A, explanation. No artifacts, no validation.
 * - build:   code generation. Orchestrator + validator + retries.
 * - hybrid:  discussion that may lead to a build (asks user to confirm).
 */
export type StreamMode = 'discuss' | 'build' | 'hybrid';

/**
 * Severity for activity and status events.
 *
 * - info:    neutral progress, e.g. "Reading file App.tsx"
 * - success: positive completion, e.g. "Build complete — 12 files written"
 * - warning: recoverable issue, e.g. "Missing package.json — retrying (1/2)"
 * - error:   failure, e.g. "Build failed: model returned empty response"
 */
export type Severity = 'info' | 'success' | 'warning' | 'error';

/**
 * Phosphor icon name. The UI maps each name to a UnoCSS class via the
 * ICON_CLASSES table in StreamIcon.tsx. Using a closed union guarantees
 * the UI never receives an unknown icon at runtime.
 *
 * Keep this list small — every addition requires UI support.
 */
export type StreamIcon =
  | 'ph:brain-duotone'
  | 'ph:file-text-duotone'
  | 'ph:magnifying-glass-duotone'
  | 'ph:list-duotone'
  | 'ph:terminal-window-duotone'
  | 'ph:flask-duotone'
  | 'ph:camera-duotone'
  | 'ph:upload-simple-duotone'
  | 'ph:lightning-duotone'
  | 'ph:hammer-duotone'
  | 'ph:check-circle-duotone'
  | 'ph:warning-circle-duotone'
  | 'ph:x-circle-duotone'
  | 'ph:spinner-duotone'
  | 'ph:chat-circle-text-duotone'
  | 'ph:gear-duotone'
  | 'ph:stop-duotone'
  | 'ph:pencil-simple-duotone'
  | 'ph:sparkle-duotone'
  | 'ph:plugs-connected-duotone';

/**
 * Discriminated union of all stream events.
 *
 * Group ordering reflects read priority — lifecycle first (most common),
 * then messages, then activity, then diagnostics.
 */
export type StreamEvent =
  | {
      kind: 'stream:start';
      seq: number;
      ts: number;
      mode: StreamMode;
      intent: string;
      confidence: number;
      messageId: string;
    }
  | {
      kind: 'stream:end';
      seq: number;
      ts: number;
      reason: 'complete' | 'cancelled' | 'error' | 'timeout';
      error?: string;
      messageId: string;
      stats?: {
        durationMs: number;
        tokenCount?: number;
        segments?: number;
      };
    }
  | {
      kind: 'message:start';
      seq: number;
      ts: number;
      role: 'user' | 'assistant';
      messageId: string;
    }
  | {
      kind: 'message:delta';
      seq: number;
      ts: number;
      messageId: string;
      text: string;
    }
  | {
      kind: 'message:end';
      seq: number;
      ts: number;
      messageId: string;
    }
  | {
      kind: 'reasoning:start';
      seq: number;
      ts: number;
      messageId: string;
    }
  | {
      kind: 'reasoning:delta';
      seq: number;
      ts: number;
      messageId: string;
      text: string;
    }
  | {
      kind: 'reasoning:end';
      seq: number;
      ts: number;
      messageId: string;
    }
  | {
      kind: 'tool:call';
      seq: number;
      ts: number;
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      icon: StreamIcon;
      label: string;
    }
  | {
      kind: 'tool:result';
      seq: number;
      ts: number;
      callId: string;
      ok: boolean;
      result?: unknown;
      durationMs?: number;
      icon: StreamIcon;
      summary?: string;
    }
  | {
      kind: 'build:status';
      seq: number;
      ts: number;
      status: 'planning' | 'analyzing' | 'building' | 'verifying' | 'complete' | 'failed' | 'cancelled';
      message: string;
      icon: StreamIcon;
      severity: Severity;
    }
  | {
      kind: 'build:file';
      seq: number;
      ts: number;
      path: string;
      action: 'create' | 'edit' | 'delete';
      linesAdded?: number;
      linesRemoved?: number;
    }
  | {
      kind: 'build:retry';
      seq: number;
      ts: number;
      attempt: number;
      maxAttempts: number;
      reason: string;
      icon: StreamIcon;
    }
  | {
      kind: 'status:update';
      seq: number;
      ts: number;
      text: string;
      icon: StreamIcon;
      progress?: number;
    }
  | {
      kind: 'diag:keepalive';
      seq: number;
      ts: number;
      source: string;
    }
  | {
      kind: 'diag:log';
      seq: number;
      ts: number;
      level: 'debug' | 'info' | 'warn' | 'error';
      source: string;
      message: string;
    };

/**
 * Helper type — extract payload fields for a given kind (excluding
 * kind / seq / ts which are auto-populated by the bus).
 */
export type EventPayload<K extends StreamEvent['kind']> = Omit<
  Extract<StreamEvent, { kind: K }>,
  'kind' | 'seq' | 'ts'
>;
