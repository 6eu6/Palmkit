import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs';
import { authUserStore } from '~/lib/stores/auth';
import { setRestoreStep, isRestoring } from '~/lib/stores/generationStatus';
import {
  getMessages,
  getNextId,
  getUrlId,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  getSnapshot,
  setSnapshot,
  type IChatMetadata,
} from './db';
import { pushProjectDebounced, seedChatFromAccount, syncAllFromAccount } from './accountSync';
import type { FileMap } from '~/lib/stores/files';
import type { Snapshot } from './types';
import { webcontainer } from '~/lib/webcontainer';
import { detectProjectCommands, createCommandActionsString } from '~/utils/projectCommands';
import type { ContextAnnotation } from '~/types/context';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);

/**
 * Generate a smart, short title from the user's first message.
 * Strips model/provider tags, extracts the core intent, and produces
 * a concise, human-readable title capped at 50 chars.
 */
function generateSmartTitle(content: string): string {
  // Strip model/provider tags like [Model: xxx] [Provider: xxx]
  let cleaned = content
    .replace(/\[Model:.*?\]/g, '')
    .replace(/\[Provider:.*?\]/g, '')
    .trim();

  // Strip artifact XML tags that may be in the message
  cleaned = cleaned.replace(/<palmkitArtifact[\s\S]*?<\/palmkitArtifact>/g, '').trim();
  cleaned = cleaned.replace(/<palmkitAction[\s\S]*?<\/palmkitAction>/g, '').trim();

  // Also handle legacy bolt tags
  cleaned = cleaned.replace(/<boltArtifact[\s\S]*?<\/boltArtifact>/g, '').trim();
  cleaned = cleaned.replace(/<boltAction[\s\S]*?<\/boltAction>/g, '').trim();

  // Strip file modification tags
  cleaned = cleaned.replace(/<palmkit_file_modifications[\s\S]*?<\/palmkit_file_modifications>/g, '').trim();
  cleaned = cleaned.replace(/<bolt_file_modifications[\s\S]*?<\/bolt_file_modifications>/g, '').trim();

  // Strip code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '').trim();

  // Strip URLs (they make bad titles)
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '').trim();

  // Strip common conversational prefixes in multiple languages
  cleaned = cleaned.replace(
    /^(please\s+)?(can\s+you\s+|could\s+you\s+|i\s+want\s+|i\s+need\s+|i'd\s+like\s+|build\s+me\s+|create\s+me\s+|make\s+me\s+|help\s+me\s+|سوي\s+|ابنِ\s+|اعمل\s+|ساعدني\s+|اريد\s+|ابغى\s+|خليني\s+)/i,
    '',
  );

  // Take first meaningful line only
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const firstLine = lines[0] || '';

  // Detect the type of request and generate appropriate title format
  const actionPatterns: Array<{ pattern: RegExp; extract: (match: RegExpMatchArray) => string }> = [
    // Build/create patterns
    {
      pattern: /^(build|create|make|design|develop|write|generate|scaffold)\s+(?:a\s+|an\s+)?(.+)/i,
      extract: (m) => `${capitalize(m[1])} ${m[2]}`,
    },

    // Fix/debug patterns
    {
      pattern: /^(fix|debug|repair|solve|troubleshoot|resolve)\s+(?:the\s+|a\s+)?(.+)/i,
      extract: (m) => `Fix: ${m[2]}`,
    },

    // Update/modify patterns
    {
      pattern: /^(update|modify|change|improve|refactor|enhance|upgrade|optimize)\s+(?:the\s+|a\s+)?(.+)/i,
      extract: (m) => `Update: ${m[2]}`,
    },

    // Add patterns
    {
      pattern: /^(add|insert|implement|include|integrate)\s+(?:a\s+|an\s+|the\s+)?(.+)/i,
      extract: (m) => `Add: ${m[2]}`,
    },

    // Setup/configure patterns
    {
      pattern: /^(set\s?up|setup|configure|install|initialize)\s+(?:a\s+|the\s+)?(.+)/i,
      extract: (m) => `Setup: ${m[2]}`,
    },

    // Arabic patterns
    {
      pattern: /^(ابن|سوي|اعمل|اصنع|صمم|برمج|طور)\s+(.*)/i,
      extract: (m) => m[2],
    },
  ];

  for (const { pattern, extract } of actionPatterns) {
    const match = firstLine.match(pattern);

    if (match) {
      let title = extract(match).trim();

      if (title.length > 50) {
        title = title.slice(0, 47) + '...';
      }

      return title || 'New Chat';
    }
  }

  // Fallback: use the first line as-is, cleaned up
  let title = firstLine;

  // Remove trailing punctuation
  title = title.replace(/[.!?;:,]+$/, '').trim();

  if (title.length === 0) {
    // Try the second line if first was empty after cleanup
    const secondLine = lines[1] || '';
    title = secondLine.replace(/[.!?;:,]+$/, '').trim();
  }

  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }

  return title || 'New Chat';
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Debounce utility for snapshot saves during streaming.
 * Prevents excessive IndexedDB writes while ensuring data is persisted frequently enough.
 */
