import { atom, map } from 'nanostores';

export type GenerationStep =
  | 'idle'
  | 'waiting-for-model'
  | 'creating-files'
  | 'updating-workspace'
  | 'starting-preview'
  | 'done'
  | 'error';

export type RestoreStep =
  | 'idle'
  | 'loading-messages'
  | 'restoring-chat'
  | 'restoring-files'
  | 'restoring-webcontainer'
  | 'done'
  | 'error';

export interface GenerationStatusState {
  step: GenerationStep;
  currentFile: string | null;
  startTime: number | null;
  lastActivityTime: number | null;
  isStuck: boolean;
  errorMessage: string | null;
}

export interface RestoreStatusState {
  step: RestoreStep;
  wasInterrupted: boolean;
}

export const generationStatusStore = map<GenerationStatusState>({
  step: 'idle',
  currentFile: null,
  startTime: null,
  lastActivityTime: null,
  isStuck: false,
  errorMessage: null,
});

export const restoreStatusStore = map<RestoreStatusState>({
  step: 'idle',
  wasInterrupted: false,
});

export const isRestoring = atom<boolean>(false);

const STUCK_TIMEOUT_MS = 30_000; // 30 seconds of no activity = potentially stuck

let stuckCheckInterval: ReturnType<typeof setInterval> | null = null;

export function setGenerationStep(step: GenerationStep, currentFile?: string | null) {
  const now = Date.now();
  const state = generationStatusStore.get();

  generationStatusStore.set({
    ...state,
    step,
    currentFile: currentFile ?? state.currentFile,
    lastActivityTime: now,
    isStuck: false,
    errorMessage: step === 'error' ? state.errorMessage : null,
  });

  // Start stuck detection when generation begins
  if (step === 'waiting-for-model' || step === 'creating-files') {
    if (state.startTime === null) {
      generationStatusStore.set({ ...generationStatusStore.get(), startTime: now });
    }

    startStuckDetection();
  }

  if (step === 'done' || step === 'idle' || step === 'error') {
    stopStuckDetection();
  }
}

export function setGenerationError(message: string) {
  const state = generationStatusStore.get();
  generationStatusStore.set({
    ...state,
    step: 'error',
    errorMessage: message,
    isStuck: false,
  });
  stopStuckDetection();
}

export function resetGenerationStatus() {
  generationStatusStore.set({
    step: 'idle',
    currentFile: null,
    startTime: null,
    lastActivityTime: null,
    isStuck: false,
    errorMessage: null,
  });
  stopStuckDetection();
}

export function setRestoreStep(step: RestoreStep, wasInterrupted?: boolean) {
  const state = restoreStatusStore.get();
  restoreStatusStore.set({
    ...state,
    step,
    wasInterrupted: wasInterrupted ?? state.wasInterrupted,
  });

  if (step === 'done' || step === 'error' || step === 'idle') {
    isRestoring.set(false);
  } else {
    isRestoring.set(true);
  }
}

export function resetRestoreStatus() {
  restoreStatusStore.set({
    step: 'idle',
    wasInterrupted: false,
  });
  isRestoring.set(false);
}

function startStuckDetection() {
  if (stuckCheckInterval) {
    return;
  }

  stuckCheckInterval = setInterval(() => {
    const state = generationStatusStore.get();

    if (state.step !== 'idle' && state.step !== 'done' && state.step !== 'error' && state.lastActivityTime !== null) {
      const elapsed = Date.now() - state.lastActivityTime;

      if (elapsed > STUCK_TIMEOUT_MS) {
        generationStatusStore.set({ ...generationStatusStore.get(), isStuck: true });
      }
    }
  }, 5000);
}

function stopStuckDetection() {
  if (stuckCheckInterval) {
    clearInterval(stuckCheckInterval);
    stuckCheckInterval = null;
  }
}

/**
 * Human-readable labels for generation steps
 */
export const GENERATION_STEP_LABELS: Record<GenerationStep, string> = {
  idle: '',
  'waiting-for-model': 'Waiting for model response...',
  'creating-files': 'Creating files...',
  'updating-workspace': 'Updating workspace...',
  'starting-preview': 'Starting preview...',
  done: 'Done',
  error: 'Error',
};

/**
 * Human-readable labels for restore steps
 */
export const RESTORE_STEP_LABELS: Record<RestoreStep, string> = {
  idle: '',
  'loading-messages': 'Loading chat messages...',
  'restoring-chat': 'Restoring chat...',
  'restoring-files': 'Restoring files...',
  'restoring-webcontainer': 'Restoring WebContainer...',
  done: '',
  error: 'Restore failed',
};
