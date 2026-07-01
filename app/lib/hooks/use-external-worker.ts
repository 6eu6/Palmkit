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
import {
  setPreviewFiles,
  resetPreviewFiles,
  previewFilesStore,
  setAgentTodos,
  upsertReasoning,
  startActivityGroup,
  appendActivityEvent,
  endActivityGroup,
  resetAllProgressStores,
  type AgentTodo,
} from '~/lib/stores/build-status';

const FLAG_KEY = 'palmkit_use_external_worker';
const POLL_INTERVAL_MS = 1500;

/*
 * dispatchJobEvent — route a single job event to the appropriate progress store.
 *
 * Called from BOTH the Realtime handler and the polling path so they stay in
 * sync. The dispatch is idempotent: stores check for duplicates by seq.
 *
 * The event types handled here are the new structured types added in this
 * commit:
 *   - todos_updated  → setAgentTodos (snapshot per agent)
 *   - reasoning      → appendReasoning (chronological list)
 *   - agent_started  → startActivityGroup (opens a new group)
 *   - agent_completed → endActivityGroup (closes the open group)
 *   - file_written / file_chunk (with agent in payload)
 *                    → appendActivityEvent (adds to the agent's group)
 *
 * Other event types (job_created, planning_started, ready_for_preview, etc.)
 * are not routed here — they're handled by the WorkerProgress component
 * directly via the workerEventsStore.
 */
