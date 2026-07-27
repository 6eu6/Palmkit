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
import { isRemoteSandboxAvailable, createRemoteSandbox } from '~/lib/sandbox/remoteSandbox';

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
  const prevJobRef = useRef(buildStatus.jobStatus);

  /*
   * SURVIVE PAGE REFRESH + RAPID CHAT SWITCHING.
   *
   * ROOT FIX (final): use localStorage per-chat instead of a single global
   * cookie. The old design used one `pf_preview` cookie that every chat
   * overwrote — switching from chat A to chat B erased A's preview cookie,
   * so returning to A showed "No preview available".
   *
   * Now each chat stores its preview info in localStorage under a per-chat key:
   *   localStorage[`pf_preview:${chatId}`] = `oracle:${projectId}`
   * This survives rapid switching, page refreshes, and multiple tabs.
   *
   * The cookie is still set (for the Pages Function to read) but only
   * temporarily — it's restored from localStorage on every chat switch.
   */
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    if (buildStatusStore.get().jobStatus === 'generating') {
      return;
    }

    const chatId = currentChatId();

    if (!chatId) {
      return;
    }

    /*
     * Read this chat's preview info from localStorage (per-chat key).
     * Falls back to the old cookie format for backward compatibility.
     */
    const storageKey = `pf_preview:${chatId}`;
    let previewInfo: string | null = null;

    try {
      previewInfo = localStorage.getItem(storageKey);
    } catch {
      // localStorage might be blocked — fall back to cookie
    }

    // Backward compat: check old cookie if localStorage is empty
    if (!previewInfo) {
      const match = document.cookie.match(/(?:^|;\s*)pf_preview=([^;]+)/);

      if (match) {
        const [sid, , cookieChatId = ''] = decodeURIComponent(match[1]).split(':');

        if (cookieChatId === chatId && sid === 'oracle') {
          previewInfo = decodeURIComponent(match[1]);
        }
      }
    }

    if (!previewInfo) {
      return;
    }

    const [sid, portStr = ''] = previewInfo.split(':');

    if (sid === 'oracle') {
      // Set the cookie so the Pages Function can read the projectId
      document.cookie = `pf_preview=oracle:${portStr}:${chatId}; path=/; samesite=lax`;
      setSandboxUrl(`${window.location.origin}/preview/`);
      setSandboxState('ready');
      setUsesMobileE2B(false);
      console.log('[worker-sandbox] restored prebuilt preview for project', portStr);
    }

    /*
     * Re-run when the URL pathname changes (switching chats).
     */
  }, [typeof window !== 'undefined' ? window.location.pathname : '']);

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

    launchRef.current = true;
    setSandboxError(undefined);

    try {
      /*
       * ROOT FIX (P4 final): unified preview path.
       *
       * Old design had THREE separate preview paths:
       *   1. prebuilt preview (Oracle-built dist → /preview/)
       *   2. E2B reconnect (resume existing sandbox)
       *   3. E2B fresh launch (create sandbox, push files, start dev server)
       *
       * Each had its own cookie logic, regex extraction, error handling, and
       * reconnect guards. The result: edge cases everywhere, "No preview
       * available" on chat reopen, frozen status, E2B OOM, billing blocks.
       *
       * New design: ONE path. Oracle builds + uploads dist to R2 + Supabase,
       * the Pages Function at /preview/ serves it with correct Content-Type.
       * No E2B sandbox for preview — E2B is only used (optionally) for run_shell
       * during build, never for the preview itself.
       *
       * The pf_preview cookie still carries the projectId + chatId so the
       * Pages Function knows which project's dist to serve.
       */
      const jobData = (buildStatusStore.get() as any)._jobValidationResult;
      const hasPrebuiltPreview = jobData?.hasPrebuiltPreview === true;
      const previewUrl = jobData?.previewUrl as string | undefined;
      const projectId = jobData?.projectId as string | undefined;

      if (!hasPrebuiltPreview || !previewUrl || !projectId) {
        setSandboxError('Build not ready for preview. The worker may still be generating files.');
        setSandboxState('idle');

        return;
      }

      /*
       * Set the cookie so /preview/ Pages Function knows which project to serve.
       * Also persist to localStorage per-chat so rapid chat switching can restore it.
       */
      if (typeof document !== 'undefined') {
        const chatId = currentChatId();
        document.cookie = `pf_preview=oracle:${projectId}:${chatId}; path=/; samesite=lax`;

        try {
          localStorage.setItem(`pf_preview:${chatId}`, `oracle:${projectId}`);
        } catch {
          // localStorage might be blocked — cookie is the fallback
        }
      }

      setSandboxUrl(`${window.location.origin}/preview/`);
      setSandboxState('ready');
      setUsesMobileE2B(false);
      console.log('[worker-sandbox] preview ready for project', projectId);
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
