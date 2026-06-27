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
};

export function getExternalWorkerFlag(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const stored = localStorage.getItem(FLAG_KEY);

  return stored !== 'false'; // true by default; false only if explicitly disabled
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

  const startJob = useCallback(async (prompt: string, model: string, provider: string) => {
    setState({ ...initialState, status: 'pending', currentStep: 'queued' });
    fetchedPreview.current = false;
    resetPreviewFiles();

    try {
      const resp = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model, provider }),
      });

      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({ error: 'Failed to start job' }))) as Record<string, unknown>;
        setState({ ...initialState, status: 'failed_clean', error: (err.error as string) ?? 'Failed to start job' });

        return;
      }

      const jobData = (await resp.json()) as { jobId: string };
      setState((s) => ({ ...s, jobId: jobData.jobId }));
      pollJob(jobData.jobId);
    } catch (err: unknown) {
      setState({
        ...initialState,
        status: 'failed_clean',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, []);

  const pollJob = useCallback((jobId: string) => {
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

        setState((s) => ({
          ...s,
          jobId,
          status: uiStatus,
          progress: (data.progress as number) ?? 0,
          currentStep: (data.currentStep as string) ?? '',
          error: (data.errorSummary as string | null) ?? null,
          files: Array.isArray(data.files) ? (data.files as ExternalWorkerState['files']) : [],
          events: Array.isArray(data.events) ? (data.events as JobEvent[]) : [],
        }));

        // Terminal states: stop polling.
        if (uiStatus === 'ready_for_preview') {
          // Fetch all files for preview.
          if (!fetchedPreview.current) {
            fetchedPreview.current = true;
            await fetchPreviewFiles(jobId, data.files as ExternalWorkerState['files']);
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
    };
  }, []);

  const reset = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
    }

    fetchedPreview.current = false;
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
