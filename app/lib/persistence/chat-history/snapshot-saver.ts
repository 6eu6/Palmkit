/**
 * Snapshot persistence helpers — debounced saver + progress-store reader.
 *
 * Extracted from useChatHistory.ts during P4 decomposition.
 *
 * The debounced saver prevents excessive IndexedDB writes while streaming
 * while ensuring data is persisted frequently enough.
 */

import type { FileMap } from '~/lib/stores/files';
import { getSnapshot, setSnapshot } from '~/lib/persistence/db';
import type { Snapshot } from '~/lib/persistence/types';

/**
 * readProgressStores — read the current values of the structured progress
 * stores (agentTodosStore, reasoningStore, activityGroupsStore) for snapshot
 * persistence.
 *
 * We use a direct dynamic import (NOT a string variable) so Vite can
 * statically analyze and bundle the module. The previous safeGetStore
 * helper used a string variable which broke Vite's module resolution —
 * the import silently returned undefined and the snapshot was saved
 * without the progress data.
 *
 * Returns undefined for any store that can't be read (best-effort —
 * snapshot save should never crash the chat).
 */
export async function readProgressStores(): Promise<{
  agentTodos?: any;
  reasoning?: any;
  activityGroups?: any;
}> {
  try {
    const mod: any = await import('~/lib/stores/build-status');

    return {
      agentTodos: mod.agentTodosStore?.get?.(),
      reasoning: mod.reasoningStore?.get?.(),
      activityGroups: mod.activityGroupsStore?.get?.(),
    };
  } catch {
    return {};
  }
}

/**
 * Debounce utility for snapshot saves during streaming.
 * Prevents excessive IndexedDB writes while ensuring data is persisted frequently enough.
 */
export function createDebouncedSnapshotSaver(delay: number = 2000) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastSavePromise: Promise<void> = Promise.resolve();

  return async (chatIdx: string, files: FileMap, dbInstance: IDBDatabase, chatIdVal: string, chatSummary?: string) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    lastSavePromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(async () => {
        try {
          let snapshotFiles = files;

          /*
           * If the current call has no files (e.g. WebContainer didn't boot so
           * workbenchStore.files is empty), preserve whatever files were stored
           * in the last snapshot so we don't erase a previously-captured state.
           * We always update chatIndex so the restore point advances to the
           * latest turn even in environments where the preview sandbox isn't running.
           */
          if (Object.keys(snapshotFiles).length === 0) {
            try {
              const existing = await getSnapshot(dbInstance, chatIdVal);

              if (existing?.files && Object.keys(existing.files).length > 0) {
                snapshotFiles = existing.files;
              }
            } catch {
              // ignore — just use empty files
            }
          }

          const snapshot: Snapshot = {
            chatIndex: chatIdx,
            files: snapshotFiles,
            summary: chatSummary,

            /*
             * Persist structured progress data so the user can refresh the
             * page mid-build and still see the Todos / Thought Process /
             * Activity Stream panels populated.
             *
             * Without persistence, these stores live only in nanostores
             * (in-memory) and disappear on page refresh.
             */
            ...(await readProgressStores()),
          };
          await setSnapshot(dbInstance, chatIdVal, snapshot);
        } catch (error) {
          console.error('Failed to save debounced snapshot:', error);
        }
        resolve();
      }, delay);
    });

    return lastSavePromise;
  };
}

export const debouncedSnapshotSaver = createDebouncedSnapshotSaver(2000);
