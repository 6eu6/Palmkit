/**
 * Worker Thread Entry Point — runs in a SEPARATE THREAD.
 *
 * This file is loaded by `new Worker('./sub-agent-thread.ts')`.
 * It receives messages from the main process, runs the sub-agent,
 * and posts results back.
 *
 * The key: this runs in its own thread with its own event loop.
 * streamText here does NOT compete with the main agent's streamText
 * for API rate limits — it's a completely separate connection.
 */
import { parentPort } from 'worker_threads';
import { runInWorkerThread, type SubAgentMessage, type SubAgentResponse } from './sub-agent-worker';

if (!parentPort) {
  throw new Error('sub-agent-thread.ts must be run as a Worker');
}

parentPort.on('message', async (msg: SubAgentMessage) => {
  if (msg.type !== 'run') return;

  try {
    const result = await runInWorkerThread(msg);
    parentPort?.postMessage(result);
  } catch (err: any) {
    const response: SubAgentResponse = {
      type: 'error',
      ok: false,
      filesWritten: [],
      filesVerified: [],
      filesFailed: [],
      error: err?.message || String(err),
      timedOut: false,
    };
    parentPort?.postMessage(response);
  }
});
