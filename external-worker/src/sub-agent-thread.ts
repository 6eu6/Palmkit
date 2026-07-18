/**
 * Worker Thread Entry Point — runs in a SEPARATE THREAD.
 *
 * Receives task via either postMessage OR workerData.
 * Runs the sub-agent, posts results back.
 *
 * This file is loaded by `new Worker(scriptPath, { workerData })` from
 * agent-tools.ts. It must:
 *   1. Receive the task via workerData (passed at creation)
 *   2. Run runInWorkerThread(msg)
 *   3. Post the result back via parentPort.postMessage
 *   4. Handle any errors so the Worker doesn't silently die
 */
import { parentPort, workerData } from 'worker_threads';
import { runInWorkerThread, type SubAgentMessage } from './sub-agent-worker';

// Top-level error handlers — prevent silent Worker death
process.on('unhandledRejection', (err: any) => {
  const msg = err?.message ?? String(err);
  try {
    parentPort?.postMessage({
      type: 'error',
      ok: false,
      filesWritten: [],
      filesVerified: [],
      filesFailed: [],
      error: `Unhandled rejection: ${msg}`,
      timedOut: false,
    });
  } catch {}
});

process.on('uncaughtException', (err: any) => {
  const msg = err?.message ?? String(err);
  try {
    parentPort?.postMessage({
      type: 'error',
      ok: false,
      filesWritten: [],
      filesVerified: [],
      filesFailed: [],
      error: `Uncaught exception: ${msg}`,
      timedOut: false,
    });
  } catch {}
});

async function handleMessage(msg: SubAgentMessage) {
  if (!msg || msg.type !== 'run') return;

  try {
    const result = await runInWorkerThread(msg);
    parentPort?.postMessage(result);
  } catch (err: any) {
    parentPort?.postMessage({
      type: 'error',
      ok: false,
      filesWritten: [],
      filesVerified: [],
      filesFailed: [],
      error: err?.message || String(err),
      timedOut: false,
    });
  }
}

// Handle workerData (passed at creation time) — PRIMARY path
if (workerData && (workerData as any).type === 'run') {
  handleMessage(workerData as SubAgentMessage);
}

// Handle postMessage (sent after creation) — SECONDARY path
if (parentPort) {
  parentPort.on('message', handleMessage);
}
