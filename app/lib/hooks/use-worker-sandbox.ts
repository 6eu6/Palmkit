/**
 * Sandbox hook — connects worker-built files to E2B cloud sandbox.
 *
 * ARCHITECTURE (matches Super Z / Claude Code / Cursor):
 *
 * The MODEL (the orchestrator's Builder/Tester agents) is the BRAIN. It
 * decides everything:
 *   - When to write files (via write_file tool)
 *   - When to run shell commands (via run_shell tool)
 *   - When the build is done (via done() tool)
 *
 * The sandbox is a TOOL under the model's control — NOT a timer-based
 * auto-launch. The model runs `npm install` and `npm run dev` inside the
 * E2B sandbox via the `run_shell` agent tool. The preview appears when
 * the model's Tester agent verifies the build is running.
 *
 * This hook provides:
 *   1. A manual `launchSandbox()` function for the "Launch Preview" button
 *   2. State tracking (idle/writing/installing/starting/ready/error)
 *   3. NO auto-launch — the model controls when the sandbox starts
 *
 * The previous auto-launch (triggered on `ready_for_preview`) was WRONG
 * because:
 *   - It started the sandbox BEFORE the user could see the files
 *   - It raced with the file injection into workbenchStore
 *   - It ignored the model's intent (the model might want to verify
 *     files before starting a dev server)
 *   - It showed "Installing & launching preview" while files were
 *     still being written — confusing UX
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { buildStatusStore, previewFilesStore } from '~/lib/stores/build-status';
import {
  isRemoteSandboxAvailable,
  createRemoteSandbox,
  pushFiles,
  startRemoteSandbox,
  checkRemoteStatus,
} from '~/lib/sandbox/remoteSandbox';

export type SandboxRunState = 'idle' | 'writing' | 'installing' | 'starting' | 'ready' | 'error';

export interface WorkerSandboxResult {
  sandboxState: SandboxRunState;
  sandboxUrl: string | undefined;
  sandboxError: string | undefined;
  launchSandbox: () => void;
  usesMobileE2B: boolean;
  canUseSandbox: boolean;
}

const E2B_TYPES = new Set(['react', 'vue', 'nextjs', 'python', 'flutter', 'react-native']);

export function useWorkerSandbox(): WorkerSandboxResult {
  const buildStatus = useStore(buildStatusStore);

  const [sandboxState, setSandboxState] = useState<SandboxRunState>('idle');
  const [sandboxUrl, setSandboxUrl] = useState<string | undefined>();
  const [sandboxError, setSandboxError] = useState<string | undefined>();
  const [usesMobileE2B, setUsesMobileE2B] = useState(false);

  const launchRef = useRef(false);
  const prevJobRef = useRef(buildStatus.jobStatus);

  const appType = buildStatus.appType ?? '';
  const canUseSandbox = Boolean(appType && E2B_TYPES.has(appType));

  // Reset sandbox when a new job starts generating.
  useEffect(() => {
    if (buildStatus.jobStatus === 'generating' && prevJobRef.current !== 'generating') {
      setSandboxState('idle');
      setSandboxUrl(undefined);
      setSandboxError(undefined);
      launchRef.current = false;
    }

    prevJobRef.current = buildStatus.jobStatus;
  }, [buildStatus.jobStatus]);

  const doLaunch = useCallback(async () => {
    if (launchRef.current) {
      return;
    }

    const files = previewFilesStore.get();

    if (Object.keys(files).length === 0) {
      return;
    }

    const type = buildStatusStore.get().appType;

    if (!type) {
      return;
    }

    launchRef.current = true;
    setSandboxError(undefined);

    try {
      setUsesMobileE2B(true);
      await _runInE2B(files, type, setSandboxState, setSandboxUrl, setSandboxError);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSandboxError(msg);
      setSandboxState('error');
    } finally {
      launchRef.current = false;
    }
  }, []);

  /*
   * NO AUTO-LAUNCH.
   *
   * The sandbox starts ONLY when:
   *   1. The user clicks "Launch Preview" (calls launchSandbox())
   *   2. OR the model's Tester agent explicitly runs `npm run dev` via
   *      the run_shell tool (which runs inside the E2B sandbox on the
   *      worker — separate from this client-side preview sandbox)
   *
   * The model is the brain. It decides when the build is ready for
   * preview — not a timer or a status flag.
   *
   * The previous auto-launch (on `ready_for_preview`) caused:
   *   - "Installing & launching preview" appearing before files were
   *     visible in the workspace
   *   - Race conditions between file injection and sandbox startup
   *   - Confusion: user sees sandbox starting while the model is still
   *     writing files
   *
   * Now: the build completes → files appear in the workspace → user
   * sees the complete project → user (or model) decides to launch
   * preview. Clean, predictable, model-driven.
   */

  const launchSandbox = useCallback(() => {
    doLaunch().catch(console.error);
  }, [doLaunch]);

  return { sandboxState, sandboxUrl, sandboxError, launchSandbox, usesMobileE2B, canUseSandbox };
}

async function _runInE2B(
  files: Record<string, string>,
  appType: string,
  setState: (s: SandboxRunState) => void,
  setUrl: (u: string) => void,
  setError: (e: string) => void,
): Promise<void> {
  const available = await isRemoteSandboxAvailable();

  if (!available) {
    setError('Cloud preview is not configured. Download the project files to run locally.');
    setState('error');

    return;
  }

  setState('writing');

  const sandbox = await createRemoteSandbox(appType);
  console.log('[worker-sandbox] sandbox created:', sandbox.id, 'cached:', sandbox.cached);
  await pushFiles(sandbox.id, files);

  setState('installing');

  // Start the dev server in the background. This returns quickly because
  // the server runs `npm install && npm run dev` as a background process.
  // We DON'T await the full install — we poll for readiness below.
  console.log('[worker-sandbox] starting dev server...');
  startRemoteSandbox(sandbox.id, { port: 3000 }).then((url) => {
    console.log('[worker-sandbox] dev server started:', url);
  }).catch((err) => {
    console.error('[worker-sandbox] start failed:', err);
  });

  setState('starting');

  // Set the cookie immediately so the proxy can forward to this sandbox.
  if (typeof document !== 'undefined') {
    document.cookie = `pf_preview=${sandbox.id}:3000; path=/; samesite=lax`;
  }

  // Poll until the cloud dev server responds (up to ~120s).
  // The dev server needs time for: npm install (~10s) + vite start (~2s).
  for (let i = 0; i < 40; i++) {
    const ready = await checkRemoteStatus(sandbox.id, 3000);
    console.log(`[worker-sandbox] poll ${i + 1}/40: ready=${ready}`);
    if (ready) {
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const proxyUrl = typeof window !== 'undefined' ? `${window.location.origin}/preview/` : '/preview/';

  setUrl(proxyUrl);
  setState('ready');
  console.log('[worker-sandbox] sandbox ready, preview URL:', proxyUrl);
}
