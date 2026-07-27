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

// Log that we're alive — proves the Worker loaded this file
console.error(`[sub-agent-thread] Worker loaded, workerData present: ${!!workerData}`);
if (workerData) {
  console.error(`[sub-agent-thread] task type: ${(workerData as any)?.type}, task preview: ${((workerData as any)?.task || '').slice(0, 80)}`);
}

// Dynamic import to catch any module resolution errors
let runInWorkerThread: typeof import('./sub-agent-worker').runInWorkerThread;
try {
  const mod = await import('./sub-agent-worker');
  runInWorkerThread = mod.runInWorkerThread;
  console.error(`[sub-agent-thread] sub-agent-worker imported successfully`);
} catch (importErr: any) {
  console.error(`[sub-agent-thread] FAILED to import sub-agent-worker: ${importErr?.message}`);
  console.error(`[sub-agent-thread] stack: ${importErr?.stack}`);
  parentPort?.postMessage({
    type: 'error',
    ok: false,
    filesWritten: [],
    filesVerified: [],
    filesFailed: [],
    error: `Import failed: ${importErr?.message}`,
    timedOut: false,
  });
  process.exit(1);
}

import type { SubAgentMessage } from './sub-agent-worker';

// Top-level error handlers — prevent silent Worker death
process.on('unhandledRejection', (err: any) => {
  const msg = err?.message ?? String(err);
  console.error(`[sub-agent-thread] unhandledRejection: ${msg}`);
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
  console.error(`[sub-agent-thread] uncaughtException: ${msg}`);
  console.error(`[sub-agent-thread] stack: ${err?.stack}`);
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

  console.error(`[sub-agent-thread] handleMessage: starting runInWorkerThread`);
  try {
    const result = await runInWorkerThread(msg);
    console.error(`[sub-agent-thread] handleMessage: completed, ok=${result.ok}, files=${result.filesWritten.length}`);
    parentPort?.postMessage(result);
  } catch (err: any) {
    console.error(`[sub-agent-thread] handleMessage: failed: ${err?.message}`);
    console.error(`[sub-agent-thread] stack: ${err?.stack}`);
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
