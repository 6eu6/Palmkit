/**
 * A chat turn, run here instead of on Cloudflare.
 *
 * The route that used to do this cannot finish a build. Cloudflare kills any
 * request that runs JavaScript per chunk of a model stream — Error 1102 — and
 * a build turn does the most of that, so it dies partway with HTTP 200, no
 * error part and no finish event. Measured against the same prompt in the same
 * hour: three of three truncated there at roughly half the file, three of three
 * complete here.
 *
 * The shape is the same as a build job because it is one: a row claimed from
 * the queue, work done, progress written to job_events. What differs is that a
 * build writes files and validates them, while this streams the model's text
 * back as it arrives — which is why `kind` exists rather than the worker
 * guessing from the payload.
 *
 * The system prompt is the app's own, imported rather than copied. A second
 * copy would have started equal and drifted, and the app's is the one that
 * describes the runtime as it actually is.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { streamText } from 'ai';
import { getSystemPrompt } from '~/lib/common/prompts/prompts';
import { createChatStreamWriter } from './chat-stream';
import { emitEvent, forgetJobSeq } from './event-emitter';
import { getUserApiKey } from './key-fetcher';
import { getModelInstance } from './provider-registry';
import { logger } from './logger';

export interface ChatTurnRequest {
  prompt?: string;
  provider?: string;
  model?: string;

  /** Earlier turns, so a reply knows what was already said. */
  messages?: { role: 'user' | 'assistant'; content: string }[];

  /** Which conversation this belongs to, for the client to file it under. */
  chatId?: string;
}

export interface ChatTurnJob {
  id: string;
  user_id: string;
  request: ChatTurnRequest;
}

/**
 * Run one chat turn to completion.
 *
 * Never throws: a turn that fails has to say so in the same place a turn that
 * succeeds says so, or the client waits for a reply that is never coming.
 */
export async function processChatTurn(supabase: SupabaseClient, job: ChatTurnJob): Promise<void> {
  const { prompt, provider, model, messages } = job.request ?? {};

  const fail = async (reason: string) => {
    logger.error(`Chat turn ${job.id} failed: ${reason}`);

    /*
     * Both, and in this order. `turn_completed` is what a client waits on, and
     * job_failed is what the job list shows — a turn that only wrote one of
     * them either hangs a reader or vanishes from the history.
     */
    await emitEvent(supabase, job.id, 'job_failed', reason, { reason });
    await emitEvent(supabase, job.id, 'turn_completed', '', { finishReason: 'error', chars: 0 });

    await supabase
      .from('build_jobs')
      .update({ status: 'failed_clean', error_summary: reason, progress: 100 })
      .eq('id', job.id);

    forgetJobSeq(job.id);
  };

  if (!prompt) {
    await fail('This turn arrived with no prompt.');
    return;
  }

  if (!provider || !model) {
    await fail(`No model selected for this turn (provider="${provider ?? ''}", model="${model ?? ''}").`);
    return;
  }

  const apiKey = await getUserApiKey(supabase, job.user_id, provider);

  if (!apiKey) {
    await fail(`No ${provider} API key on your account. Add one in settings and try again.`);
    return;
  }

  const writer = createChatStreamWriter(supabase, job.id);

  try {
    await supabase.from('build_jobs').update({ status: 'generating', current_step: 'replying' }).eq('id', job.id);

    const result = streamText({
      model: getModelInstance(provider, model, apiKey),
      system: getSystemPrompt(),
      messages: [...(messages ?? []), { role: 'user' as const, content: prompt }],
    });

    for await (const delta of result.textStream) {
      writer.push(delta);
    }

    const finishReason = await result.finishReason;

    await writer.finish(finishReason);

    /*
     * `length` means the model ran out of room, not that it chose to stop, so
     * the reply is cut off mid-thought however complete it looks. Saying so is
     * the difference between a user retrying and a user shipping half a file.
     */
    const ranOut = finishReason === 'length';

    await supabase
      .from('build_jobs')
      .update({
        status: ranOut ? 'incomplete_retrying' : 'ready_for_preview',
        current_step: 'done',
        progress: 100,
        has_completion_marker: !ranOut,
        error_summary: ranOut ? 'The reply hit the model’s output limit and stopped early.' : null,
      })
      .eq('id', job.id);

    logger.info(`Chat turn ${job.id} finished: ${writer.text().length} chars, reason=${finishReason}`);
    forgetJobSeq(job.id);
  } catch (error: any) {
    /*
     * Whatever the model produced before the failure has already been written,
     * so it stays readable — but the turn is still a failure and is reported as
     * one rather than left looking finished.
     */
    await writer.finish('error').catch(() => undefined);
    await fail(error?.message ?? String(error));
  }
}
