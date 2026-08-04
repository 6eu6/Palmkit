/**
 * A turn's text on its way to the browser, in batches.
 *
 * Generation moved here because Cloudflare kills a request that runs
 * JavaScript per chunk of a model stream — Error 1102 — and a reply reaches
 * the browser through `job_events` rows instead of an open connection. That
 * removes the ceiling and introduces a different one: a token is a few
 * characters, so a row per token is several thousand inserts for one reply,
 * each an INSERT plus an `updated_at` bump on build_jobs. The stream would
 * work and the database would carry the cost of every keystroke.
 *
 * So text accumulates and is flushed on a short interval. The two limits are
 * doing different jobs:
 *
 *   FLUSH_INTERVAL_MS  how stale the visible text may be — the reply has to
 *                      look like it is being written, not delivered in lumps
 *   FLUSH_CHARS        a ceiling on how much one row carries, so a fast model
 *                      does not accumulate a whole file into a single insert
 *
 * At 100ms a reply is tens of rows rather than thousands, and the delay is
 * shorter than the gap between words a person reads.
 *
 * Ordering is `seq`, assigned by the emitter, and the client renders by it. A
 * flush in flight when the next one is due must not overtake it, so flushes
 * are chained rather than fired concurrently.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { emitEvent } from './event-emitter';
import { logger } from './logger';

/** Long enough to batch, short enough to still read as typing. */
const FLUSH_INTERVAL_MS = 100;

/** One row should stay small enough to be cheap to insert and to read. */
const FLUSH_CHARS = 600;

export interface ChatStreamWriter {
  /** Take a piece of the model's text. Never throws; never blocks the stream. */
  push(text: string): void;

  /** Everything written so far, for the turn's final record. */
  text(): string;

  /** Flush what is pending and mark the turn finished. */
  finish(finishReason: string): Promise<void>;
}

export function createChatStreamWriter(supabase: SupabaseClient, jobId: string): ChatStreamWriter {
  let pending = '';
  let full = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  /*
   * The tail of the flush chain. Each flush waits for the previous one, so two
   * rows can never be numbered out of order, and `finish` has one thing to
   * await to know everything landed.
   */
  let chain: Promise<void> = Promise.resolve();

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (!pending) {
      return;
    }

    const batch = pending;
    pending = '';

    chain = chain.then(async () => {
      try {
        await emitEvent(supabase, jobId, 'text_delta', '', { text: batch });
      } catch (error: any) {
        /*
         * A row that does not land is text the reader never sees, and there is
         * no way to put it back in order later — the numbering has moved on.
         * Losing it is still better than throwing here, which would abort the
         * model stream and lose the rest of the turn as well.
         */
        logger.warn(`text_delta lost for job ${jobId} (${batch.length} chars): ${error?.message ?? error}`);
      }
    });
  };

  return {
    push(text: string) {
      if (!text) {
        return;
      }

      pending += text;
      full += text;

      if (pending.length >= FLUSH_CHARS) {
        flush();
        return;
      }

      timer ??= setTimeout(flush, FLUSH_INTERVAL_MS);
    },

    text: () => full,

    async finish(finishReason: string) {
      flush();
      await chain;

      /*
       * After the last delta, so a client that stops on this event has already
       * received everything the turn produced.
       */
      await emitEvent(supabase, jobId, 'turn_completed', '', {
        finishReason,
        chars: full.length,
      });
    },
  };
}
