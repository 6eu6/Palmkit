/**
 * useExternalWorker — Phase 2 Frontend Hook
 *
 * When USE_EXTERNAL_WORKER flag is on (localStorage), this hook takes over
 * the build flow:
 *   1. POST /api/jobs (enqueue) → jobId
 *   2. Poll GET /api/jobs?id=jobId every 1.5s
 *   3. Track status: pending → generating → validating → uploading_snapshot → ready_for_preview
 *   4. When ready, fetch files via /api/files?jobId=&path=
 *   5. Render preview from fetched files (blob URL in iframe)
 *
 * Coexists with the legacy /api/chat path — toggled by localStorage flag.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouteLoaderData } from '@remix-run/react';
import { setPreviewFiles, resetPreviewFiles } from '~/lib/stores/build-status';

const FLAG_KEY = 'palmkit_use_external_worker';
const POLL_INTERVAL_MS = 1500;

export interface JobEvent {
  type: string;
  seq: number;
  message: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface ExternalWorkerState {
  jobId: string | null;
  status:
    | 'idle'
    | 'pending'
    | 'generating'
    | 'validating'
    | 'uploading_snapshot'
    | 'ready_for_preview'
    | 'failed_clean';
  progress: number;
  currentStep: string;
  error: string | null;
  files: Array<{ path: string; size_bytes: number; integrity: string; mime_type: string }>;
  previewFiles: Record<string, string>;
  events: JobEvent[];

  /*
   * App type determined by the worker (static/react/nextjs/vue/python).
   * Runtime mode: static = blob URL preview; e2b/webcontainer = sandbox needed.
   */
  appType: string | null;
  runtimeMode: string | null;
}

const initialState: ExternalWorkerState = {
  jobId: null,
  status: 'idle',
  progress: 0,
  currentStep: '',
  error: null,
  files: [],
  previewFiles: {},
  events: [],
  appType: null,
  runtimeMode: null,
};

export function getExternalWorkerFlag(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const stored = localStorage.getItem(FLAG_KEY);

  /*
   * Default to TRUE — the external worker is now the primary build path.
   * It uses the agent-builder + workspace-manager architecture:
   * - Agent reads worklog.md (project memory) at start of every build
   * - Agent writes files to unified workspace in R2
   * - Agent appends to worklog.md after build
   * - Agent can read/edit existing files from previous builds
   *
   * The old streaming path (XML <palmkitArtifact> tags) is deprecated.
   * Users can still opt out by setting localStorage.palmkit_use_external_worker = 'false'.
   */
  if (stored === null) {
    return true;
  }

  return stored === 'true';
}

export function setExternalWorkerFlag(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(FLAG_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new Event('palmkit-worker-flag-change'));
}

