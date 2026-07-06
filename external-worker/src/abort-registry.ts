/**
 * Abort registry — tracks in-flight jobs so they can be cancelled on demand.
 *
 * When the user hits Stop, the front-end calls the worker's /jobs/:id/cancel
 * endpoint, which looks up the job here and fires its abort + cleanup. This
 * lets the worker write a PARTIAL manifest (the files written so far) so the
 * user's next message can edit that partial state instead of waiting for the
 * full build to finish (or starting from scratch).
 *
 * Why a separate module: the orchestrator creates the AbortController locally
 * (per-job), but the HTTP handler needs to reach it from outside. This registry
 * bridges them without exposing the orchestrator's internals.
 */

export interface JobAbortHandle {
  /** Fires the AbortController — cancels the in-flight LLM stream. */
  abort: () => void;
  /**
   * Called after abort to finalize the job as 'cancelled': write the partial
   * manifest (files written so far) + worklog, mark the job status, emit a
   * terminal event. The orchestrator's finally{} still runs for its own
   * cleanup (clearTimeout etc.) — this is the application-level finalization.
   */
  finalize: () => Promise<void>;
}

const registry = new Map<string, JobAbortHandle>();

export function registerJobAbort(jobId: string, handle: JobAbortHandle): void {
  registry.set(jobId, handle);
}

export function unregisterJobAbort(jobId: string): void {
  registry.delete(jobId);
}

export function getJobAbort(jobId: string): JobAbortHandle | undefined {
  return registry.get(jobId);
}

/**
 * Returns the list of jobIds currently in the registry (for /jobs/stats).
 */
export function getActiveJobIds(): string[] {
  return [...registry.keys()];
}
