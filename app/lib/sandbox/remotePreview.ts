/**
 * Remote preview orchestrator.
 *
 * Bridges the workbench to the server-side E2B sandbox (/api/sandbox): collects
 * the current project files, runs them in the cloud (install + dev server) and
 * injects the resulting public URL into `workbenchStore.previews` so the normal
 * Preview UI renders it. Used on memory-constrained devices (mobile Safari)
 * where the in-browser WebContainer cannot run a real dev server.
 */
import { atom } from 'nanostores';
import { WORK_DIR } from '~/utils/constants';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  createRemoteSandbox,
  pushFiles,
  startRemoteSandbox,
  checkRemoteStatus,
  isRemoteSandboxAvailable,
  isMemoryConstrainedDevice,
} from './remoteSandbox';

export type RemotePreviewState = 'idle' | 'creating' | 'installing' | 'ready' | 'error';

export interface RemotePreviewStatus {
  state: RemotePreviewState;
  url?: string;
  error?: string;
}

export const remotePreviewStatus = atom<RemotePreviewStatus>({ state: 'idle' });

const DEV_PORT = 3000;

let sandboxId: string | undefined;
let started = false;
let lastSignature = '';
let inflight = false;

/** Collect text files from the workbench as a relative path -> contents map. */
function collectFiles(): Record<string, string> {
  const map = workbenchStore.files.get();
  const out: Record<string, string> = {};
  const prefix = `${WORK_DIR}/`;

  for (const [path, dirent] of Object.entries(map)) {
    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }

    if (!path.startsWith(prefix)) {
      continue;
    }

    const rel = path.slice(prefix.length);

    if (rel.startsWith('node_modules/') || rel.includes('/node_modules/')) {
      continue;
    }

    out[rel] = dirent.content;
  }

  return out;
}

function signature(files: Record<string, string>): string {
  // cheap change-detector: paths + total length
  const keys = Object.keys(files).sort();
  const total = keys.reduce((n, k) => n + files[k].length, 0);

  return `${keys.join('|')}::${total}`;
}

/**
 * Should the remote preview drive the workbench on this device?
 * Only when the device is memory-constrained AND the server has E2B configured.
 */
export async function shouldUseRemotePreview(): Promise<boolean> {
  if (!isMemoryConstrainedDevice()) {
    return false;
  }

  return isRemoteSandboxAvailable();
}

/**
 * Ensure a remote preview exists/updates for the current files.
 * - First call: create sandbox, push files, install + start dev, inject preview.
 * - Later calls: push updated files (Vite HMR reloads the running preview).
 */
export async function ensureRemotePreview(): Promise<void> {
  if (inflight) {
    return;
  }

  const files = collectFiles();

  if (Object.keys(files).length === 0) {
    return;
  }

  const sig = signature(files);

  if (started && sig === lastSignature) {
    return; // nothing changed
  }

  inflight = true;

  try {
    if (!sandboxId) {
      remotePreviewStatus.set({ state: 'creating' });

      const sandbox = await createRemoteSandbox();
      sandboxId = sandbox.id;
    }

    await pushFiles(sandboxId, files);
    lastSignature = sig;

    if (!started) {
      remotePreviewStatus.set({ state: 'installing' });

      const url = await startRemoteSandbox(sandboxId, { port: DEV_PORT });
      started = true;

      /*
       * Wait until the cloud dev server actually responds before showing it, so
       * the preview iframe doesn't load a 502 while npm install is still running.
       */
      await waitForServerReady(sandboxId, DEV_PORT);

      // Inject into the normal previews store so the Preview UI renders it.
      workbenchStore.previews.set([{ port: DEV_PORT, ready: true, baseUrl: url }]);
      remotePreviewStatus.set({ state: 'ready', url });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    remotePreviewStatus.set({ state: 'error', error: message });
  } finally {
    inflight = false;
  }
}

/** Poll the cloud dev server until it responds (or give up after ~160s). */
async function waitForServerReady(id: string, port: number): Promise<void> {
  const maxAttempts = 40;

  for (let i = 0; i < maxAttempts; i++) {
    if (await checkRemoteStatus(id, port)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  // Timed out — inject anyway so the user can refresh the preview manually.
}

/** Reset on new project / chat switch. */
export function resetRemotePreview(): void {
  sandboxId = undefined;
  started = false;
  lastSignature = '';
  inflight = false;
  remotePreviewStatus.set({ state: 'idle' });
}

/**
 * Immediately destroy the active cloud sandbox — used when the page/tab is
 * closed so we never pay for a forgotten session (server also reaps after 7
 * min idle as a backstop). Uses keepalive so the request survives unload.
 */
export function killCurrentRemotePreview(): void {
  if (!sandboxId) {
    return;
  }

  const id = sandboxId;
  resetRemotePreview();

  try {
    fetch('/api/sandbox', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'destroy', id }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // best-effort on unload
  }
}

// Cut the sandbox as soon as the site/tab is closed or navigated away.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', killCurrentRemotePreview);
}
