/**
 * Event Emitter — writes job_events rows as the worker progresses.
 *
 * Each event has a type, a human-readable message, and an optional payload.
 * The frontend reads these (via /api/jobs?include=events) to show real-time
 * progress like:
 *
 *   ✓ Planning app structure
 *   ✓ Created index.html (284 lines)
 *   ✓ Created styles.css (502 lines)
 *   ⏳ Creating app.js...
 *   ○ Validating output
 *
 * See ROADMAP.md → Phase 2 → "job_events".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

export type JobEventType =
  | 'job_created'
  | 'planning_started'
  | 'planning_completed'
  | 'file_generation_started'
  | 'file_chunk'
  | 'file_written'
  | 'file_generation_completed'
  | 'validation_passed'
  | 'validation_failed'
  | 'upload_started'
  | 'snapshot_uploaded'
  | 'ready_for_preview'
  | 'build_check_failed'
  | 'edit_started'
  | 'edit_completed'
  | 'job_failed'
  /*
   * Reasoning — the LLM's own thinking text emitted between tool calls.
   * Renders as a collapsible "Thought Process" panel in the client UI.
   * payload: { agent: 'Builder'|'Tester'|'Researcher', text: string }
   */
  | 'reasoning'
  /*
   * Todos updated — the LLM publishes its current task list so the client
   * can render a structured checklist with pending/in_progress/done states.
   * payload: { agent, todos: [{ text, status: 'pending'|'in_progress'|'done' }] }
   */
  | 'todos_updated'
  /*
   * Agent lifecycle — marks when an agent (Builder/Tester) starts/stops.
   * Lets the activity stream UI group all events of one agent together.
   * payload: { agent, role }
   */
  | 'agent_started'
  | 'agent_completed'
  /*
   * Shell lifecycle — emitted by run_shell before/after each command.
   * shell_command payload: { command, running: true }
   * shell_output  payload: { command, exitCode, stdout?, stderr?, durationMs }
   * Frontend (use-external-worker.ts) renders these as the terminal activity rows.
   */
  | 'shell_command'
  | 'shell_output'
  /*
   * A chat turn's text, in batches rather than per token.
   *
   * One row per token would be a few thousand inserts for a single reply, each
   * one an INSERT plus an updated_at bump, which is more database traffic than
   * the answer is worth. The writer in chat-stream.ts accumulates and flushes
   * on a short interval, so a reply is tens of rows and still arrives while it
   * is being written. payload: { text: string }
   */
  | 'text_delta'
  /*
   * The turn is over and why. This is what tells a client to stop waiting —
   * without it a finished reply is indistinguishable from a stalled one.
   * payload: { finishReason: string, chars: number }
   */
  | 'turn_completed';

export interface JobEventPayload {
  [key: string]: unknown;
}

// In-process sequence counters per job — avoids a SELECT before every INSERT
// and prevents seq collisions from concurrent async emits within the same job.
const jobSeqCounters = new Map<string, number>();

/**
 * Where a job's numbering already got to, asked once per job.
 *
 * The counter above starts at -1 for a job this process has not seen, which is
 * right for a new job and wrong for one it inherits. A worker restart — an
 * auto-pull deploy, a crash, a second instance claiming a retry — resumes a job
 * whose events are already numbered, starts again from zero, and writes a
 * second event 0, 1, 2 alongside the first.
 *
 * That was survivable while `seq` only ordered a progress list. It is not
 * survivable now: a client reads a turn by `seq` and asks for everything after
 * the last one it holds, so duplicate numbers drop text out of the middle of a
 * reply and no error is raised anywhere.
 *
 * The promise is cached, not the number, so concurrent emits at the start of a
 * job wait on one query instead of racing to issue several.
 */
const jobSeqSeeds = new Map<string, Promise<number>>();

async function nextSeq(supabase: SupabaseClient, jobId: string): Promise<number> {
  if (!jobSeqCounters.has(jobId)) {
    if (!jobSeqSeeds.has(jobId)) {
      jobSeqSeeds.set(
        jobId,
        (async () => {
          const { data } = await supabase
            .from('job_events')
            .select('seq')
            .eq('job_id', jobId)
            .order('seq', { ascending: false })
            .limit(1);

          return (data?.[0]?.seq ?? -1) as number;
        })(),
      );
    }

    const highest = await jobSeqSeeds.get(jobId)!;

    /*
     * Only if nothing wrote while the query was in flight. A concurrent emit
     * that already set the counter has the newer truth.
     */
    if (!jobSeqCounters.has(jobId)) {
      jobSeqCounters.set(jobId, highest);
    }
  }

  const seq = (jobSeqCounters.get(jobId) ?? -1) + 1;
  jobSeqCounters.set(jobId, seq);

  return seq;
}

/** Let go of a finished job's counter so neither map grows without end. */
export function forgetJobSeq(jobId: string): void {
  jobSeqCounters.delete(jobId);
  jobSeqSeeds.delete(jobId);
}

/**
 * Emit a job event. Sequence number is tracked in-process per job.
 *
 * P4 ROOT FIX: also bumps build_jobs.updated_at on every event so the DB
 * timestamp always reflects real activity — even during long-running steps
 * (generate_files, local_build) that don't call updateJobProgress. This
 * prevents the "DB status frozen at 30% for 5 minutes" UX issue.
 */
export async function emitEvent(
  supabase: SupabaseClient,
  jobId: string,
  type: JobEventType,
  message: string,
  payload?: JobEventPayload,
): Promise<void> {
  const seq = await nextSeq(supabase, jobId);

  const { error } = await supabase.from('job_events').insert({
    job_id: jobId,
    type,
    seq,
    message,
    payload: payload ?? null,
  });

  if (error) {
    logger.warn(`Failed to emit event ${type} for job ${jobId}:`, error.message);
  } else {
    logger.debug(`Event [${seq}] ${type}: ${message}`);
  }

  /*
   * ROOT FIX: bump updated_at on build_jobs so the DB stays in sync with
   * real activity. Non-blocking (we don't await) and never throws — if it
   * fails, the event itself still went through. This is what makes the
   * "generating" status feel alive instead of frozen.
   */
  supabase
    .from('build_jobs')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .then(({ error: tsErr }) => {
      if (tsErr) {
        logger.debug(`updated_at bump failed for job ${jobId}: ${tsErr.message}`);
      }
    });
}

/**
 * Emit a batch of events for a single file write.
 * Convenience wrapper.
 */
export async function emitFileWritten(
  supabase: SupabaseClient,
  jobId: string,
  filePath: string,
  lineCount: number,
  sizeBytes: number,
): Promise<void> {
  await emitEvent(supabase, jobId, 'file_written', `Created ${filePath} (${lineCount} lines)`, {
    filePath,
    lineCount,
    sizeBytes,
  });
}