export function useExternalWorkerFlag(): boolean {
  const [enabled, setEnabled] = useState(getExternalWorkerFlag());

  useEffect(() => {
    const handler = () => setEnabled(getExternalWorkerFlag());
    window.addEventListener('palmkit-worker-flag-change', handler);
    window.addEventListener('storage', handler);

    return () => {
      window.removeEventListener('palmkit-worker-flag-change', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  return enabled;
}

/**
 * Main hook: starts a job and polls until terminal state.
 */
export function useExternalWorker() {
  const [state, setState] = useState<ExternalWorkerState>(initialState);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedPreview = useRef(false);
  const realtimeChannel = useRef<any>(null);
  const lastEventSeq = useRef(0);
  const liveEvents = useRef<JobEvent[]>([]);

  // Get Supabase URL and anon key from root loader
  const rootData = useRouteLoaderData('root') as {
    supabaseUrl?: string | null;
    supabaseAnonKey?: string | null;
  } | undefined;

  /**
   * Subscribe to Supabase Realtime for live job events.
   * This gives INSTANT updates (no 1.5s polling delay) — the user sees
   * "📝 Written: src/App.jsx" the moment the agent writes the file.
   *
   * Falls back to polling if Realtime fails.
   */
  const subscribeRealtime = useCallback((jobId: string) => {
    try {
      const supabaseUrl = rootData?.supabaseUrl;
      const supabaseKey = rootData?.supabaseAnonKey;

      if (!supabaseUrl || !supabaseKey) {
        console.warn('[Palmkit] Realtime: Supabase URL/key not available, falling back to polling');
        return; // No Supabase config — fall back to polling
      }

      // Dynamic import to avoid bundling supabase if not needed
      import('@supabase/supabase-js').then(({ createClient }) => {
        const client = createClient(supabaseUrl, supabaseKey);

        const channel = client
          .channel(`job:${jobId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'job_events', filter: `job_id=eq.${jobId}` },
            (payload: any) => {
              const event: JobEvent = {
                type: payload.new.type,
                seq: payload.new.seq,
                message: payload.new.message,
                payload: payload.new.payload,
                created_at: payload.new.created_at,
              };

              // Add to live events
              if (event.seq > lastEventSeq.current) {
                lastEventSeq.current = event.seq;
                liveEvents.current = [...liveEvents.current, event];

                // Update state with new event immediately
                setState((s) => ({
                  ...s,
                  events: [...s.events, event],
                  currentStep: event.message,
                }));

                /*
                 * LIVE FILE FETCH: When a file_written event arrives,
                 * immediately fetch that file from /api/workspace and
                 * populate workbenchStore.files so the Code tab shows it
                 * in real-time (not waiting for ready_for_preview).
                 */
                if (event.type === 'file_written' && event.payload?.filePath) {
                  const filePath = event.payload.filePath as string;

                  // Fetch the file content from the workspace API
                  fetch(
                    `/api/workspace?action=file&projectId=${jobId}&path=${encodeURIComponent(filePath)}`,
                  )
                    .then((r) => (r.ok ? r.text() : null))
                    .then(async (content) => {
                      if (!content) {
                        return;
                      }

                      // Update previewFilesStore
                      setPreviewFiles({ [filePath]: content });

                      // Update workbenchStore.files so Code tab shows it
                      try {
                        const { workbenchStore } = await import('~/lib/stores/workbench');
                        const currentFiles = workbenchStore.files.get();
                        workbenchStore.files.set({
                          ...currentFiles,
                          [filePath]: { type: 'file', content },
                        });
                      } catch {
                        // best-effort
                      }
                    })
                    .catch(() => {
                      // File not in workspace yet (R2 write may lag)
                    });
                }
              }
            },
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'build_jobs', filter: `id=eq.${jobId}` },
            (payload: any) => {
              const job = payload.new;

              let uiStatus: ExternalWorkerState['status'] = 'generating';

              if (job.status === 'ready_for_preview') {
                uiStatus = 'ready_for_preview';
              } else if (job.status === 'failed_clean') {
                uiStatus = 'failed_clean';
              }

              setState((s) => ({
                ...s,
                status: uiStatus,
                progress: job.progress ?? s.progress,
                error: job.error_summary ?? s.error,
              }));
            },
          )
          .subscribe();

        realtimeChannel.current = client;
        console.log('[Palmkit] Realtime subscribed for job:', jobId);
      });
    } catch {
      // Realtime failed — polling will handle it
    }
  }, [rootData?.supabaseUrl, rootData?.supabaseAnonKey]);

  const startJob = useCallback(
    async (prompt: string, model: string, provider: string, editFromJobId?: string, projectId?: string) => {
      setState({ ...initialState, status: 'pending', currentStep: 'queued' });
      fetchedPreview.current = false;
      resetPreviewFiles();

      try {
        const resp = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model,
            provider,
            ...(editFromJobId ? { editJobId: editFromJobId } : {}),
            ...(projectId ? { projectId } : {}),
          }),
        });

        if (!resp.ok) {
          const err = (await resp.json().catch(() => ({ error: 'Failed to start job' }))) as Record<string, unknown>;
          setState({ ...initialState, status: 'failed_clean', error: (err.error as string) ?? 'Failed to start job' });

          return;
        }

        const jobData = (await resp.json()) as { jobId: string };
        setState((s) => ({ ...s, jobId: jobData.jobId }));

        // Subscribe to Realtime for instant event updates
        lastEventSeq.current = 0;
        liveEvents.current = [];
        subscribeRealtime(jobData.jobId);

        // Also poll as fallback (Realtime may not be enabled)
        pollJob(jobData.jobId);
      } catch (err: unknown) {
        setState({
          ...initialState,
          status: 'failed_clean',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    },
    [],
  );

  const pollJob = useCallback((jobId: string) => {
    /*
     * Phase 1.4: Polling with planned Realtime upgrade.
     *
     * Current: poll /api/jobs every 1.5s (POLL_INTERVAL_MS).
     * Planned: subscribe to Supabase Realtime for instant updates.
     * Realtime will be added in Phase 2 once Supabase Realtime is enabled
     * on the project (needs `supabase realtime enable`).
     *
     * The polling logic below is kept as a fallback even after Realtime
     * is added, for resilience.
     */

    const poll = async () => {
      try {
        const resp = await fetch(`/api/jobs?id=${jobId}`);

        if (!resp.ok) {
          return;
        }

        const data = (await resp.json()) as Record<string, unknown>;

        // Map DB status to UI status.
        let uiStatus: ExternalWorkerState['status'] = 'pending';

        if (data.status === 'ready_for_preview') {
          uiStatus = 'ready_for_preview';
        } else if (data.status === 'failed_clean') {
          uiStatus = 'failed_clean';
        } else if (typeof data.currentStep === 'string' && data.currentStep.includes('plan')) {
          uiStatus = 'generating';
        } else if (typeof data.currentStep === 'string' && data.currentStep.includes('generate')) {
          uiStatus = 'generating';
        } else if (typeof data.currentStep === 'string' && data.currentStep.includes('validate')) {
          uiStatus = 'validating';
        } else if (typeof data.currentStep === 'string' && data.currentStep.includes('upload')) {
          uiStatus = 'uploading_snapshot';
        } else if (data.status === 'generating') {
          uiStatus = 'generating';
        }

        const appType = (data.appType as string | null) ?? null;
        const runtimeMode = (data.runtimeMode as string | null) ?? null;

        setState((s) => ({
          ...s,
          jobId,
          status: uiStatus,
          progress: (data.progress as number) ?? 0,
          currentStep: (data.currentStep as string) ?? '',
          error: (data.errorSummary as string | null) ?? null,
          files: Array.isArray(data.files) ? (data.files as ExternalWorkerState['files']) : [],
          events: Array.isArray(data.events) ? (data.events as JobEvent[]) : [],
          appType,
          runtimeMode,
        }));

        // Terminal states: stop polling.
        if (uiStatus === 'ready_for_preview') {
          /*
           * Fetch preview files for ALL app types, not just static.
           *
           * Previously this only fetched for static apps, leaving React/Vue/
           * Nextjs apps with an empty previewFilesStore. The Launch Preview
           * button checks previewFilesStore and returns early if empty,
           * so the E2B sandbox never starts.
           *
           * Now: fetch files for all types. For static apps, this enables
           * blob URL preview. For React/Vue/Nextjs, this populates the
           * file store so the Launch Preview button can push files to E2B.
           */
          if (!fetchedPreview.current) {
            fetchedPreview.current = true;

            // Use the new /api/workspace endpoint if we have a chatId,
            // otherwise fall back to /api/files with jobId.
            // The chatId is stored in validation_result.chatId (returned by /api/jobs)
            const vr = (data as any).validationResult || {};
            const chatId = vr.chatId as string | undefined;

            // Try /api/workspace first (new unified workspace)
            let fetched = false;

            if (chatId) {
              try {
                const listResp = await fetch(`/api/workspace?action=list&projectId=${chatId}`);

                if (listResp.ok) {
                  const listData = (await listResp.json()) as { files?: string[] };

                  if (listData.files && listData.files.length > 0) {
                    const previewFiles: Record<string, string> = {};

                    for (const f of listData.files) {
                      // Skip metadata files
                      if (f === 'worklog.md' || f === 'manifest.json') {
                        continue;
                      }

                      try {
                        const fileResp = await fetch(
                          `/api/workspace?action=file&projectId=${chatId}&path=${encodeURIComponent(f)}`,
                        );

                        if (fileResp.ok) {
                          previewFiles[f] = await fileResp.text();
                        }
                      } catch {
                        // skip
                      }
                    }

                    if (Object.keys(previewFiles).length > 0) {
                      setState((s) => ({ ...s, previewFiles }));
                      setPreviewFiles(previewFiles);

                      // Also populate workbenchStore.files so the Code tab
                      // shows the file tree and the editor can open files.
                      const { workbenchStore } = await import('~/lib/stores/workbench');
                      const fileMap: Record<string, { type: 'file'; content: string; isBinary?: boolean }> = {};

                      for (const [path, content] of Object.entries(previewFiles)) {
                        fileMap[path] = { type: 'file', content };
                      }
                      workbenchStore.files.set(fileMap as any);

                      fetched = true;
                      console.log(
                        `[Palmkit] Fetched ${Object.keys(previewFiles).length} preview files from /api/workspace`,
                      );
                    }
                  }
                }
              } catch {
                // fall through to legacy fetch
              }
            }

            // Fallback: legacy /api/files endpoint
            if (!fetched && data.files) {
              await fetchPreviewFiles(jobId, data.files as ExternalWorkerState['files']);
            }
          }

          return; // stop polling
        }

        if (uiStatus === 'failed_clean') {
          return; // stop polling
        }

        // Continue polling.
        pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        // Network error — retry after delay.
        pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();
  }, []);

  const fetchPreviewFiles = async (jobId: string, files: Array<{ path: string }>) => {
    const previewFiles: Record<string, string> = {};

    for (const f of files) {
      try {
        const resp = await fetch(`/api/files?jobId=${jobId}&path=${encodeURIComponent(f.path)}`);

        if (resp.ok) {
          previewFiles[f.path] = await resp.text();
        }
      } catch {
        // skip
      }
    }

    setState((s) => ({ ...s, previewFiles }));
    setPreviewFiles(previewFiles);
  };

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }

      // Unsubscribe from Realtime
      if (realtimeChannel.current) {
        try {
          realtimeChannel.current.removeAllChannels();
        } catch {
          // best-effort
        }
        realtimeChannel.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
    }

    // Unsubscribe from Realtime
    if (realtimeChannel.current) {
      try {
        realtimeChannel.current.removeAllChannels();
      } catch {
        // best-effort
      }
      realtimeChannel.current = null;
    }

    fetchedPreview.current = false;
    lastEventSeq.current = 0;
    liveEvents.current = [];
    setState(initialState);
  }, []);

  return { state, startJob, reset };
}

/**
 * Build a blob URL for the preview iframe from fetched files.
 * Rewrites relative links (styles.css, app.js) to blob URLs.
 */
export function buildPreviewBlobUrl(files: Record<string, string>): string | null {
  const html = files['index.html'];

  if (!html) {
    return null;
  }

  // Create blob URLs for CSS and JS.
  const blobUrls: Record<string, string> = {};

  for (const [path, content] of Object.entries(files)) {
    if (path === 'index.html') {
      continue;
    }

    const mime = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/plain';
    const blob = new Blob([content], { type: mime });
    blobUrls[path] = URL.createObjectURL(blob);
  }

  // Rewrite href/src in HTML to use blob URLs.
  let rewritten = html;

  for (const [path, url] of Object.entries(blobUrls)) {
    const fileName = path.split('/').pop() ?? path;

    // Replace href="styles.css" and src="app.js" etc.
    rewritten = rewritten.replace(new RegExp(`(href|src)=["']${fileName}["']`, 'g'), `$1="${url}"`);
  }

  const htmlBlob = new Blob([rewritten], { type: 'text/html' });

  return URL.createObjectURL(htmlBlob);
}
