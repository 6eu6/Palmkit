/**
 * Stream Bus — M2's instant transport.
 *
 * The durable path (emitEvent → job_events → Realtime postgres_changes +
 * polling) stays the record of truth, but it is CHUNKY: reasoning text only
 * lands every ~2s / 700 chars, so the UI never feels token-live.
 *
 * This bus broadcasts the model's raw deltas the moment they arrive, over
 * Supabase Realtime's **HTTP broadcast API** (POST /realtime/v1/api/broadcast)
 * — no WebSocket state on the worker, fire-and-forget, and the browser
 * receives them on its existing Realtime socket by subscribing to the
 * `stream:{jobId}` topic.
 *
 * Design:
 *   - Micro-batching: deltas buffer for FLUSH_MS (120ms) or FLUSH_CHARS and
 *     ship as ONE broadcast message carrying an array of chunks — smooth to
 *     the eye, gentle on Realtime.
 *   - Compact chunk protocol (small payloads):
 *       { t: 'd',    x: string }                      narration (spoken text) delta
 *       { t: 'r',    x: string }                      thinking (reasoning) delta
 *       { t: 'tool', n: string, d?: string }          tool call started
 *       { t: 'step' }                                 step boundary
 *   - Lossy by design: a dropped broadcast costs nothing — the durable
 *     events repaint the same content within ~2s.
 *   - Verifiable without a browser: per-job counters are exposed so the
 *     orchestrator can emit a `stream_stats` marker into job_events.
 */

import { logger } from './logger';

interface StreamChunk {
  t: 'd' | 'r' | 'tool' | 'step';
  x?: string;
  n?: string;
  d?: string;
}

interface JobStream {
  buffer: StreamChunk[];
  timer: ReturnType<typeof setTimeout> | null;
  chunksSent: number;
  batchesSent: number;
  failures: number;
  /** Per-channel counters for the stream_stats verification marker. */
  thinkingChunks: number;
  narrationChunks: number;
}

const FLUSH_MS = 120;
const FLUSH_CHARS = 600;
const MAX_BATCH_CHUNKS = 64;

const streams = new Map<string, JobStream>();

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function getStream(jobId: string): JobStream {
  let s = streams.get(jobId);

  if (!s) {
    s = { buffer: [], timer: null, chunksSent: 0, batchesSent: 0, failures: 0, thinkingChunks: 0, narrationChunks: 0 };
    streams.set(jobId, s);
  }

  return s;
}

async function flush(jobId: string): Promise<void> {
  const s = streams.get(jobId);

  if (!s || s.buffer.length === 0) {
    return;
  }

  const chunks = s.buffer.splice(0, s.buffer.length);

  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return;
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `stream:${jobId}`,
            event: 'chunks',
            payload: { chunks },
            private: false,
          },
        ],
      }),
    });

    if (resp.ok) {
      s.chunksSent += chunks.length;
      s.batchesSent += 1;
    } else {
      s.failures += 1;

      if (s.failures <= 3) {
        logger.warn(`[stream-bus] broadcast failed for ${jobId}: HTTP ${resp.status}`);
      }
    }
  } catch (e) {
    s.failures += 1;

    if (s.failures <= 3) {
      logger.warn(`[stream-bus] broadcast error for ${jobId}: ${e}`);
    }
  }
}

function enqueue(jobId: string, chunk: StreamChunk): void {
  const s = getStream(jobId);
  s.buffer.push(chunk);

  const bufferedChars = s.buffer.reduce((n, c) => n + (c.x?.length ?? 0), 0);

  if (s.buffer.length >= MAX_BATCH_CHUNKS || bufferedChars >= FLUSH_CHARS) {
    void flush(jobId);
    return;
  }

  if (!s.timer) {
    s.timer = setTimeout(() => void flush(jobId), FLUSH_MS);
  }
}

/**
 * Broadcast a model delta. Fire-and-forget — never await in the hot loop.
 * `channel` distinguishes thinking (reasoning tokens) from narration (the
 * model's spoken text) so the UI can style them differently.
 */
export function sendDelta(jobId: string, text: string, channel: 'thinking' | 'narration' = 'narration'): void {
  if (!text) {
    return;
  }

  const s = getStream(jobId);

  if (channel === 'thinking') {
    s.thinkingChunks++;
  } else {
    s.narrationChunks++;
  }

  enqueue(jobId, { t: channel === 'thinking' ? 'r' : 'd', x: text });
}

/** Broadcast that a tool call just started (name + short human detail). */
export function sendTool(jobId: string, name: string, detail?: string): void {
  enqueue(jobId, { t: 'tool', n: name, ...(detail ? { d: detail.slice(0, 120) } : {}) });
}

/** Broadcast a step boundary — the UI closes its live text segment. */
export function sendStep(jobId: string): void {
  enqueue(jobId, { t: 'step' });
}

/**
 * Flush what's left and return the job's stream stats (for the durable
 * `stream_stats` marker — the remote-verification hook).
 */
export async function closeJobStream(
  jobId: string,
): Promise<{ chunksSent: number; batchesSent: number; failures: number; thinkingChunks: number; narrationChunks: number }> {
  await flush(jobId).catch(() => undefined);

  const s = streams.get(jobId);
  const stats = {
    chunksSent: s?.chunksSent ?? 0,
    batchesSent: s?.batchesSent ?? 0,
    failures: s?.failures ?? 0,
    thinkingChunks: s?.thinkingChunks ?? 0,
    narrationChunks: s?.narrationChunks ?? 0,
  };

  if (s?.timer) {
    clearTimeout(s.timer);
  }

  streams.delete(jobId);

  return stats;
}
