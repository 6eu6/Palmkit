/**
 * Live Stream store — M2's instant display layer.
 *
 * The worker broadcasts the model's raw deltas over Supabase Realtime
 * (topic `stream:{jobId}`, event `chunks`) the moment they arrive — far
 * ahead of the durable job_events rows (which flush every ~2s). This store
 * holds ONLY the in-flight tail:
 *
 *   - `text`: reasoning/narration since the last durable flush. When the
 *     matching durable `reasoning` row lands, the tail is cleared — the
 *     folded stream takes over the exact same characters.
 *   - `tool`: the tool call currently in flight ("✍️ src/App.jsx"),
 *     cleared when its durable event (file_written / shell_command) lands.
 *
 * Everything here is lossy by design: if the broadcast socket drops, the
 * durable path repaints the same content within seconds. The reducer is a
 * pure function so it is unit-testable without a browser.
 */

import { atom } from 'nanostores';

export interface LiveChunk {
  t: 'd' | 'r' | 'tool' | 'step';
  x?: string;
  n?: string;
  d?: string;
}

export interface LiveTool {
  name: string;
  detail?: string;
}

export interface LiveStreamState {
  /** Narration tail — the model's spoken text since the last durable flush. */
  text: string;

  /** Thinking tail — reasoning tokens since the last durable flush. */
  thinking: string;

  /** Epoch ms when the current thinking run started (drives the live seconds counter). */
  thinkingStartedAt: number;
  tool: LiveTool | null;
  active: boolean;
  updatedAt: number;
}

const EMPTY: LiveStreamState = {
  text: '',
  thinking: '',
  thinkingStartedAt: 0,
  tool: null,
  active: false,
  updatedAt: 0,
};

/** Cap the live tail — the durable rows carry the full text anyway. */
const MAX_TAIL_CHARS = 4000;

export const liveStreamStore = atom<LiveStreamState>(EMPTY);

/**
 * Pure reducer: apply a batch of broadcast chunks to the state.
 * Exported for unit tests.
 */
export function applyLiveChunks(state: LiveStreamState, chunks: LiveChunk[], now = Date.now()): LiveStreamState {
  let { text, thinking, thinkingStartedAt, tool } = state;
  let touched = false;

  for (const c of chunks ?? []) {
    if (!c || typeof c !== 'object') {
      continue;
    }

    if (c.t === 'd' && typeof c.x === 'string' && c.x.length > 0) {
      text = (text + c.x).slice(-MAX_TAIL_CHARS);
      touched = true;
    } else if (c.t === 'r' && typeof c.x === 'string' && c.x.length > 0) {
      if (thinking.length === 0) {
        thinkingStartedAt = now;
      }

      thinking = (thinking + c.x).slice(-MAX_TAIL_CHARS);
      touched = true;
    } else if (c.t === 'tool' && typeof c.n === 'string') {
      tool = { name: c.n, detail: typeof c.d === 'string' ? c.d : undefined };
      touched = true;
    } else if (c.t === 'step') {
      // Step boundary: the durable flush for this segment is imminent.
      text = '';
      thinking = '';
      thinkingStartedAt = 0;
      tool = null;
      touched = true;
    }
  }

  if (!touched) {
    return state;
  }

  return { text, thinking, thinkingStartedAt, tool, active: true, updatedAt: now };
}

/** Ingest a broadcast batch (called from the Realtime handler). */
export function ingestLiveChunks(chunks: LiveChunk[]): void {
  liveStreamStore.set(applyLiveChunks(liveStreamStore.get(), chunks));
}

/**
 * A durable `reasoning` row landed — it contains the same characters the
 * live tail showed, so drop the tail and let the folded stream take over.
 */
export function clearLiveText(): void {
  const s = liveStreamStore.get();

  if (s.text) {
    liveStreamStore.set({ ...s, text: '', updatedAt: Date.now() });
  }
}

/** A durable thinking row landed — the folded stream takes over the thought. */
export function clearLiveThinking(): void {
  const s = liveStreamStore.get();

  if (s.thinking) {
    liveStreamStore.set({ ...s, thinking: '', updatedAt: Date.now() });
  }
}

/** The in-flight tool produced its durable event — retire the chip. */
export function clearLiveTool(): void {
  const s = liveStreamStore.get();

  if (s.tool) {
    liveStreamStore.set({ ...s, tool: null, updatedAt: Date.now() });
  }
}

/** Job ended or a new one started. */
export function resetLiveStream(): void {
  liveStreamStore.set(EMPTY);
}
