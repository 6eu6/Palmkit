/**
 * Build Status Store — Phase 1 Ready-for-Preview Gate
 *
 * Single source of truth for the current build's validation state.
 * Populated from the `validation` annotations streamed by api.chat.ts
 * (see writeMessageAnnotation({type:'validation', ...}) in the route).
 *
 * The Preview component reads `buildStatus` to decide whether to render
 * the iframe or show the "No preview available" state. This is the GATE
 * that prevents partial/broken previews from reaching the user.
 *
 * See ROADMAP.md → Phase 1 → "Fix partial preview".
 */

import { atom, computed } from 'nanostores';

export type BuildCompleteness = 'complete' | 'incomplete' | 'garbage' | 'invalid' | 'unknown';
export type BuildJobStatus = 'generating' | 'incomplete_retrying' | 'failed_clean' | 'ready_for_preview' | 'idle';

export interface BuildStatusState {
  /** Latest completeness verdict from the validator. */
  completeness: BuildCompleteness;

  /** Mapped job status from api.chat.ts. */
  jobStatus: BuildJobStatus;

  /** Did the LLM emit __PALMKIT_DONE__? */
  hasCompletionMarker: boolean;

  /** Are all <palmkitArtifact> tags balanced? */
  artifactTagsBalanced: boolean;

  /** Are all <palmkitAction> tags balanced? */
  fileActionsBalanced: boolean;

  /** Number of file actions detected. */
  fileCount: number;

  /** Human-readable issues from the validator. */
  issues: Array<{ code: string; message: string; severity: 'error' | 'warning'; filePath?: string }>;

  /** Retry count so far. */
  retryCount: number;

  /** Timestamp of the last update (ms since epoch). */
  updatedAt: number;

  /** Phase 2: app type from the external worker (static/react/nextjs/vue/python). */
  appType: string | null;
}

const initial: BuildStatusState = {
  completeness: 'unknown',
  jobStatus: 'idle',
  hasCompletionMarker: false,
  artifactTagsBalanced: false,
  fileActionsBalanced: false,
  fileCount: 0,
  issues: [],
  retryCount: 0,
  updatedAt: 0,
  appType: null,
};

export const buildStatusStore = atom<BuildStatusState>(initial);

/**
 * Phase 2: Preview files from the external worker (R2).
 * When the worker completes a job, the frontend fetches files via /api/files
 * and populates this store. The Preview component reads it to build a blob URL.
 */
export const previewFilesStore = atom<Record<string, string>>({});

export function setPreviewFiles(files: Record<string, string>): void {
  previewFilesStore.set(files);
}

export function resetPreviewFiles(): void {
  previewFilesStore.set({});
}

/**
 * Update the store from a validation annotation value.
 * Called by Chat.client.tsx when it sees a `type: 'validation'` annotation.
 */
export function setBuildStatus(payload: Partial<BuildStatusState>): void {
  const current = buildStatusStore.get();
  buildStatusStore.set({
    ...current,
    ...payload,
    updatedAt: Date.now(),
  });
}

/** Reset to idle — called when a new chat starts. */
export function resetBuildStatus(): void {
  buildStatusStore.set({ ...initial, updatedAt: Date.now() });
}

/**
 * Computed: is it SAFE to show the preview?
 *
 * The gate is CLOSED (preview blocked) unless ALL of:
 *   - completeness === 'complete'
 *   - hasCompletionMarker === true
 *   - artifactTagsBalanced === true
 *   - fileActionsBalanced === true
 *   - fileCount > 0
 *
 * Any other state → show "No preview available" + the status message.
 */
export const canShowPreview = computed(buildStatusStore, (status) => {
  // Before any build has run, allow the normal "no preview" state.
  if (status.jobStatus === 'idle') {
    return true;
  }

  return (
    status.completeness === 'complete' &&
    status.hasCompletionMarker &&
    status.artifactTagsBalanced &&
    status.fileActionsBalanced &&
    status.fileCount > 0
  );
});

/**
 * Computed: human-readable status message for the UI.
 * Returns null when there's nothing to show (idle or complete).
 */
export const buildStatusMessage = computed(buildStatusStore, (status) => {
  switch (status.jobStatus) {
    case 'idle':
      return null;
    case 'generating':
      return 'Generating Response';
    case 'incomplete_retrying':
      return `Still building… (attempt ${status.retryCount + 1})`;
    case 'failed_clean':
      return status.issues[0]?.message || 'Build incomplete — stream was interrupted. Please try again.';
    case 'ready_for_preview': {
      const appType = status.appType;

      if (appType === 'flutter') {
        return 'Flutter app ready — run: flutter pub get && flutter run';
      }

      if (appType === 'react-native') {
        return 'React Native app ready — run: npx expo start';
      }

      if (appType && appType !== 'static') {
        return `${appType} app ready — download files and run: npm install && npm run dev`;
      }

      return 'Build complete — ready for preview';
    }
    default:
      return null;
  }
});
