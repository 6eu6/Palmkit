/**
 * Stream Client Stores — typed nanostores for each event group.
 *
 * The router (in stream-router.ts) dispatches incoming StreamEvents
 * to these stores. Components subscribe to the store(s) they care about,
 * keeping render scope minimal:
 *
 *   - chatMessagesStore:        message:* events → chat thread
 *   - reasoningStore:           reasoning:* events → reasoning popover
 *   - activityStore:            tool:* + build:* events → activity panel
 *   - streamStatusStore:        status:* + stream:* events → status bar
 *
 * The diag events are dropped (no UI surface in production).
 */

import { atom, computed } from 'nanostores';
import type { StreamEvent, StreamIcon, Severity, StreamMode } from './types';

/* ────────────────────────────────────────────────────────────── */
/*  Chat messages store                                           */
/* ────────────────────────────────────────────────────────────── */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  startedAt: number;
  endedAt?: number;

  /** Stream this message belongs to (correlation id). */
  streamId?: string;
}

export const chatMessagesStore = atom<ChatMessage[]>([]);

export function appendMessageStart(event: Extract<StreamEvent, { kind: 'message:start' }>): void {
  const existing = chatMessagesStore.get();
  const msg: ChatMessage = {
    id: event.messageId,
    role: event.role,
    text: '',
    startedAt: event.ts,
    streamId: event.messageId,
  };
  chatMessagesStore.set([...existing, msg]);
}

export function appendMessageDelta(event: Extract<StreamEvent, { kind: 'message:delta' }>): void {
  const existing = chatMessagesStore.get();
  const idx = existing.findIndex((m) => m.id === event.messageId);

  if (idx === -1) {
    return;
  } // message not started — drop

  const next = [...existing];
  next[idx] = { ...next[idx], text: next[idx].text + event.text };
  chatMessagesStore.set(next);
}

export function appendMessageEnd(event: Extract<StreamEvent, { kind: 'message:end' }>): void {
  const existing = chatMessagesStore.get();
  const idx = existing.findIndex((m) => m.id === event.messageId);

  if (idx === -1) {
    return;
  }

  const next = [...existing];
  next[idx] = { ...next[idx], endedAt: event.ts };
  chatMessagesStore.set(next);
}

export function clearChatMessages(): void {
  chatMessagesStore.set([]);
}

/* ────────────────────────────────────────────────────────────── */
/*  Reasoning store                                               */
/* ────────────────────────────────────────────────────────────── */

export interface ReasoningChunk {
  messageId: string;
  text: string;
  startedAt: number;
  endedAt?: number;
}

export const reasoningStore = atom<ReasoningChunk[]>([]);

export function appendReasoningStart(event: Extract<StreamEvent, { kind: 'reasoning:start' }>): void {
  const existing = reasoningStore.get();

  if (existing.some((r) => r.messageId === event.messageId)) {
    return;
  }

  reasoningStore.set([
    ...existing,
    {
      messageId: event.messageId,
      text: '',
      startedAt: event.ts,
    },
  ]);
}

export function appendReasoningDelta(event: Extract<StreamEvent, { kind: 'reasoning:delta' }>): void {
  const existing = reasoningStore.get();
  const idx = existing.findIndex((r) => r.messageId === event.messageId);

  if (idx === -1) {
    return;
  }

  const next = [...existing];
  next[idx] = { ...next[idx], text: next[idx].text + event.text };
  reasoningStore.set(next);
}

export function appendReasoningEnd(event: Extract<StreamEvent, { kind: 'reasoning:end' }>): void {
  const existing = reasoningStore.get();
  const idx = existing.findIndex((r) => r.messageId === event.messageId);

  if (idx === -1) {
    return;
  }

  const next = [...existing];
  next[idx] = { ...next[idx], endedAt: event.ts };
  reasoningStore.set(next);
}

export function clearReasoning(): void {
  reasoningStore.set([]);
}

/* ────────────────────────────────────────────────────────────── */
/*  Activity store — tool calls + build progress                  */
/* ────────────────────────────────────────────────────────────── */

export interface ToolCallEntry {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  icon: StreamIcon;
  label: string;
  startedAt: number;
  result?: unknown;
  ok?: boolean;
  durationMs?: number;
  summary?: string;
  endedAt?: number;
}

export interface BuildStatusEntry {
  status: 'planning' | 'analyzing' | 'building' | 'verifying' | 'complete' | 'failed' | 'cancelled';
  message: string;
  icon: StreamIcon;
  severity: Severity;
  ts: number;
}

export interface BuildFileEntry {
  path: string;
  action: 'create' | 'edit' | 'delete';
  linesAdded?: number;
  linesRemoved?: number;
  ts: number;
}

export interface BuildRetryEntry {
  attempt: number;
  maxAttempts: number;
  reason: string;
  icon: StreamIcon;
  ts: number;
}

export interface ActivityState {
  toolCalls: ToolCallEntry[];
  buildStatus: BuildStatusEntry | null;
  buildFiles: BuildFileEntry[];
  buildRetries: BuildRetryEntry[];
}