function createDebouncedSnapshotSaver(delay: number = 2000) {
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

const debouncedSnapshotSaver = createDebouncedSnapshotSaver(2000);

export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();
  const accountUser = useStore(authUserStore);

  /*
   * On sign-in, pull the user's projects from the account into the local store
   * so the chat list reflects work created on other devices.
   */
  useEffect(() => {
    if (db && accountUser) {
      syncAllFromAccount(db).catch(() => undefined);
    }
  }, [accountUser?.id]);

  useEffect(() => {
    /*
     * SILENT INSTANT RESTORE from sessionStorage (for worker builds).
     * This runs BEFORE the db check because IndexedDB might not be ready
     * on a fresh page load. sessionStorage is always available.
     */
    if (mixedId) {
      try {
        const sessionData = sessionStorage.getItem('palmkit_restore_files');

        if (sessionData) {
          const parsed = JSON.parse(sessionData);
          const previewFiles: Record<string, string> = parsed.files || {};

          if (Object.keys(previewFiles).length > 0) {
            // Populate workbench
            const fileMap: Record<string, { type: 'file'; content: string; isBinary?: boolean }> = {};

            for (const [path, content] of Object.entries(previewFiles)) {
              fileMap[path] = { type: 'file', content };
            }
            workbenchStore.files.set(fileMap as any);

            // Set stores for preview
            import('~/lib/stores/build-status').then(({ buildStatusStore, setPreviewFiles: setStore }) => {
              setStore(previewFiles);

              const current = buildStatusStore.get();
              buildStatusStore.set({
                ...current,
                jobStatus: 'ready_for_preview',
                completeness: 'complete',
                hasCompletionMarker: true,
                artifactTagsBalanced: true,
                fileActionsBalanced: true,
                fileCount: Object.keys(previewFiles).length,
              });
            });

            // Set a hidden message so the chat doesn't redirect
            setInitialMessages([
              {
                id: generateId(),
                role: 'assistant' as const,
                content: '',
                annotations: ['no-store', 'hidden'],
              } as Message,
            ]);
            chatId.set(mixedId);
            setReady(true);

            return; // Don't proceed to db check
          }
        }
      } catch {
        // best-effort — fall through to normal db-based restore
      }
    }

    if (!db) {
      setReady(true);

      if (persistenceEnabled) {
        const error = new Error('Chat persistence is unavailable');
        logStore.logError('Chat persistence initialization failed', error);
        toast.error('Chat persistence is unavailable - your work will not be saved');
      }

      return;
    }

    if (mixedId) {
      /*
       * A) Restore UX: Show restore overlay ONLY if restore takes longer than 250ms.
       * BUG FIX (2026-06-29): Previously isRestoring.set(true) was called
       * unconditionally on every chat load, causing the RestoreOverlay to flash
       * even for sub-100ms IndexedDB reads. The user perceived this as "files
       * loading / conversation loading" on every navigation. Now we use a
       * 250ms grace timer: fast restores never show the overlay at all.
       */
      let restoreStarted = false;
      const restoreGraceTimer = setTimeout(() => {
        if (!restoreStarted) {
          restoreStarted = true;
          isRestoring.set(true);
          setRestoreStep('loading-messages');
        }
      }, 250);

      const suppressOverlayIfFast = () => {
        clearTimeout(restoreGraceTimer);

        if (!restoreStarted) {
          // Fast path: restore already completed, never showed the overlay.
          isRestoring.set(false);
        }
      };

      seedChatFromAccount(db, mixedId)
        .catch(() => false)
        .then(async () => {
          /*
           * getMessages resolves by both internal ID and urlId;
           * use the resolved internal ID for snapshot lookup (snapshots are
           * stored under the internal chat ID, not the urlId).
           */
          const storedMessages = await getMessages(db, mixedId);
          const snapshotId = storedMessages?.id ?? mixedId;
          const snapshot = await getSnapshot(db, snapshotId);

          return [storedMessages, snapshot] as const;
        })
        .then(async ([storedMessages, snapshot]) => {
          const hasMessages = storedMessages && storedMessages.messages.length > 0;
          const hasSnapshot = snapshot && snapshot.files && Object.keys(snapshot.files).length > 0;

          if (!hasMessages && !hasSnapshot) {
            /*
             * SILENT INSTANT RESTORE for worker builds.
             *
             * When a user opens a worker build from "My Builds" page,
             * openBuild() fetches files from R2 and stores them in:
             * 1. previewFilesStore (nanostore — may have race condition)
             * 2. sessionStorage (reliable bridge across navigation)
             *
             * Check both sources. If files found, restore SILENTLY:
             * - Populate workbenchStore.files
             * - Set buildStatusStore to ready_for_preview
             * - No messages, no "Restoring..." overlay, no sandbox launch
             * - User sees their files + Preview tab instantly
             */
            try {
              // Check sessionStorage first (most reliable)
              const sessionData = sessionStorage.getItem('palmkit_restore_files');
              let previewFiles: Record<string, string> = {};

              if (sessionData) {
                try {
                  const parsed = JSON.parse(sessionData);
                  previewFiles = parsed.files || {};

                  /*
                   * Clean up — don't restore the same files twice
                   * Don't remove — keep as a flag to prevent re-processing
                   * sessionStorage.removeItem('palmkit_restore_files');
                   */
                } catch {
                  /* invalid JSON */
                }
              }

              // Fall back to nanostore if sessionStorage was empty
              if (Object.keys(previewFiles).length === 0) {
                const { previewFilesStore } = await import('~/lib/stores/build-status');
                previewFiles = previewFilesStore.get();
              }

              const hasPreviewFiles = Object.keys(previewFiles).length > 0;

              if (hasPreviewFiles) {
                /*
                 * SILENT restore — populate workbench, set build status, no messages.
                 * User just sees their files and preview like any normal page.
                 */
                const fileMap: Record<string, { type: 'file'; content: string; isBinary?: boolean }> = {};

                for (const [path, content] of Object.entries(previewFiles)) {
                  fileMap[path] = { type: 'file', content };
                }
                workbenchStore.files.set(fileMap as any);

                /*
                 * Set BOTH previewFilesStore AND buildStatusStore
                 * so Preview component can find files and show blob preview
                 */
                const { buildStatusStore, setPreviewFiles: setPreviewFilesStore } = await import(
                  '~/lib/stores/build-status'
                );
                setPreviewFilesStore(previewFiles);

                const current = buildStatusStore.get();
                buildStatusStore.set({
                  ...current,
                  jobStatus: 'ready_for_preview',
                  completeness: 'complete',
                  hasCompletionMarker: true,
                  artifactTagsBalanced: true,
                  fileActionsBalanced: true,
                  fileCount: Object.keys(previewFiles).length,
                });

                /*
                 * Set a single hidden message so the chat doesn't redirect.
                 * The user doesn't see this — it's just to keep the chat "started".
                 */
                setInitialMessages([
                  {
                    id: generateId(),
                    role: 'assistant' as const,
                    content: '',
                    annotations: ['no-store', 'hidden'],
                  } as Message,
                ]);
                chatId.set(mixedId);
                setReady(true);
                isRestoring.set(false);

                return;
              }
            } catch {
              // best-effort
            }

            isRestoring.set(false);
            navigate('/', { replace: true });
            setReady(true);

            return;
          }

          // A) Restore UX: Step - restoring chat
          setRestoreStep('restoring-chat');

          /*
           * Guarantee the generated files reappear on re-entry: set them into the
           * workbench as soon as a snapshot exists, independent of the message
           * index branching below (which only restores files for some shapes and
           * left single-generation chats with an empty file tree).
           */
          if (hasSnapshot) {
            try {
              workbenchStore.files.set(snapshot.files);
            } catch (e) {
              console.error('Failed to restore snapshot files into workbench:', e);
            }
          }

          if (hasMessages) {
            const validSnapshot = snapshot || { chatIndex: '', files: {} };
            const summary = validSnapshot.summary;

            const rewindId = searchParams.get('rewindTo');
            let startingIdx = -1;
            const endingIdx = rewindId
              ? storedMessages.messages.findIndex((m) => m.id === rewindId) + 1
              : storedMessages.messages.length;
            const snapshotIndex = storedMessages.messages.findIndex((m) => m.id === validSnapshot.chatIndex);

            if (snapshotIndex >= 0 && snapshotIndex < endingIdx) {
              startingIdx = snapshotIndex;
            }

            if (snapshotIndex > 0 && storedMessages.messages[snapshotIndex].id == rewindId) {
              startingIdx = -1;
            }

            let filteredMessages = storedMessages.messages.slice(startingIdx + 1, endingIdx);
            let archivedMsgs: Message[] = [];

            if (startingIdx >= 0) {
              archivedMsgs = storedMessages.messages.slice(0, startingIdx + 1);
            }

            /*
             * When the snapshot points to the LAST assistant message and there
             * are no messages after it, archiving everything leaves the user
             * staring at a blank chat (only the 2-message restore pair visible).
             * Instead, keep the full pre-snapshot history visible and only
             * prepend the hidden restore trigger; the "Palmkit Restored" status
             * banner will still be injected at the end.
             */
            const snapshotIsLastMessage = filteredMessages.length === 0 && archivedMsgs.length > 1;

            if (snapshotIsLastMessage) {
              /*
               * Show all messages (including the snapshot message) + append
               * the restore pair at the end so the AI knows the project state.
               */
              filteredMessages = [...archivedMsgs];
              archivedMsgs = [];
            }

            setArchivedMessages(archivedMsgs);

            if (startingIdx > 0) {
              // A) Restore UX: Step - restoring files
              setRestoreStep('restoring-files');

              const files = Object.entries(validSnapshot?.files || {})
                .map(([key, value]) => {
                  if (value?.type !== 'file') {
                    return null;
                  }

                  return {
                    content: value.content,
                    path: key,
                  };
                })
                .filter((x): x is { content: string; path: string } => !!x);
              const projectCommands = await detectProjectCommands(files);

              const commandActionsString = createCommandActionsString(projectCommands);

              // Check if generation was interrupted (artifact open but not closed)
              const snapshotMessage = storedMessages.messages[snapshotIndex];
              const wasInterrupted =
                snapshotMessage?.role === 'assistant' && snapshotMessage.content
                  ? snapshotMessage.content.includes('<palmkitArtifact') &&
                    !snapshotMessage.content.includes('</palmkitArtifact')
                  : false;

              /*
               * BUG FIX (2026-06-29): If the snapshot has NO files (e.g. the
               * 2s debounced snapshot saver hadn't fired when the page was
               * refreshed), DON'T create a fake "restored-project-setup"
               * artifact. Doing so would queue empty file actions and the
               * Artifact component would stay stuck on "Restoring Project..."
               * forever (because allActionFinished never flips to true).
               *
               * Instead, fall through to the else branch (line ~651) which
               * just sets restoreStep to 'done' without inventing files.
               */
              const snapshotHasFiles = !!(snapshot?.files && Object.keys(snapshot.files).length > 0);

              if (wasInterrupted && !snapshotHasFiles) {
                /*
                 * Skip the fake restore artifact — show the partial assistant
                 * message as-is and let the user retry the build manually.
                 */
                setRestoreStep('done', true);
                toast.info(
                  'Build was interrupted before any files were saved. Please re-send your prompt to restart the build.',
                  { autoClose: 8000 },
                );
                setInitialMessages(filteredMessages);
                setUrlId(storedMessages.urlId);
                description.set(storedMessages.description);
                chatId.set(storedMessages.id);
                chatMetadata.set(storedMessages.metadata);
                setReady(true);
                suppressOverlayIfFast();

                return;
              }

              /*
               * When the snapshot is the last message we re-use all archived
               * messages as visible ones (full history shown to the user).
               * In that case the restore assistant must NOT reuse the snapshot
               * message's id — that id already appears in filteredMessages —
               * so we give it a fresh id to avoid React key collisions.
               */
              const restoreAssistantId = snapshotIsLastMessage
                ? generateId()
                : storedMessages.messages[snapshotIndex].id;

              const restorePair: Message[] = [
                {
                  id: generateId(),
                  role: 'user',
                  content: `Restore project from snapshot`,
                  annotations: ['no-store', 'hidden'],
                } as Message,
                {
                  id: restoreAssistantId,
                  role: 'assistant',
                  content: `Palmkit Restored your chat from a snapshot. You can revert this message to load the full chat history.
                  <palmkitArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
                  ${Object.entries(snapshot?.files || {})
                    .map(([key, value]) => {
                      if (value?.type === 'file') {
                        return `
                      <palmkitAction type="file" filePath="${key}">
${value.content}
                      </palmkitAction>
                      `;
                      } else {
                        return ``;
                      }
                    })
                    .join('\n')}
                  ${commandActionsString}
                  </palmkitArtifact>
                  `,
                  annotations: [
                    'no-store',
                    ...(summary
                      ? [
                          {
                            chatId: storedMessages.messages[snapshotIndex].id,
                            type: 'chatSummary',
                            summary,
                          } satisfies ContextAnnotation,
                        ]
                      : []),
                  ],
                } as Message,
              ];

              /*
               * When the snapshot was the last message, `filteredMessages` already
               * holds the FULL conversation (all archived msgs). Append the
               * restore pair at the end so the user sees their complete history.
               * Otherwise (snapshot in the middle) prepend so context comes first.
               */
              filteredMessages = snapshotIsLastMessage
                ? [...filteredMessages, ...restorePair]
                : [...restorePair, ...filteredMessages];

              // A) Restore UX: Step - restoring WebContainer
              setRestoreStep('restoring-webcontainer', wasInterrupted);

              workbenchStore.files.set(validSnapshot.files);

              /*
               * WebContainer boot can stall in some environments.
               * Files are already written to workbenchStore above; the WC write
               * is only needed for terminal execution (npm run dev), not preview.
               * After 10 s we proceed without blocking the UI.
               */
              try {
                await Promise.race([
                  restoreSnapshot(mixedId, validSnapshot),
                  new Promise<void>((_, reject) => setTimeout(() => reject(new Error('wc-timeout')), 10000)),
                ]);
              } catch (wcErr) {
                if (wcErr instanceof Error && wcErr.message !== 'wc-timeout') {
                  throw wcErr;
                }

                console.warn('[Palmkit] WebContainer restore timed out — continuing without it');
              }

              // A) Restore UX: Done
              setRestoreStep('done', wasInterrupted);

              if (wasInterrupted) {
                toast.info('Generation was interrupted. Restored the latest saved snapshot.', { autoClose: 5000 });
              } else {
                toast.success('Workspace restored from last snapshot.', { autoClose: 3000 });
              }
            } else {
              setRestoreStep('done');
            }

            setInitialMessages(filteredMessages);

            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else if (hasSnapshot) {
            // Snapshot exists but no messages - restore from snapshot
            setRestoreStep('restoring-files', true);

            const validSnapshot = snapshot;

            const files = Object.entries(validSnapshot.files || {})
              .map(([key, value]) => {
                if (value?.type !== 'file') {
                  return null;
                }

                return {
                  content: value.content,
                  path: key,
                };
              })
              .filter((x): x is { content: string; path: string } => !!x);
            const projectCommands = await detectProjectCommands(files);
            const commandActionsString = createCommandActionsString(projectCommands);

            const restoredMessages: Message[] = [
              {
                id: generateId(),
                role: 'user',
                content: `Restore project from snapshot`,
                annotations: ['no-store', 'hidden'],
              },
              {
                id: validSnapshot.chatIndex || generateId(),
                role: 'assistant',
                content: `Palmkit Restored your chat from a snapshot (generation was interrupted). You can continue from here.
                  <palmkitArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
                  ${Object.entries(validSnapshot.files || {})
                    .map(([key, value]) => {
                      if (value?.type === 'file') {
                        return `
                      <palmkitAction type="file" filePath="${key}">
${value.content}
                      </palmkitAction>
                      `;
                      } else {
                        return ``;
                      }
                    })
                    .join('\n')}
                  ${commandActionsString} 
                  </palmkitArtifact>
                  `,
                annotations: [
                  'no-store',
                  ...(validSnapshot.summary
                    ? [
                        {
                          chatId: validSnapshot.chatIndex || '',
                          type: 'chatSummary',
                          summary: validSnapshot.summary,
                        } satisfies ContextAnnotation,
                      ]
                    : []),
                ],
              },
            ];

            setRestoreStep('restoring-webcontainer', true);

            workbenchStore.files.set(validSnapshot.files);

            try {
              await Promise.race([
                restoreSnapshot(mixedId, validSnapshot),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('wc-timeout')), 10000)),
              ]);
            } catch (wcErr) {
              if (wcErr instanceof Error && wcErr.message !== 'wc-timeout') {
                throw wcErr;
              }

              console.warn('[Palmkit] WebContainer restore timed out — continuing without it');
            }

            setRestoreStep('done', true);

            toast.info('Generation was interrupted. Restored the latest saved snapshot.', { autoClose: 5000 });

            setInitialMessages(restoredMessages);
            chatId.set(storedMessages?.id || mixedId);
            setUrlId(storedMessages?.urlId);
          }

          setReady(true);

          /*
           * Fast-restore path: if the restore completed within the 250ms grace
           * window, the overlay never showed — make sure isRestoring is false.
           */
          suppressOverlayIfFast();

          /*
           * BUG FIX (2026-06-29): Restore worker-built files from R2 on page reload.
           *
           * When using the external worker path, files are stored in R2 (not in the
           * IndexedDB snapshot). On page reload, previewFilesStore was empty, so the
           * user saw "No preview available" even though files existed in R2.
           *
           * Now: if chat metadata has palmkitJobId, fetch files from R2 via /api/files
           * and populate previewFilesStore + workbenchStore so the preview renders.
           * Also restore appType to buildStatusStore so the sandbox hook knows whether
           * to use blob URL (static), WebContainer (React desktop), or show a launch
           * button (mobile/Python).
           */
          const storedMeta = storedMessages?.metadata as
            | {
                palmkitJobId?: string;
                palmkitAppType?: string;
              }
            | undefined;
          const jobId = storedMeta?.palmkitJobId;
          const savedAppType = storedMeta?.palmkitAppType;

          if (jobId) {
            try {
              // Fetch the file manifest from /api/jobs (gives us the file list + status + appType)
              const jobResp = await fetch(`/api/jobs?id=${jobId}`);
              const jobData = (await jobResp.json()) as {
                files?: Array<{ path: string }>;
                status?: string;
                appType?: string;
              };

              // Use the appType from the job response (most reliable), fall back to metadata.
              const restoredAppType = jobData.appType ?? savedAppType ?? null;

              /*
               * Restore appType to buildStatusStore so the sandbox hook can decide
               * blob URL (static) vs WebContainer (React desktop) vs E2B (mobile/Python).
               * Without this, canUseSandbox = false and the user sees "No preview available"
               * with no launch button — even for projects that COULD run in a sandbox.
               */
              if (restoredAppType) {
                const { buildStatusStore } = await import('~/lib/stores/build-status');
                const current = buildStatusStore.get();
                buildStatusStore.set({
                  ...current,
                  appType: restoredAppType,
                  jobStatus: 'ready_for_preview',
                  completeness: 'complete',
                  hasCompletionMarker: true,
                  artifactTagsBalanced: true,
                  fileActionsBalanced: true,
                  fileCount: jobData.files?.length ?? current.fileCount,
                });
              }

              if (jobData.status === 'ready_for_preview' && Array.isArray(jobData.files) && jobData.files.length > 0) {
                const previewFiles: Record<string, string> = {};

                for (const f of jobData.files) {
                  try {
                    const fileResp = await fetch(`/api/files?jobId=${jobId}&path=${encodeURIComponent(f.path)}`);

                    if (fileResp.ok) {
                      previewFiles[f.path] = await fileResp.text();
                    }
                  } catch {
                    // skip individual file errors
                  }
                }

                if (Object.keys(previewFiles).length > 0) {
                  // Populate the preview files store so the blob URL preview renders.
                  const { setPreviewFiles } = await import('~/lib/stores/build-status');
                  setPreviewFiles(previewFiles);

                  // Also populate the workbench files so the code editor shows them.
                  const fileMap: Record<string, { type: 'file'; content: string; isBinary?: boolean }> = {};

                  for (const [path, content] of Object.entries(previewFiles)) {
                    fileMap[path] = { type: 'file', content };
                  }
                  workbenchStore.files.set(fileMap as any);

                  console.log(
                    `[Palmkit] Restored ${Object.keys(previewFiles).length} file(s) from R2 for job ${jobId} (appType: ${restoredAppType})`,
                  );
                }
              }
            } catch (e) {
              console.warn('[Palmkit] Failed to restore worker files from R2:', e);
            }
          } else if (savedAppType) {
            /*
             * No jobId (e.g. project built via streaming path, not worker) but we have
             * the saved appType. Restore it to buildStatusStore so the sandbox hook can
             * still decide the correct preview method.
             */
            const { buildStatusStore } = await import('~/lib/stores/build-status');
            const current = buildStatusStore.get();
            buildStatusStore.set({
              ...current,
              appType: savedAppType,
              jobStatus: 'ready_for_preview',
              completeness: 'complete',
              hasCompletionMarker: true,
              artifactTagsBalanced: true,
              fileActionsBalanced: true,
            });
          }
        })
        .catch((error) => {
          console.error(error);

          logStore.logError('Failed to load chat messages or snapshot', error);
          toast.error('Failed to load chat: ' + error.message);
          setRestoreStep('error');
          setReady(true);
          suppressOverlayIfFast();
        });
    } else {
      setReady(true);
    }
  }, [mixedId, db, navigate, searchParams]);

  const takeSnapshot = useCallback(
    async (chatIdx: string, files: FileMap, _chatId?: string | undefined, chatSummary?: string) => {
      const id = chatId.get();

      if (!id || !db) {
        return;
      }

      const snapshot: Snapshot = {
        chatIndex: chatIdx,
        files,
        summary: chatSummary,
      };

      try {
        await setSnapshot(db, id, snapshot);
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        toast.error('Failed to save chat snapshot.');
      }
    },
    [db],
  );

  const takeDebouncedSnapshot = useCallback(
    async (chatIdx: string, files: FileMap, chatSummary?: string) => {
      const id = chatId.get();

      if (!id || !db) {
        return;
      }

      await debouncedSnapshotSaver(chatIdx, files, db, id, chatSummary);
    },
    [db],
  );

  const restoreSnapshot = useCallback(async (id: string, snapshot?: Snapshot) => {
    const container = await webcontainer;

    const validSnapshot = snapshot || { chatIndex: '', files: {} };

    if (!validSnapshot?.files) {
      return;
    }

    // First create all folders (await all to complete before writing files)
    await Promise.all(
      Object.entries(validSnapshot.files).map(async ([key, value]) => {
        if (key.startsWith(container.workdir)) {
          key = key.replace(container.workdir, '');
        }

        if (value?.type === 'folder') {
          await container.fs.mkdir(key, { recursive: true });
        }
      }),
    );

    // Then write all files (await all so the workspace is complete before proceeding)
    await Promise.all(
      Object.entries(validSnapshot.files).map(async ([key, value]) => {
        if (value?.type === 'file') {
          if (key.startsWith(container.workdir)) {
            key = key.replace(container.workdir, '');
          }

          await container.fs.writeFile(key, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
        }
      }),
    );
  }, []);

  return {
    ready: !mixedId || ready,
    initialMessages,
    updateChatMestaData: async (metadata: IChatMetadata) => {
      const id = chatId.get();

      if (!db || !id) {
        return;
      }

      try {
        await setMessages(db, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: async (messages: Message[]) => {
      if (!db || messages.length === 0) {
        return;
      }

      messages = messages.filter((m) => !m.annotations?.includes('no-store'));

      /*
       * Create chatId on first message — but do NOT navigate yet.
       * URL changes only after setMessages() below so that if the user
       * refreshes during the async gap, IndexedDB already has the data
       * and useChatHistory won't redirect them back to "/".
       */
      if (!chatId.get()) {
        const nextId = await getNextId(db);
        chatId.set(nextId);
      }

      let _urlId = urlId;
      let shouldNavigateTo: string | null = null;

      if (!urlId) {
        const firstUserMessage = messages.find((m) => m.role === 'user');
        const artifactId = workbenchStore.firstArtifact?.id || firstUserMessage?.id || 'chat';

        const newUrlId = await getUrlId(db, artifactId);
        _urlId = newUrlId;
        shouldNavigateTo = newUrlId;

        // Don't setUrlId or navigate yet — wait until after IndexedDB write
      }

      let chatSummary: string | undefined = undefined;
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role === 'assistant') {
        const annotations = lastMessage.annotations as JSONValue[];
        const filteredAnnotations = (annotations?.filter(
          (annotation: JSONValue) =>
            annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
        ) || []) as { type: string; value: any } & { [key: string]: any }[];

        if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
          chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
        }
      }

      const currentFiles = workbenchStore.files.get();
      const currentChatId = chatId.get();

      if (currentChatId) {
        takeSnapshot(messages[messages.length - 1].id, currentFiles, _urlId, chatSummary);
      }

      if (!description.get()) {
        const firstArtifact = workbenchStore.firstArtifact;

        if (firstArtifact?.title) {
          description.set(firstArtifact?.title);
        } else {
          const firstUserMsg = messages.find((m) => m.role === 'user');

          if (firstUserMsg && typeof firstUserMsg.content === 'string') {
            const desc = generateSmartTitle(firstUserMsg.content);

            if (desc) {
              description.set(desc);
            }
          }
        }
      } else {
        // Fix existing descriptions that contain model/provider tags (legacy cleanup)
        const currentDesc = description.get();

        if (currentDesc && (currentDesc.includes('[Model:') || currentDesc.includes('[Provider:'))) {
          const firstUserMsg = messages.find((m) => m.role === 'user');

          if (firstUserMsg && typeof firstUserMsg.content === 'string') {
            const cleanDesc = generateSmartTitle(firstUserMsg.content);

            if (cleanDesc && cleanDesc !== 'New Chat') {
              description.set(cleanDesc);
            }
          }
        }
      }

      const finalChatId = chatId.get();

      if (!finalChatId) {
        console.error('Cannot save messages, chat ID is not set.');
        toast.error('Failed to save chat messages: Chat ID missing.');

        return;
      }

      try {
        await setMessages(
          db,
          finalChatId,
          [...archivedMessages, ...messages],
          _urlId,
          description.get(),
          undefined,
          chatMetadata.get(),
        );

        /*
         * Navigate AFTER the IndexedDB write completes. This prevents the race
         * condition where the URL shows /chat/abc but the data isn't in IndexedDB
         * yet — which caused useChatHistory to redirect to "/" on refresh.
         */
        if (shouldNavigateTo) {
          navigateChat(shouldNavigateTo);
          setUrlId(shouldNavigateTo);
        }

        // Mirror to the account (best-effort) so work follows the user across devices.
        if (_urlId) {
          pushProjectDebounced(_urlId, {
            description: description.get(),
            messages: [...archivedMessages, ...messages],
            snapshot: {
              chatIndex: messages[messages.length - 1].id,
              files: currentFiles,
              summary: chatSummary,
            },
          });
        }
      } catch (error) {
        console.error('Failed to save messages to IndexedDB:', error);
        toast.error('Failed to save chat: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    },
    takeDebouncedSnapshot,
    takeSnapshot,
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (desc: string, messages: Message[], metadata?: IChatMetadata) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, desc, messages, metadata);
        window.location.href = `/chat/${newId}`;
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      if (!db || !id) {
        return;
      }

      const chat = await getMessages(db, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(nextId: string) {
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
