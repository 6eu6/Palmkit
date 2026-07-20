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
import {
  buildStatusStore,
  previewFilesStore,
  activeBuildJobIdStore,
  workerProgressStore,
} from '~/lib/stores/build-status';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  isRemoteSandboxAvailable,
  createRemoteSandbox,
  pushFiles,
  startRemoteSandbox,
  checkRemoteStatus,
  resumeRemoteSandbox,
} from '~/lib/sandbox/remoteSandbox';
import { getStackCommandsForAppType } from '~/lib/sandbox/stack-commands';

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

function currentChatId(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const m = window.location.pathname.match(/\/chat\/([^/]+)/);

  return m ? m[1] : '';
}

export function useWorkerSandbox(): WorkerSandboxResult {
  const buildStatus = useStore(buildStatusStore);

  const [sandboxState, setSandboxState] = useState<SandboxRunState>('idle');
  const [sandboxUrl, setSandboxUrl] = useState<string | undefined>();
  const [sandboxError, setSandboxError] = useState<string | undefined>();
  const [usesMobileE2B, setUsesMobileE2B] = useState(false);

  const launchRef = useRef(false);
  const reconnectRef = useRef(false);
  const prevJobRef = useRef(buildStatus.jobStatus);

  /*
   * SURVIVE PAGE REFRESH.
   *
   * The E2B preview sandbox lives server-side and stays alive (E2B pauses it
   * after idle, and Sandbox.connect auto-resumes). But the client-side preview
   * URL lived only in React state, so a page refresh dropped it and the user
   * saw a blank preview / had to relaunch — the "preview disconnects on refresh"
   * complaint.
   *
   * On mount, if the `pf_preview` cookie from a previous session is present,
   * reconnect: resume the sandbox, confirm the dev server responds, and restore
   * the same-origin `/preview/` URL. If the sandbox is gone (reaped), fall back
   * silently to the idle "Launch preview" state.
   */
  useEffect(() => {
    if (reconnectRef.current || typeof document === 'undefined') {
      return undefined;
    }

    reconnectRef.current = true;

    // Don't hijack an active build — only reconnect a finished preview.
    if (buildStatusStore.get().jobStatus === 'generating') {
      return undefined;
    }

    const match = document.cookie.match(/(?:^|;\s*)pf_preview=([^;]+)/);

    if (!match) {
      return undefined;
    }

    const [sid, portStr = '3000', cookieChatId = ''] = decodeURIComponent(match[1]).split(':');
    const port = Number(portStr) || 3000;

    if (!sid) {
      return undefined;
    }

    /*
     * PER-CHAT SCOPE: the cookie is written as `sid:port:chatId`. Only
     * reconnect the sandbox that belongs to THIS conversation — previously the
     * single global cookie made chat B silently restore chat A's preview.
     */
    if (cookieChatId && cookieChatId !== currentChatId()) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      if (launchRef.current) {
        return;
      }

      launchRef.current = true;
      setSandboxState('starting');

      try {
        if (!(await isRemoteSandboxAvailable())) {
          setSandboxState('idle');
          return;
        }

        // Resume (auto-resumes if paused). If it's gone, bail to the launch button.
        if (!(await resumeRemoteSandbox(sid))) {
          setSandboxState('idle');
          return;
        }

        const poll = async (tries: number): Promise<boolean> => {
          for (let i = 0; i < tries && !cancelled; i++) {
            if (await checkRemoteStatus(sid, port)) {
              return true;
            }

            await new Promise((r) => setTimeout(r, 2500));
          }

          return false;
        };

        /*
         * Common case — a quick refresh where the sandbox never idle-paused: the
         * dev server is still running, so status is ready almost immediately.
         */
        let ok = await poll(3);

        /*
         * Returning after an idle pause: E2B restores the sandbox filesystem on
         * resume but NOT the running dev-server process. Relaunch it — node_modules
         * is already installed, so `npm install` is a no-op and Vite starts in ~200ms.
         */
        if (!ok && !cancelled) {
          document.cookie = `pf_preview=${sid}:${port}:${currentChatId()}; path=/; samesite=lax`;
          await startRemoteSandbox(sid, { port }).catch(() => undefined);
          ok = await poll(12);
        }

        if (cancelled) {
          return;
        }

        if (ok) {
          setUsesMobileE2B(true);
          setSandboxUrl(`${window.location.origin}/preview/`);
          setSandboxState('ready');
        } else {
          setSandboxState('idle');
        }
      } catch {
        setSandboxState('idle');
      } finally {
        launchRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
      /*
       * PREBUILT PREVIEW — if the Oracle worker built the project locally
       * (hasPrebuiltPreview: true, previewUrl set), serve the preview directly
       * from Oracle's nginx via the same-origin proxy. No E2B sandbox needed,
       * so npm install OOM (478MB RAM limit) is completely bypassed.
       */
      const jobData = (buildStatusStore.get() as any)._jobValidationResult;
      const hasPrebuiltPreview = jobData?.hasPrebuiltPreview === true;
      const previewUrl = jobData?.previewUrl as string | undefined;

      if (hasPrebuiltPreview && previewUrl) {
        // Extract projectId from the previewUrl (http://130.61.131.77/preview-dist/{projectId}/)
        const projectIdMatch = previewUrl.match(/preview-dist\/(\d+)/);
        const projectId = projectIdMatch?.[1];

        if (projectId) {
          // Set the cookie so the proxy forwards to Oracle instead of E2B
          if (typeof document !== 'undefined') {
            document.cookie = `pf_preview=oracle:${projectId}:${currentChatId()}; path=/; samesite=lax`;
          }
          setSandboxUrl(`${window.location.origin}/preview/`);
          setSandboxState('ready');
          setUsesMobileE2B(false);
          console.log('[worker-sandbox] using prebuilt preview from Oracle for project', projectId);
          return;
        }
      }

      // Fallback to E2B sandbox
      setUsesMobileE2B(true);
      const jobKey = activeBuildJobIdStore.get() ?? undefined;
      const prewarmedId = jobKey && prewarm.current?.jobKey === jobKey ? prewarm.current.id : undefined;
      await _runInE2B(files, type, setSandboxState, setSandboxUrl, setSandboxError, prewarmedId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSandboxError(msg);
      setSandboxState('error');
    } finally {
      prewarm.current = null;
      launchRef.current = false;
    }
  }, []);

  /*
   * AUTO-LAUNCH ON VERIFIED BUILD.
   *
   * `ready_for_preview` is only set AFTER the worker's Builder finished, the
   * Tester ran, and the full file set was uploaded — the file-completeness
   * races that motivated the old "no auto-launch" rule can't happen at this
   * point. What the manual flow actually produced in live testing was: build
   * verified ✓ → user stares at the Code tab → has to discover
   * Workspace → Preview → "Launch Preview" by themselves. The correct
   * behavior (like every peer tool): the moment the build is verified, start
   * the sandbox and take the user to the running app.
   *
   * Guards: fires once per job (autoLaunchedJob ref), only for sandboxable
   * app types, and waits for the R2 file fetch to land in previewFilesStore
   * (up to 30s) before launching so we never push an empty file set.
   */
  const autoLaunchedJob = useRef<string | undefined>(undefined);

  const activeJobId = useStore(activeBuildJobIdStore);

  /*
   * PREWARM (Design v2, Phase D). Allocating an E2B sandbox has a few seconds
   * of cold-start latency. We pay it in the BACKGROUND while the build is
   * still finishing (progress ≥ 55%) so it's hidden, then reuse that same
   * sandbox at launch instead of creating a fresh one — cutting first-preview
   * time. We only ALLOCATE here; files are pushed and the dev server starts
   * only at ready_for_preview, so the user never sees a stale/partial preview.
   */
  const prewarm = useRef<{ jobKey: string; id: string } | null>(null);
  const prewarmingRef = useRef(false);
  const { progress } = useStore(workerProgressStore);

  useEffect(() => {
    const jobKey = activeJobId ?? undefined;
    const type = buildStatus.appType ?? '';

    if (
      !jobKey ||
      buildStatus.jobStatus !== 'generating' ||
      !E2B_TYPES.has(type) ||
      prewarmingRef.current ||
      prewarm.current?.jobKey === jobKey ||
      progress < 55 // only once the build is well underway — keeps us inside the sandbox TTL
    ) {
      return;
    }

    prewarmingRef.current = true;

    (async () => {
      try {
        if (!(await isRemoteSandboxAvailable())) {
          return;
        }

        const sandbox = await createRemoteSandbox(type);
        prewarm.current = { jobKey, id: sandbox.id };
        console.log('[worker-sandbox] prewarmed sandbox', sandbox.id, 'for job', jobKey);
      } catch (e) {
        console.warn('[worker-sandbox] prewarm failed (will create on launch):', e);
      } finally {
        prewarmingRef.current = false;
      }
    })();
  }, [activeJobId, buildStatus.jobStatus, buildStatus.appType, progress]);

  useEffect(() => {
    const { jobStatus, appType: type } = buildStatus;

    if (jobStatus !== 'ready_for_preview' || !type || !E2B_TYPES.has(type)) {
      return undefined;
    }

    const jobKey = activeJobId ?? 'unknown';

    if (autoLaunchedJob.current === jobKey || launchRef.current || sandboxState !== 'idle') {
      return undefined;
    }

    autoLaunchedJob.current = jobKey;

    let cancelled = false;

    (async () => {
      /*
       * Wait for the ready_for_preview fetch to populate the store AND settle.
       * The fetch streams files in over a second or two; launching on the very
       * first file pushed an incomplete set to the sandbox and Vite failed to
       * resolve late-arriving assets (e.g. generated image modules). We now
       * wait until the file COUNT is non-zero and stable across two checks, so
       * the whole project — including big assets — is present before we push.
       */
      let prevCount = -1;

      for (let i = 0; i < 30 && !cancelled; i++) {
        const count = Object.keys(previewFilesStore.get()).length;

        if (count > 0 && count === prevCount) {
          break;
        }

        prevCount = count;
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (cancelled || Object.keys(previewFilesStore.get()).length === 0) {
        return;
      }

      await doLaunch();
    })().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [buildStatus.jobStatus, activeJobId, buildStatus.appType, sandboxState, doLaunch]);

  /*
   * When the preview becomes ready (auto or manual), surface it: open the
   * workbench and switch to the Preview view. On mobile, MobileShell reacts to
   * showWorkbench and moves the user to the Workspace tab automatically.
   */
  const surfacedUrl = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (sandboxState === 'ready' && sandboxUrl && surfacedUrl.current !== sandboxUrl) {
      surfacedUrl.current = sandboxUrl;
      workbenchStore.showWorkbench.set(true);
      workbenchStore.currentView.set('preview');
    }
  }, [sandboxState, sandboxUrl]);

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
  prewarmedId?: string,
): Promise<void> {
  const available = await isRemoteSandboxAvailable();

  if (!available) {
    setError('Cloud preview is not configured. Download the project files to run locally.');
    setState('error');

    return;
  }

  setState('writing');

  /*
   * Reuse the sandbox prewarmed during the build if present — its allocation
   * cold-start already happened, so we go straight to pushing files. Otherwise
   * allocate one now.
   */
  const sandbox = prewarmedId ? { id: prewarmedId, cached: true } : await createRemoteSandbox(appType);
  console.log('[worker-sandbox] sandbox', sandbox.id, prewarmedId ? '(prewarmed)' : `created cached=${sandbox.cached}`);
  await pushFiles(sandbox.id, files);

  setState('installing');

  /*
   * Start the dev server in the background. Now stack-aware: passes the
   * correct install + dev commands for the detected appType instead of
   * hardcoding npm for everything.
   *
   * StackRegistry (in external-worker) maps appType → {install, dev, port}.
   * For JS stacks: npm install + npm run dev (same as before).
   * For Python: pip install + python app.py.
   * For Flutter: flutter pub get + flutter run -d web-server.
   * For static: npx serve.
   */
  const stackCommands = getStackCommandsForAppType(appType);
  console.log(
    '[worker-sandbox] starting dev server (stack:',
    appType,
    'install:',
    stackCommands.install,
    'dev:',
    stackCommands.dev,
    ')',
  );
  startRemoteSandbox(sandbox.id, {
    install: stackCommands.install,
    dev: stackCommands.dev,
    port: stackCommands.port,
  })
    .then((url) => {
      console.log('[worker-sandbox] dev server started:', url);
    })
    .catch((err) => {
      console.error('[worker-sandbox] start failed:', err);
    });

  setState('starting');

  /*
   * Set the cookie immediately so the proxy can forward to this sandbox.
   * The trailing chatId scopes the preview to THIS conversation (see reconnect).
   */
  if (typeof document !== 'undefined') {
    document.cookie = `pf_preview=${sandbox.id}:3000:${currentChatId()}; path=/; samesite=lax`;
  }

  /*
   * Poll until the cloud dev server responds (up to ~120s).
   * The dev server needs time for: npm install (~10s) + vite start (~2s).
   */
  let ready = false;

  for (let i = 0; i < 40 && !ready; i++) {
    ready = await checkRemoteStatus(sandbox.id, 3000);
    console.log(`[worker-sandbox] poll ${i + 1}/40: ready=${ready}`);

    if (!ready) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /*
   * If the dev server never came up, surface a real error instead of showing
   * a "ready" state with a dead iframe — the user gets a Retry button rather
   * than a silent white screen.
   */
  if (!ready) {
    setError('The preview server did not start in time. Tap "Launch Preview" to retry.');
    setState('error');

    return;
  }

  const proxyUrl = typeof window !== 'undefined' ? `${window.location.origin}/preview/` : '/preview/';

  setUrl(proxyUrl);
  setState('ready');
  console.log('[worker-sandbox] sandbox ready, preview URL:', proxyUrl);
}