const EMPTY_ACTIVITY: ActivityState = {
  toolCalls: [],
  buildStatus: null,
  buildFiles: [],
  buildRetries: [],
};

export const activityStore = atom<ActivityState>(EMPTY_ACTIVITY);

export function appendToolCall(event: Extract<StreamEvent, { kind: 'tool:call' }>): void {
  const state = activityStore.get();
  activityStore.set({
    ...state,
    toolCalls: [
      ...state.toolCalls,
      {
        callId: event.callId,
        toolName: event.toolName,
        args: event.args,
        icon: event.icon,
        label: event.label,
        startedAt: event.ts,
      },
    ],
  });
}

export function appendToolResult(event: Extract<StreamEvent, { kind: 'tool:result' }>): void {
  const state = activityStore.get();
  const idx = state.toolCalls.findIndex((t) => t.callId === event.callId);

  if (idx === -1) {
    return;
  }

  const next = [...state.toolCalls];
  next[idx] = {
    ...next[idx],
    result: event.result,
    ok: event.ok,
    durationMs: event.durationMs,
    summary: event.summary,
    endedAt: event.ts,
  };
  activityStore.set({ ...state, toolCalls: next });
}

export function appendBuildStatus(event: Extract<StreamEvent, { kind: 'build:status' }>): void {
  const state = activityStore.get();
  activityStore.set({
    ...state,
    buildStatus: {
      status: event.status,
      message: event.message,
      icon: event.icon,
      severity: event.severity,
      ts: event.ts,
    },
  });
}

export function appendBuildFile(event: Extract<StreamEvent, { kind: 'build:file' }>): void {
  const state = activityStore.get();
  activityStore.set({
    ...state,
    buildFiles: [
      ...state.buildFiles,
      {
        path: event.path,
        action: event.action,
        linesAdded: event.linesAdded,
        linesRemoved: event.linesRemoved,
        ts: event.ts,
      },
    ],
  });
}

export function appendBuildRetry(event: Extract<StreamEvent, { kind: 'build:retry' }>): void {
  const state = activityStore.get();
  activityStore.set({
    ...state,
    buildRetries: [
      ...state.buildRetries,
      {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        reason: event.reason,
        icon: event.icon,
        ts: event.ts,
      },
    ],
  });
}

export function clearActivity(): void {
  activityStore.set(EMPTY_ACTIVITY);
}

/* ────────────────────────────────────────────────────────────── */
/*  Stream status store                                           */
/* ────────────────────────────────────────────────────────────── */

export interface StreamStatus {
  active: boolean;
  mode: StreamMode | null;
  intent: string | null;
  confidence: number;
  text: string;
  icon: StreamIcon;
  progress?: number;
  startedAt?: number;
  endedAt?: number;
  endReason?: 'complete' | 'cancelled' | 'error' | 'timeout';
  errorMessage?: string;
  stats?: { durationMs: number; tokenCount?: number; segments?: number };
}

const IDLE_STATUS: StreamStatus = {
  active: false,
  mode: null,
  intent: null,
  confidence: 0,
  text: '',
  icon: 'ph:chat-circle-text-duotone',
};

export const streamStatusStore = atom<StreamStatus>(IDLE_STATUS);

export function setStreamStart(event: Extract<StreamEvent, { kind: 'stream:start' }>): void {
  streamStatusStore.set({
    active: true,
    mode: event.mode,
    intent: event.intent,
    confidence: event.confidence,
    text: '',
    icon: 'ph:chat-circle-text-duotone',
    startedAt: event.ts,
  });
}

export function setStreamStatusUpdate(event: Extract<StreamEvent, { kind: 'status:update' }>): void {
  const current = streamStatusStore.get();

  if (!current.active) {
    return;
  } // ignore stray status after stream end

  streamStatusStore.set({
    ...current,
    text: event.text,
    icon: event.icon,
    progress: event.progress,
  });
}

export function setStreamEnd(event: Extract<StreamEvent, { kind: 'stream:end' }>): void {
  const current = streamStatusStore.get();
  streamStatusStore.set({
    ...current,
    active: false,
    endedAt: event.ts,
    endReason: event.reason,
    errorMessage: event.error,
    stats: event.stats,
    icon:
      event.reason === 'complete'
        ? 'ph:check-circle-duotone'
        : event.reason === 'cancelled'
          ? 'ph:stop-duotone'
          : 'ph:x-circle-duotone',
  });
}

export function resetStreamStatus(): void {
  streamStatusStore.set(IDLE_STATUS);
}

/* ────────────────────────────────────────────────────────────── */
/*  Derived selectors                                             */
/* ────────────────────────────────────────────────────────────── */

/** Total files written in the current build. */
export const buildFileCount = computed(activityStore, (activity) => activity.buildFiles.length);

/** Total retries in the current build. */
export const buildRetryCount = computed(activityStore, (activity) => activity.buildRetries.length);
