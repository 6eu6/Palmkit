/**
 * Phase 3: Bridge hook connecting Phase 2 Oracle worker R2 files to
 * WebContainer (desktop) or E2B (mobile / Python).
 *
 * Routing strategy — minimises E2B spend:
 *   static          → blob URL (Phase 2, already done — not handled here)
 *   react / vue / nextjs + desktop  → WebContainer (free, in-browser WASM)
 *   react / vue / nextjs + phone    → E2B sandbox (cloud, costs ~$0.0002/CPU-s)
 *   python                          → E2B always (needs Python runtime)
 *   flutter / react-native          → not sandboxable — caller shows instructions
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { buildStatusStore, previewFilesStore } from '~/lib/stores/build-status';
import {
  isMemoryConstrainedDevice,
  isRemoteSandboxAvailable,
  createRemoteSandbox,
  pushFiles,
  startRemoteSandbox,
  checkRemoteStatus,
} from '~/lib/sandbox/remoteSandbox';
import { WORK_DIR } from '~/utils/constants';

export type SandboxRunState = 'idle' | 'writing' | 'installing' | 'starting' | 'ready' | 'error';

export interface WorkerSandboxResult {
  sandboxState: SandboxRunState;
  sandboxUrl: string | undefined;
  sandboxError: string | undefined;
  launchSandbox: () => void;
  usesMobileE2B: boolean;
  canUseSandbox: boolean;
}

const WC_TYPES = new Set(['react', 'vue', 'nextjs']);
const E2B_TYPES = new Set(['react', 'vue', 'nextjs', 'python']);
const PREVIEW_ABS_DIR = `${WORK_DIR}/preview`;

export function useWorkerSandbox(): WorkerSandboxResult {
  const buildStatus = useStore(buildStatusStore);
  const previewFiles = useStore(previewFilesStore);

  const [sandboxState, setSandboxState] = useState<SandboxRunState>('idle');
  const [sandboxUrl, setSandboxUrl] = useState<string | undefined>();
  const [sandboxError, setSandboxError] = useState<string | undefined>();
  const [usesMobileE2B, setUsesMobileE2B] = useState(false);

  const launchRef = useRef(false);
  const prevJobRef = useRef(buildStatus.jobStatus);

  const appType = buildStatus.appType ?? '';
  const isPhone = isMemoryConstrainedDevice();
  const canUseSandbox = Boolean(appType && (isPhone ? E2B_TYPES.has(appType) : WC_TYPES.has(appType)));

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

    const phone = isMemoryConstrainedDevice();

    try {
      if (!phone && WC_TYPES.has(type)) {
        setUsesMobileE2B(false);
        await _runInWebContainer(files, setSandboxState, setSandboxUrl, setSandboxError);
      } else if (E2B_TYPES.has(type)) {
        setUsesMobileE2B(true);
        await _runInE2B(files, type, setSandboxState, setSandboxUrl, setSandboxError);
      } else {
        setSandboxError('This app type cannot run in the browser. Download the files to run locally.');
        setSandboxState('error');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSandboxError(msg);
      setSandboxState('error');
    } finally {
      launchRef.current = false;
    }
  }, []);

  // Auto-launch on desktop for WebContainer-compatible types (free, zero cost).
  useEffect(() => {
    const isReady = buildStatus.jobStatus === 'ready_for_preview';
    const hasFiles = Object.keys(previewFiles).length > 0;
    const isWcType = appType && WC_TYPES.has(appType);
    const desktop = !isMemoryConstrainedDevice();

    if (isReady && hasFiles && isWcType && desktop && sandboxState === 'idle' && !launchRef.current) {
      doLaunch().catch(console.error);
    }
  }, [buildStatus.jobStatus, buildStatus.appType, sandboxState, previewFiles]);

  const launchSandbox = useCallback(() => {
    doLaunch().catch(console.error);
  }, [doLaunch]);

  return { sandboxState, sandboxUrl, sandboxError, launchSandbox, usesMobileE2B, canUseSandbox };
}

async function _runInWebContainer(
  files: Record<string, string>,
  setState: (s: SandboxRunState) => void,
  setUrl: (u: string) => void,
  setError: (e: string) => void,
): Promise<void> {
  setState('writing');

  const { webcontainer } = await import('~/lib/webcontainer');
  const wc = await webcontainer;

  /*
   * Write all source files into an isolated preview subdirectory so they don't
   * conflict with any existing bolt editor files in the main workdir.
   */
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = `${PREVIEW_ABS_DIR}/${relPath}`;
    const dir = absPath.slice(0, absPath.lastIndexOf('/'));
    await wc.fs.mkdir(dir, { recursive: true });
    await wc.fs.writeFile(absPath, content);
  }

  setState('installing');

  const installProc = await wc.spawn('npm', ['install'], { cwd: PREVIEW_ABS_DIR });
  const installCode = await installProc.exit;

  if (installCode !== 0) {
    setError('npm install failed. Check the browser console for details.');
    setState('error');

    return;
  }

  setState('starting');

  // Register server-ready listener BEFORE spawning so we don't miss the event.
  const serverReadyUrl = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Dev server timed out (60s). Ensure package.json has a "dev" script.')),
      60_000,
    );

    const unsub = wc.on('server-ready', (_port, url) => {
      clearTimeout(timer);
      unsub();
      resolve(url);
    });
  });

  // Dev server runs indefinitely — don't await it.
  wc.spawn('npm', ['run', 'dev'], { cwd: PREVIEW_ABS_DIR }).catch(() => undefined);

  const url = await serverReadyUrl;
  setUrl(url);
  setState('ready');
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
  await pushFiles(sandbox.id, files);

  setState('installing');

  const previewUrl = await startRemoteSandbox(sandbox.id, { port: 3000 });

  setState('starting');

  // Poll until the cloud dev server responds (up to ~160s).
  for (let i = 0; i < 40; i++) {
    if (await checkRemoteStatus(sandbox.id, 3000)) {
      break;
    }

    await new Promise((r) => setTimeout(r, 4000));
  }

  setUrl(previewUrl);
  setState('ready');
}
