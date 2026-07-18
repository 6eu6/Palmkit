/**
 * Worker Thread Entry Point — runs in a SEPARATE THREAD.
 *
 * Receives task via either postMessage OR workerData.
 * Runs the sub-agent, posts results back.
 */
import { parentPort, workerData } from 'worker_threads';
import { runInWorkerThread, type SubAgentMessage } from './sub-agent-worker';

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

// Handle workerData (passed at creation time)
if (workerData && workerData.type === 'run') {
  handleMessage(workerData);
}

// Handle postMessage (sent after creation)
if (parentPort) {
  parentPort.on('message', handleMessage);
}
