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
  | 'file_stream_started'
  | 'file_chunk'
  | 'file_written'
  | 'file_generation_completed'
  | 'validation_started'
  | 'validation_passed'
  | 'validation_failed'
  | 'upload_started'
  | 'file_uploaded'
  | 'snapshot_uploaded'
  | 'ready_for_preview'
  | 'build_check_started'
  | 'build_check_passed'
  | 'build_check_failed'
  | 'repair_started'
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
   * Step lifecycle — marks when an agent step starts/ends. Used by the
   * activity stream UI to group events into expandable "Explored X files,
   * Ran Y commands" entries.
   * step_start payload: { agent, stepNumber, totalSteps }
   * step_end payload:   { agent, stepNumber, filesTouched, commandsRun, durationMs }
   */
  | 'step_start'
  | 'step_end'
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
  | 'shell_output';

export interface JobEventPayload {
  [key: string]: unknown;
}

// In-process sequence counters per job — avoids a SELECT before every INSERT
// and prevents seq collisions from concurrent async emits within the same job.
const jobSeqCounters = new Map<string, number>();

/**
 * Emit a job event. Sequence number is tracked in-process per job.
 */
export async function emitEvent(
  supabase: SupabaseClient,
  jobId: string,
  type: JobEventType,
  message: string,
  payload?: JobEventPayload,
): Promise<void> {
  const current = jobSeqCounters.get(jobId) ?? -1;
  const seq = current + 1;
  jobSeqCounters.set(jobId, seq);

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