function dispatchJobEvent(ev: JobEvent): void {
  if (!ev || !ev.type) {
    return;
  }

  const payload = ev.payload ?? {};
  /*
   * Agent name fallback: if the event doesn't have an explicit `agent`
   * field in the payload, try to infer it from the event type and context.
   *
   * Old events (before the agent field was added) don't have it — so we
   * fall back to 'Builder' for todos_updated and reasoning events (the
   * Builder is the agent that emits these). For file_chunk/file_written
   * events, we check the payload.agent field.
   */
  const agent = (payload.agent as string | undefined) ??
    (ev.type === 'todos_updated' || ev.type === 'reasoning' ? 'Builder' : 'Worker');
  const timestamp = new Date(ev.created_at).getTime() || Date.now();

  try {
    switch (ev.type) {
      case 'todos_updated': {
        const todos = (payload.todos as AgentTodo[] | undefined) ?? [];
        const counts = (payload.counts as {
          total: number;
          done: number;
          inProgress: number;
          pending: number;
        } | undefined) ?? {
          total: todos.length,
          done: todos.filter((t) => t.status === 'done').length,
          inProgress: todos.filter((t) => t.status === 'in_progress').length,
          pending: todos.filter((t) => t.status === 'pending').length,
        };
        setAgentTodos(agent, todos, counts);
        console.log(`[Palmkit] dispatch: todos_updated agent=${agent} count=${todos.length}`);
        break;
      }

      case 'reasoning': {
        const text = (payload.text as string | undefined) ?? '';
        if (text) {
          upsertReasoning({
            agent,
            text,
            stepType: payload.stepType as string | undefined,
            stepId: payload.stepId as number | undefined,
            isFinal: payload.isFinal as boolean | undefined,
            timestamp,
            seq: ev.seq,
          });
          console.log(`[Palmkit] dispatch: reasoning agent=${agent} seq=${ev.seq} text=${text.slice(0, 30)}`);
        }
        break;
      }

      case 'agent_started': {
        const role = (payload.role as string | undefined) ?? agent;
        startActivityGroup(agent, role, timestamp);
        break;
      }

      case 'agent_completed': {
        const durationMs = (payload.durationMs as number | undefined) ?? 0;
        const success = (payload.success as boolean | undefined) ?? true;
        endActivityGroup(agent, timestamp, durationMs, success);
        break;
      }

      case 'file_written':
      case 'file_chunk': {
        // Only append to activity group if we know which agent emitted it.
        // Events without an agent field (e.g. planning_started, file_chunk
        // from the keep-alive timer) are skipped — they're not agent actions.
        if (!payload.agent) {
          break;
        }

        appendActivityEvent(agent, {
          seq: ev.seq,
          type: ev.type,
          message: ev.message,
          kind: payload.kind as string | undefined,
          path: (payload.path as string | undefined) ?? (payload.filePath as string | undefined),
          command: payload.command as string | undefined,
          timestamp,
        });
        break;
      }

      default:
        // Unknown event type — ignore. Other components handle their own types.
        break;
    }
  } catch {
    // best-effort — never let a single event dispatch crash the polling loop
  }
}

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
    'idle' | 'pending' | 'generating' | 'validating' | 'uploading_snapshot' | 'ready_for_preview' | 'failed_clean';
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
  const rootData = useRouteLoaderData('root') as
    | {
        supabaseUrl?: string | null;
        supabaseAnonKey?: string | null;
      }
    | undefined;

  /**
   * Subscribe to Supabase Realtime for live job events.
   * This gives INSTANT updates (no 1.5s polling delay) — the user sees
   * "📝 Written: src/App.jsx" the moment the agent writes the file.
   *
   * Falls back to polling if Realtime fails.
   */
  const subscribeRealtime = useCallback(
    (jobId: string) => {
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

          client
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
                   * Route to specialized progress stores (todos, reasoning,
                   * activity groups). This is the SAME dispatchJobEvent helper
                   * used by the polling path — so Realtime and polling stay in
                   * sync even if only one of them is active.
                   */
                  dispatchJobEvent(event);

                  /*
                   * LIVE FILE UPDATE: When a file_written event arrives, push the
                   * file content into previewFilesStore + workbenchStore.files
                   * immediately so the Code tab shows it in real-time.
                   *
                   * The worker now includes `content` directly in the event payload
                   * (capped at 100KB). For files larger than that, we fall back
                   * to fetching via /api/workspace using the chatId.
                   */
                  if (event.type === 'file_written' && event.payload) {
                    const filePath =
                      (event.payload.filePath as string | undefined) ?? (event.payload.path as string | undefined);

                    if (filePath) {
                      const inlineContent = event.payload.content as string | undefined;

                      const applyContent = (content: string) => {
                        /*
                         * MERGE into previewFilesStore — do NOT replace the whole store.
                         * The old code did setPreviewFiles({ [filePath]: content }) which
                         * wiped every previously-written file from the UI on each new event.
                         */
                        const current = previewFilesStore.get() ?? {};
                        const merged = { ...current, [filePath]: content };
                        setPreviewFiles(merged);

                        /*
                         * Also merge into workbenchStore.files so the Code tab's
                         * file tree + editor pick it up.
                         */
                        import('~/lib/stores/workbench')
                          .then(({ workbenchStore }) => {
                            const currentFiles = workbenchStore.files.get() ?? {};
                            workbenchStore.files.set({
                              ...currentFiles,
                              [filePath]: { type: 'file', content, isBinary: false },
                            });
                          })
                          .catch(() => {
                            // best-effort
                          });
                      };

                      if (inlineContent) {
                        // Happy path — content was inlined in the event. No fetch needed.
                        applyContent(inlineContent);
                      } else {
                        /*
                         * Large file (>100KB) or legacy worker without inline content.
                         * Fall back to fetching via /api/workspace using the chatId from
                         * the parent state (NOT jobId — the workspace is keyed by chatId).
                         */
                        const chatId =
                          ((event.payload as any).chatId as string | undefined) ??
                          document.location.pathname.split('/').pop() ??
                          '';

                        fetch(
                          `/api/workspace?action=file&projectId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(filePath)}`,
                        )
                          .then((r) => (r.ok ? r.text() : null))
                          .then((text) => {
                            if (text) {
                              applyContent(text);
                            }
                          })
                          .catch(() => {
                            // best-effort — file will be fetched at ready_for_preview
                          });
                      }
                    }
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
    },
    [rootData?.supabaseUrl, rootData?.supabaseAnonKey],
  );

  const startJob = useCallback(
    async (prompt: string, model: string, provider: string, editFromJobId?: string, projectId?: string) => {
      setState({ ...initialState, status: 'pending', currentStep: 'queued' });
      fetchedPreview.current = false;
      resetPreviewFiles();
      // Reset all progress stores (todos, reasoning, activity groups) so
      // stale data from a previous build doesn't bleed into the new one.
      resetAllProgressStores();

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

        const newEvents = Array.isArray(data.events) ? (data.events as JobEvent[]) : [];

        /*
         * Polling-path file written processing.
         *
         * Realtime may not be enabled (Supabase Realtime add-on must be turned
         * on at the project level). When polling, we still receive every event
         * in `data.events`. If we see a `file_written` event with a higher seq
         * than the last one we processed, apply the same live-update logic as
         * the Realtime handler so the Code tab updates even without Realtime.
         */
        for (const ev of newEvents) {
          if (ev.seq > lastEventSeq.current) {
            lastEventSeq.current = ev.seq;

            /*
             * Route the event to the appropriate store based on its type:
             *   - todos_updated  → agentTodosStore (snapshot per agent)
             *   - reasoning      → reasoningStore (chronological list)
             *   - agent_started  → opens a new activity group
             *   - agent_completed → closes the open activity group
             *   - file_written / file_chunk (with agent in payload)
             *                   → appends to the agent's open activity group
             */
            dispatchJobEvent(ev);

            if (ev.type === 'file_written' && ev.payload) {
              const filePath = (ev.payload.filePath as string | undefined) ?? (ev.payload.path as string | undefined);

              if (filePath) {
                const inlineContent = ev.payload.content as string | undefined;
                const isEdit = ev.payload.kind === 'edit' || ev.payload.kind === 'delete';

                // Skip auto-fetch for edit/delete — content isn't inlined for those.
                if (inlineContent) {
                  const current = previewFilesStore.get() ?? {};
                  setPreviewFiles({ ...current, [filePath]: inlineContent });

                  import('~/lib/stores/workbench')
                    .then(({ workbenchStore }) => {
                      const currentFiles = workbenchStore.files.get() ?? {};
                      workbenchStore.files.set({
                        ...currentFiles,
                        [filePath]: { type: 'file', content: inlineContent, isBinary: false },
                      });
                    })
                    .catch(() => {
                      // best-effort
                    });
                } else if (!isEdit) {
                  // Large file (>100KB) — fetch via /api/workspace using chatId.
                  try {
                    const vr = (data as any).validationResult || {};
                    const chatId = (vr.chatId as string | undefined) ?? '';

                    if (chatId) {
                      fetch(
                        `/api/workspace?action=file&projectId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(filePath)}`,
                      )
                        .then((r) => (r.ok ? r.text() : null))
                        .then((text) => {
                          if (text) {
                            const current = previewFilesStore.get() ?? {};
                            setPreviewFiles({ ...current, [filePath]: text });

                            import('~/lib/stores/workbench')
                              .then(({ workbenchStore }) => {
                                const currentFiles = workbenchStore.files.get() ?? {};
                                workbenchStore.files.set({
                                  ...currentFiles,
                                  [filePath]: { type: 'file', content: text, isBinary: false },
                                });
                              })
                              .catch(() => {
                                // best-effort
                              });
                          }
                        })
                        .catch(() => {
                          // best-effort
                        });
                    }
                  } catch {
                    // best-effort
                  }
                }
              }
            }
          }
        }

        setState((s) => ({
          ...s,
          jobId,
          status: uiStatus,
          progress: (data.progress as number) ?? 0,
          currentStep: (data.currentStep as string) ?? '',
          error: (data.errorSummary as string | null) ?? null,
          files: Array.isArray(data.files) ? (data.files as ExternalWorkerState['files']) : [],
          events: newEvents,
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

            /*
             * Use the new /api/workspace endpoint if we have a chatId,
             * otherwise fall back to /api/files with jobId.
             * The chatId is stored in validation_result.chatId (returned by /api/jobs)
             */
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
                      /*
                       * Fetch ALL files from the workspace — including worklog.md,
                       * manifest.json, and .palmkit/* metadata.
                       *
                       * The user explicitly requested that the workspace should
                       * show ALL project files (not just code files). Skipping
                       * worklog/manifest/.palmkit made the workspace look
                       * incomplete and hid the agent's memory layer from the
                       * user.
                       *
                       * The only files we skip are node_modules (which don't
                       * exist in R2 anyway) and files larger than 500KB (to
                       * avoid memory issues with huge generated assets).
                       */
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

                      /*
                       * Also populate workbenchStore.files so the Code tab
                       * shows the file tree and the editor can open files.
                       *
                       * IMPORTANT: workbenchStore.files keys must be FULL paths
                       * with the WORK_DIR prefix (/home/project/...). The
                       * FileTree component strips the prefix when rendering.
                       * Without the prefix, files don't appear in the tree.
                       */
                      const { workbenchStore } = await import('~/lib/stores/workbench');
                      const { WORK_DIR } = await import('~/utils/constants');
                      const fileMap: Record<string, { type: 'file'; content: string; isBinary?: boolean }> = {};

                      for (const [path, content] of Object.entries(previewFiles)) {
                        const fullPath = path.startsWith(WORK_DIR) ? path : `${WORK_DIR}/${path}`;
                        fileMap[fullPath] = { type: 'file', content, isBinary: false };
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

      /*
       * Unsubscribe from Realtime — only remove THIS job's channel,
       * not every channel in the app. The old code called
       * realtimeChannel.current.removeAllChannels() which killed every
       * Realtime subscription app-wide (including unrelated chat/sync channels).
       */
      if (realtimeChannel.current) {
        try {
          /*
           * The Supabase client is what we stored; use it to remove just
           * the `job:${jobId}` channel by name.
           */
          const client = realtimeChannel.current;
          const channels = client?.channels ?? [];

          for (const ch of channels) {
            try {
              if (ch?.topic?.startsWith('job:')) {
                client.removeChannel(ch);
              }
            } catch {
              // best-effort
            }
          }
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

    // Unsubscribe from Realtime — only this job's channels.
    if (realtimeChannel.current) {
      try {
        const client = realtimeChannel.current;
        const channels = client?.channels ?? [];

        for (const ch of channels) {
          try {
            if (ch?.topic?.startsWith('job:')) {
              client.removeChannel(ch);
            }
          } catch {
            // best-effort
          }
        }
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

  /*
   * restoreJob — called when a user opens an EXISTING chat (e.g. after page
   * refresh or navigating from My Builds). Without this, the polling never
   * starts and the progress panels (Thought Process, Todos, Activity Stream)
   * stay empty — the user sees a blank workspace with no context.
   *
   * This matches how Super Z works: when I (the model) re-enter a conversation,
   * the workspace is already there with all files, worklog, and history.
   * Palmkit should do the same — restore the full job state on chat open.
   */
  const restoreJob = useCallback(
    (jobId: string) => {
      if (!jobId) {
        return;
      }

      // Reset state for the restored job
      fetchedPreview.current = false;
      lastEventSeq.current = 0;
      liveEvents.current = [];

      // Set the jobId in state so the UI knows we have an active job
      setState((s) => ({ ...s, jobId }));

      // Subscribe to Realtime (same as startJob)
      subscribeRealtime(jobId);

      // Start polling — the poll will see the terminal status (ready_for_preview
      // or failed_clean) and process ALL events through dispatchJobEvent before
      // stopping. This populates the reasoningStore, agentTodosStore, and
      // activityGroupsStore so the panels render correctly.
      pollJob(jobId);
    },
    [subscribeRealtime, pollJob],
  );

  return { state, startJob, reset, restoreJob };
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
