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

  /** Prebuilt preview info from Oracle worker's local build (if available). */
  _jobValidationResult?: {
    hasPrebuiltPreview?: boolean;
    previewUrl?: string;
    previewType?: string;
    distFileCount?: number;
    distPrefix?: string;
  } | null;
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
  _jobValidationResult: null,
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
 * Context pressure — the REAL, server-measured signal for when a chat's
 * context is getting genuinely long. The worker measures the peak input
 * (prompt) tokens the model actually consumed on its most demanding request
 * during the build, relative to that model's context window. This reflects
 * accumulated chat + operations + files-the-model-actually-read — NOT a naive
 * file count. A freshly-imported 300-file repo that the model only reads a
 * few files from stays LOW; a long, edit-heavy chat climbs toward 1.0.
 *
 *   ratio     = peakPromptTokens / contextWindow  (0..1+)
 *   truncated = the model hit its context/output limit (finishReason=length)
 */
export interface ContextPressure {
  tokens: number;
  window: number;
  ratio: number;
  truncated: boolean;
}

export const contextPressureStore = atom<ContextPressure | null>(null);

export function setContextPressure(p: ContextPressure | null): void {
  contextPressureStore.set(p);
}

/**
 * The jobId currently shown by the LIVE global <BuildStream> (the newest
 * build). Per-turn <TurnBuildStream> renders every OTHER build inline under its
 * message; it skips this one so the active build isn't drawn twice.
 */
export const activeBuildJobIdStore = atom<string | null>(null);

/** Phase 8 — current Oracle Worker job ID (for export). */
export const currentJobIdStore = atom<string | null>(null);

export function setCurrentJobId(jobId: string | null): void {
  currentJobIdStore.set(jobId);
}

