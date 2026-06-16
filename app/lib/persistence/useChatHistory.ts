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
          const snapshot: Snapshot = {
            chatIndex: chatIdx,
            files,
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
      // A) Restore UX: Show restore overlay with progress steps
      isRestoring.set(true);
      setRestoreStep('loading-messages');

      seedChatFromAccount(db, mixedId)
        .catch(() => false)
        .then(async () => {
          // getMessages resolves by both internal ID and urlId;
          // use the resolved internal ID for snapshot lookup (snapshots are
          // stored under the internal chat ID, not the urlId).
          const storedMessages = await getMessages(db, mixedId);
          const snapshotId = storedMessages?.id ?? mixedId;
          const snapshot = await getSnapshot(db, snapshotId);
          return [storedMessages, snapshot] as const;
        })
        .then(async ([storedMessages, snapshot]) => {
          const hasMessages = storedMessages && storedMessages.messages.length > 0;
          const hasSnapshot = snapshot && snapshot.files && Object.keys(snapshot.files).length > 0;

          if (!hasMessages && !hasSnapshot) {
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
                  ? snapshotMessage.content.includes('<boltArtifact') &&
                    !snapshotMessage.content.includes('</boltArtifact')
                  : false;

              filteredMessages = [
                {
                  id: generateId(),
                  role: 'user',
                  content: `Restore project from snapshot`,
                  annotations: ['no-store', 'hidden'],
                },
                {
                  id: storedMessages.messages[snapshotIndex].id,
                  role: 'assistant',
                  content: `Bolt Restored your chat from a snapshot. You can revert this message to load the full chat history.
                  <boltArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
                  ${Object.entries(snapshot?.files || {})
                    .map(([key, value]) => {
                      if (value?.type === 'file') {
                        return `
                      <boltAction type="file" filePath="${key}">
${value.content}
                      </boltAction>
                      `;
                      } else {
                        return ``;
                      }
                    })
                    .join('\n')}
                  ${commandActionsString} 
                  </boltArtifact>
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
                },
                ...filteredMessages,
              ];

              // A) Restore UX: Step - restoring WebContainer
              setRestoreStep('restoring-webcontainer', wasInterrupted);

              workbenchStore.files.set(validSnapshot.files);
              await restoreSnapshot(mixedId, validSnapshot);

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
                content: `Bolt Restored your chat from a snapshot (generation was interrupted). You can continue from here.
                  <boltArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
                  ${Object.entries(validSnapshot.files || {})
                    .map(([key, value]) => {
                      if (value?.type === 'file') {
                        return `
                      <boltAction type="file" filePath="${key}">
${value.content}
                      </boltAction>
                      `;
                      } else {
                        return ``;
                      }
                    })
                    .join('\n')}
                  ${commandActionsString} 
                  </boltArtifact>
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
            await restoreSnapshot(mixedId, validSnapshot);

            setRestoreStep('done', true);

            toast.info('Generation was interrupted. Restored the latest saved snapshot.', { autoClose: 5000 });

            setInitialMessages(restoredMessages);
            chatId.set(storedMessages?.id || mixedId);
            setUrlId(storedMessages?.urlId);
          }

          setReady(true);
        })
        .catch((error) => {
          console.error(error);

          logStore.logError('Failed to load chat messages or snapshot', error);
          toast.error('Failed to load chat: ' + error.message);
          setRestoreStep('error');
          setReady(true);
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

    // First create all folders
    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (key.startsWith(container.workdir)) {
        key = key.replace(container.workdir, '');
      }

      if (value?.type === 'folder') {
        await container.fs.mkdir(key, { recursive: true });
      }
    });

    // Then write all files
    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (value?.type === 'file') {
        if (key.startsWith(container.workdir)) {
          key = key.replace(container.workdir, '');
        }

        await container.fs.writeFile(key, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
      }
    });
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

      // FIX #1: Create chatId immediately on first message
      if (!chatId.get()) {
        const nextId = await getNextId(db);
        chatId.set(nextId);
        navigateChat(nextId);
      }

      let _urlId = urlId;

      if (!urlId) {
        const firstUserMessage = messages.find((m) => m.role === 'user');
        const artifactId = workbenchStore.firstArtifact?.id || firstUserMessage?.id || 'chat';

        const newUrlId = await getUrlId(db, artifactId);
        _urlId = newUrlId;
        navigateChat(newUrlId);
        setUrlId(newUrlId);
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
            const desc = firstUserMsg.content.slice(0, 80).replace(/\n/g, ' ').trim();

            if (desc) {
              description.set(desc);
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
