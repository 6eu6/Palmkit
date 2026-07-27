/**
 * Remote preview orchestrator.
 *
 * Bridges the workbench to the server-side E2B sandbox (/api/sb): collects
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
  getRemoteLogs,
  isRemoteSandboxAvailable,
  isMemoryConstrainedDevice,
  destroyRemoteSandbox,
  resetAvailabilityCache,
  cacheRemoteSandbox,
} from './remoteSandbox';

export type RemotePreviewState = 'idle' | 'creating' | 'installing' | 'ready' | 'error';

export interface RemotePreviewStatus {
  state: RemotePreviewState;
  url?: string;
  error?: string;
  retryable?: boolean;
}

export const remotePreviewStatus = atom<RemotePreviewStatus>({ state: 'idle' });

const DEV_PORT = 3000;
const MAX_CREATE_RETRIES = 2;

let sandboxId: string | undefined;
let started = false;
let lastSignature = '';
let inflight = false;
let createRetryCount = 0;

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
 *
 * @param opts Optional install/dev commands from the Project Analyzer.
 *             If provided, these override the defaults in api.sb.ts.
 *
 * On sandbox creation failure, cleans up the failed sandbox and allows retry.
 */
export async function ensureRemotePreview(opts?: {
  install?: string;
  dev?: string;
  framework?: string;
}): Promise<void> {
  if (inflight) {
    return;
  }

  const currentFiles = collectFiles();
  const fileCount = Object.keys(currentFiles).length;

  if (fileCount === 0) {
    console.info('[RemotePreview] no files to preview');
    return;
  }

  inflight = true;

  try {
    /*
     * The model's stream can finish before the workbench has finished writing
     * every file action, so wait until the file set stops changing before we
     * upload — otherwise we'd push an incomplete project (no package.json) and
     * the dev server would never start.
     */
    console.info(`[RemotePreview] waiting for files to stabilize (currently ${fileCount} files)`);

    const files = await waitForFilesStable();
    const sig = signature(files);

    console.info(
      `[RemotePreview] files stabilized: ${Object.keys(files).length} files, ${Object.values(files).reduce((s, c) => s + c.length, 0)} total bytes`,
    );

    if (started && sig === lastSignature) {
      return; // nothing changed
    }

    if (!sandboxId) {
      remotePreviewStatus.set({ state: 'creating' });
      console.info('[RemotePreview] creating new E2B sandbox...');

      try {
        const sandbox = await createRemoteSandbox(opts?.framework);
        sandboxId = sandbox.id;
        createRetryCount = 0; // reset on success
        console.info(`[RemotePreview] sandbox created: ${sandboxId} (cached=${sandbox.cached})`);
      } catch (createError) {
        createRetryCount++;

        // Clean up any partially-created sandbox
        if (sandboxId) {
          void destroyRemoteSandbox(sandboxId).catch(() => undefined);
          sandboxId = undefined;
        }

        const errMsg = createError instanceof Error ? createError.message : String(createError);
        console.error(
          `[RemotePreview] sandbox create failed (attempt ${createRetryCount}/${MAX_CREATE_RETRIES}): ${errMsg}`,
        );

        if (createRetryCount <= MAX_CREATE_RETRIES) {
          // Don't set error state — let the next trigger retry
          remotePreviewStatus.set({ state: 'idle' });
          return;
        }

        // Exhausted retries
        const retryable = !errMsg.includes('not configured') && !errMsg.includes('501');
        remotePreviewStatus.set({ state: 'error', error: errMsg, retryable });
        resetAvailabilityCache();

        return;
      }
    }

    console.info(`[RemotePreview] pushing ${Object.keys(files).length} files to sandbox ${sandboxId}`);
    await pushFiles(sandboxId, files);
    lastSignature = sig;

    if (!started) {
      remotePreviewStatus.set({ state: 'installing' });

      const url = await startRemoteSandbox(sandboxId, {
        port: DEV_PORT,
        install: opts?.install,
        dev: opts?.dev,
      });
      started = true;

      /*
       * Wait until the cloud dev server actually responds before exposing it.
       * If it never comes up, pull the real dev-server logs and surface the
       * failure instead of silently injecting a blank/broken iframe (this was
       * the "preview just doesn't show" symptom on mobile).
       */
      const ready = await waitForServerReady(sandboxId, DEV_PORT);

      if (!ready) {
        const logs = await getRemoteLogs(sandboxId);
        const looksFailed = /error|ELIFECYCLE|not found|cannot find module|enoent|failed|exited/i.test(logs);

        if (looksFailed) {
          const tail = logs
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-6)
            .join(' · ')
            .slice(0, 300);

          console.error('[RemotePreview] dev server failed to start. Log tail:', tail);

          // Allow a clean retry from the UI.
          started = false;
          lastSignature = '';
          remotePreviewStatus.set({
            state: 'error',
            error: tail || 'The cloud preview server did not start. Try again.',
            retryable: true,
          });

          return;
        }

        /*
         * Otherwise it's likely still booting — inject optimistically so a
         * manual refresh picks it up once the dev server finishes.
         */
        console.warn('[RemotePreview] server not confirmed ready yet — injecting optimistically');
      }

      /*
       * Serve the preview SAME-ORIGIN through /preview/* (see
       * functions/preview/[[path]].ts). The dev server runs with --base=/preview/
       * so all its asset URLs live under /preview/*. A same-origin iframe is
       * allowed under our COEP page AND lets the element inspector reach the
       * preview DOM. The cookie tells the proxy which sandbox to forward to.
       */
      if (typeof document !== 'undefined') {
        document.cookie = `pf_preview=${sandboxId}:${DEV_PORT}; path=/; samesite=lax`;
      }

      const sameOrigin = typeof window !== 'undefined' ? `${window.location.origin}/preview/` : '/preview/';
      workbenchStore.previews.set([{ port: DEV_PORT, ready: true, baseUrl: sameOrigin }]);
      remotePreviewStatus.set({ state: 'ready', url });

      /*
       * Snapshot cache: if this sandbox was NOT created from a cached snapshot,
       * take a snapshot now (node_modules + deps are installed and ready).
       * Next time a project with the same framework is created, it will use
       * this snapshot → npm install is incremental (2-3s instead of 10-15s).
       *
       * Best-effort: if snapshot fails, we just continue without cache.
       * Only cache if the framework is known and the dev server is ready.
       */
      if (opts?.framework && ready && sandboxId) {
        void cacheRemoteSandbox(sandboxId, opts.framework);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[RemotePreview] ensureRemotePreview failed:', message);

    // If the sandbox itself is broken, kill it so next attempt creates fresh
    if (sandboxId && message.includes('sandbox')) {
      console.warn('[RemotePreview] destroying broken sandbox before reset');
      void destroyRemoteSandbox(sandboxId).catch(() => undefined);
      sandboxId = undefined;
      started = false;
      lastSignature = '';
    }

    remotePreviewStatus.set({ state: 'error', error: message, retryable: true });
  } finally {
    inflight = false;
  }
}

/**
 * Wait until the workbench file set stops changing (file actions finished
 * applying after the model stream ended). Returns the final, complete file map.
 */
async function waitForFilesStable(): Promise<Record<string, string>> {
  let previous = '';
  let stableCount = 0;
  let files = collectFiles();

  for (let i = 0; i < 30; i++) {
    files = collectFiles();

    const sig = signature(files);

    if (sig === previous) {
      stableCount += 1;

      // Unchanged for ~3 consecutive checks and a package.json exists → ready.
      if (stableCount >= 3 && Object.keys(files).some((p) => p === 'package.json')) {
        break;
      }

      // Or simply stable for longer (static project without package.json).
      if (stableCount >= 5) {
        break;
      }
    } else {
      stableCount = 0;
      previous = sig;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return files;
}

/**
 * Poll the cloud dev server until it responds (or give up after ~160s).
 * Returns true if the server became reachable, false on timeout.
 */
async function waitForServerReady(id: string, port: number): Promise<boolean> {
  const maxAttempts = 40;

  for (let i = 0; i < maxAttempts; i++) {
    if (await checkRemoteStatus(id, port)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  // Timed out.
  return false;
}

/** Reset on new project / chat switch. */
export function resetRemotePreview(): void {
  sandboxId = undefined;
  started = false;
  lastSignature = '';
  inflight = false;
  createRetryCount = 0;
  remotePreviewStatus.set({ state: 'idle' });
}

/**
 * Phase 2.1: Pause the active cloud sandbox instead of destroying it.
 *
 * Paused sandboxes cost ~80% less than running ones ($0.01/hr vs $0.05/hr)
 * and resume instantly (~2s) when the user returns. State is fully preserved
 * — node_modules, dev server process, all files.
 *
 * The server-side idle reaper (7 min) remains as a backstop: if a paused
 * sandbox is left idle too long, E2B will eventually reap it.
 */
export function killCurrentRemotePreview(): void {
  if (!sandboxId) {
    return;
  }

  const id = sandboxId;
  resetRemotePreview();

  try {
    fetch('/api/sb', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'pause', id }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // best-effort on unload
  }
}

/*
 * Phase 2.1: On page unload, PAUSE the sandbox (not destroy).
 *
 * Pausing preserves state and costs 80% less. When the user returns:
 * - Same chat: sandbox auto-resumes on first preview click
 * - Different chat: old sandbox stays paused (7-min reaper cleans it up)
 *
 * This is a major cost optimization: users who build, close the tab, and
 * return within 7 minutes get INSTANT preview (no re-boot, no npm install).
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Pause the sandbox on unload — preserves state, saves cost.
    killCurrentRemotePreview();
    return undefined;
  });
}

/**
 * Reset everything when switching to a DIFFERENT conversation, so each chat has
 * its own isolated sandbox and preview (kills the old sandbox, clears the
 * cookie and the injected preview).
 */
export function resetForChat(): void {
  killCurrentRemotePreview();

  // Also clean up any static (blob URL) preview from the previous chat
  try {
    // Dynamic import to avoid circular dependency
    void import('~/lib/runtime/static-preview').then((m) => m.clearStaticPreview());
  } catch {
    // best-effort
  }

  if (typeof document !== 'undefined') {
    document.cookie = 'pf_preview=; path=/; max-age=0';
  }

  try {
    workbenchStore.previews.set([]);
  } catch {
    // store may not be ready
  }
}