/** Phase 5 — real-time worker progress events shown in the chat panel. */
export interface WorkerEvent {
  type: string;
  seq: number;
  message: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export const workerEventsStore = atom<WorkerEvent[]>([]);

export function setWorkerEvents(events: WorkerEvent[]): void {
  workerEventsStore.set(events);
}

export function clearWorkerEvents(): void {
  workerEventsStore.set([]);
}

/*
 * Structured Todo item — published by the agent via the `update_todos` tool.
 * The agent sends the FULL list each time (not diffs), so we just keep the
 * latest snapshot per agent (Builder, Tester, Researcher).
 */
export interface AgentTodo {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface AgentTodoSnapshot {
  agent: string;
  todos: AgentTodo[];
  counts: { total: number; done: number; inProgress: number; pending: number };
  updatedAt: number;
}

/*
 * Latest todos snapshot PER agent. Key = agent name (e.g. "Builder").
 * When a new `todos_updated` event arrives, we replace the snapshot for that
 * agent (the agent always sends the full list, so this is correct).
 */
export const agentTodosStore = atom<Record<string, AgentTodoSnapshot>>({});

export function setAgentTodos(agent: string, todos: AgentTodo[], counts: AgentTodoSnapshot['counts']): void {
  const current = agentTodosStore.get();
  agentTodosStore.set({
    ...current,
    [agent]: { agent, todos, counts, updatedAt: Date.now() },
  });
}

export function clearAgentTodos(): void {
  agentTodosStore.set({});
}

/*
 * Reasoning text — emitted by the orchestrator as a `reasoning` event
 * containing the LLM's actual text output (streamed live via streamText).
 *
 * The orchestrator flushes the text buffer every 500ms, so multiple events
 * arrive for the SAME step. Each event carries a `stepId` so the client can
 * merge them into a single entry (append text to the existing entry with
 * the same agent+stepId, instead of creating a new entry each time).
 *
 * This is what makes the Thought Process panel stream live — the text grows
 * in place as new chunks arrive, exactly like Claude Code / Cursor / Super Z.
 */
export interface ReasoningEntry {
  agent: string;
  text: string;
  stepType?: string;
  stepId?: number;
  isFinal?: boolean;
  timestamp: number;
  seq: number;
}

export const reasoningStore = atom<ReasoningEntry[]>([]);

/*
 * Upsert reasoning — if an entry with the same (agent, stepId) already
 * exists, append the new text to it (streaming merge). Otherwise create a
 * new entry.
 *
 * The dedup-by-seq check prevents the same event from being processed twice
 * (can happen when both Realtime and polling deliver the same event).
 */
export function upsertReasoning(entry: ReasoningEntry): void {
  const current = reasoningStore.get();

  // Dedup by seq — if we've already seen this exact event, skip.
  if (current.some((r) => r.seq === entry.seq)) {
    return;
  }

  /*
   * If this entry has a stepId, try to find an existing entry with the
   * same agent+stepId to merge into (streaming append).
   */
  if (entry.stepId !== undefined) {
    const mergeIdx = current.findIndex((r) => r.agent === entry.agent && r.stepId === entry.stepId);

    if (mergeIdx !== -1) {
      // Merge: append the new text to the existing entry.
      const updated = [...current];
      updated[mergeIdx] = {
        ...updated[mergeIdx],
        text: updated[mergeIdx].text + entry.text,
        isFinal: entry.isFinal,
      };
      reasoningStore.set(updated);

      return;
    }
  }

  // No existing entry to merge into — create a new one.
  reasoningStore.set([...current, entry]);
}

/** @deprecated Use upsertReasoning instead — it handles streaming merge. */
export function appendReasoning(entry: ReasoningEntry): void {
  upsertReasoning(entry);
}

export function clearReasoning(): void {
  reasoningStore.set([]);
}

/*
 * Activity stream — groups of events per agent (Builder, Tester, Researcher).
 * Each group has a summary ("Explored X files, Wrote Y files, Ran Z commands")
 * and a list of inner events that can be expanded.
 */
export interface ActivityEvent {
  seq: number;
  type: string;
  message: string;
  kind?: string;
  path?: string;
  command?: string;
  timestamp: number;
}

export interface ActivityGroup {
  agent: string;
  role: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  success?: boolean;
  events: ActivityEvent[];
}

export const activityGroupsStore = atom<ActivityGroup[]>([]);

export function startActivityGroup(agent: string, role: string, startedAt: number): void {
  const current = activityGroupsStore.get();

  // Don't add a duplicate if the same agent already has an open group
  if (current.some((g) => g.agent === agent && !g.endedAt)) {
    return;
  }

  activityGroupsStore.set([...current, { agent, role, startedAt, events: [] }]);
}

export function appendActivityEvent(agent: string, event: ActivityEvent): void {
  const current = activityGroupsStore.get();

  // Find the latest open group for this agent
  const groupIdx = current.findIndex((g) => g.agent === agent && !g.endedAt);

  if (groupIdx === -1) {
    // No open group for this agent — create one on the fly
    activityGroupsStore.set([
      ...current,
      {
        agent,
        role: agent,
        startedAt: event.timestamp,
        events: [event],
      },
    ]);
    return;
  }

  const updated = [...current];
  updated[groupIdx] = {
    ...updated[groupIdx],
    events: [...updated[groupIdx].events, event],
  };
  activityGroupsStore.set(updated);
}

export function endActivityGroup(agent: string, endedAt: number, durationMs: number, success: boolean): void {
  const current = activityGroupsStore.get();
  const groupIdx = current.findIndex((g) => g.agent === agent && !g.endedAt);

  if (groupIdx === -1) {
    return;
  }

  const updated = [...current];
  updated[groupIdx] = {
    ...updated[groupIdx],
    endedAt,
    durationMs,
    success,
  };
  activityGroupsStore.set(updated);
}

export function clearActivityGroups(): void {
  activityGroupsStore.set([]);
}

/**
 * Live terminal — the real shell commands the worker runs in the E2B sandbox,
 * streamed to the client so the workbench terminal shows "$ npm run build" with
 * a spinner while it runs, then the stdout/stderr and exit code when it lands.
 * Fed by the worker's shell_command (start) + shell_output (finish) events.
 */
export interface TerminalLine {
  seq: number;
  command: string;
  running: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export const terminalOutputStore = atom<TerminalLine[]>([]);

export function pushShellCommand(seq: number, command: string): void {
  const current = terminalOutputStore.get();

  // Dedup — the same seq can be delivered by both Realtime and polling.
  if (current.some((l) => l.seq === seq)) {
    return;
  }

  terminalOutputStore.set([...current, { seq, command, running: true }]);
}

export function completeShellCommand(command: string, exitCode: number, stdout?: string, stderr?: string): void {
  const current = terminalOutputStore.get();

  // Match the most recent still-running line for this command.
  for (let i = current.length - 1; i >= 0; i--) {
    if (current[i].command === command && current[i].running) {
      const updated = [...current];
      updated[i] = { ...updated[i], running: false, exitCode, stdout, stderr };
      terminalOutputStore.set(updated);

      return;
    }
  }

  // No matching start (e.g. restore replays only the output) — append complete.
  terminalOutputStore.set([
    ...current,
    { seq: (current[current.length - 1]?.seq ?? 0) + 1, command, running: false, exitCode, stdout, stderr },
  ]);
}

export function clearTerminalOutput(): void {
  terminalOutputStore.set([]);
}

/**
 * Diff baseline — a snapshot of the project's files (WORK_DIR-prefixed path →
 * original content) captured the moment a build/edit starts, BEFORE the worker
 * streams new versions in. The Diff view seeds its fileHistory.originalContent
 * from this, so as files stream the diff shows the real before→after for this
 * turn's changes — live. Empty for a fresh project (nothing to diff against).
 */
export const diffBaselineStore = atom<Record<string, string>>({});

export function setDiffBaseline(baseline: Record<string, string>): void {
  diffBaselineStore.set(baseline);
}

/** Reset all real-time progress stores — called when a new chat starts. */
export function resetAllProgressStores(): void {
  workerEventsStore.set([]);
  agentTodosStore.set({});
  reasoningStore.set([]);
  activityGroupsStore.set([]);
  terminalOutputStore.set([]);
  diffBaselineStore.set({});
}

/** Phase 10 — real progress percentage + step from the Oracle Worker. */
export interface WorkerProgress {
  progress: number;
  currentStep: string;
}

export const workerProgressStore = atom<WorkerProgress>({ progress: 0, currentStep: '' });

export function setWorkerProgress(progress: number, currentStep: string): void {
  workerProgressStore.set({ progress, currentStep });
}

export function resetWorkerProgress(): void {
  workerProgressStore.set({ progress: 0, currentStep: '' });
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

  /*
   * Show preview when the build is ready, regardless of the old
   * artifact/file balance checks. The external worker path sets
   * all these to true when ready_for_preview, but the checks were
   * too strict and sometimes blocked the preview even when the
   * sandbox was running and ready.
   */
  if (status.jobStatus === 'ready_for_preview') {
    return true;
  }

  // During build: don't show preview (show "Building..." instead)
  return false;
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
