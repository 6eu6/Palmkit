import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs';
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
      Promise.all([getMessages(db, mixedId), getSnapshot(db, mixedId)])
        .then(async ([storedMessages, snapshot]) => {
          /*
           * FIX #5: Do not redirect to / if a snapshot exists but messages are empty.
           * This can happen if the page was refreshed during streaming.
           */
          const hasMessages = storedMessages && storedMessages.messages.length > 0;
          const hasSnapshot = snapshot && snapshot.files && Object.keys(snapshot.files).length > 0;

          if (!hasMessages && !hasSnapshot) {
            navigate('/', { replace: true });
            setReady(true);

            return;
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
            let archivedMessages: Message[] = [];

            if (startingIdx >= 0) {
              archivedMessages = storedMessages.messages.slice(0, startingIdx + 1);
            }

            setArchivedMessages(archivedMessages);

            if (startingIdx > 0) {
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

              // FIX #4: Restore workbenchStore.files from snapshot AND restore WebContainer files
              workbenchStore.files.set(validSnapshot.files);
              restoreSnapshot(mixedId, validSnapshot);
            }

            setInitialMessages(filteredMessages);

            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else if (hasSnapshot) {
            /*
             * FIX #5: We have a snapshot but no messages. Restore from snapshot.
             * This can happen if the user refreshed during streaming before messages were saved.
             */
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

            // Restore workbenchStore.files and WebContainer
            workbenchStore.files.set(validSnapshot.files);
            restoreSnapshot(mixedId, validSnapshot);

            setInitialMessages(restoredMessages);

            /*
             * We need to set chatId from the URL since we have no stored messages
             * Try to get it from the storedMessages id or fall back to mixedId
             */
            chatId.set(storedMessages?.id || mixedId);
            setUrlId(storedMessages?.urlId);

            toast.info('Restored last saved snapshot (generation was interrupted)');
          }

          setReady(true);
        })
        .catch((error) => {
          console.error(error);

          logStore.logError('Failed to load chat messages or snapshot', error);
          toast.error('Failed to load chat: ' + error.message);
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

  /**
   * FIX #3: Debounced snapshot save during streaming.
   * Called from the files change watcher to persist files periodically during generation.
   */
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

      // FIX #1: Create chatId immediately on first message, not waiting for firstArtifact
      if (!chatId.get()) {
        const nextId = await getNextId(db);
        chatId.set(nextId);

        // Navigate to the new chat URL immediately
        navigateChat(nextId);
      }

      let _urlId = urlId;

      // FIX #1: Use the first user message to generate urlId instead of requiring firstArtifact
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

      // FIX #2 & #3: Take snapshot with current files on every save, debounced during streaming
      const currentFiles = workbenchStore.files.get();
      const currentChatId = chatId.get();

      if (currentChatId) {
        // Always save snapshot immediately with storeMessageHistory
        takeSnapshot(messages[messages.length - 1].id, currentFiles, _urlId, chatSummary);
      }

      if (!description.get()) {
        // Use firstArtifact title, or first user message as description
        const firstArtifact = workbenchStore.firstArtifact;

        if (firstArtifact?.title) {
          description.set(firstArtifact?.title);
        } else {
          const firstUserMsg = messages.find((m) => m.role === 'user');

          if (firstUserMsg && typeof firstUserMsg.content === 'string') {
            // Take first 80 chars of user message as description
            const desc = firstUserMsg.content.slice(0, 80).replace(/\n/g, ' ').trim();

            if (desc) {
              description.set(desc);
            }
          }
        }
      }

      // chatId should already be set from the early check above
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
      } catch (error) {
        console.error('Failed to save messages to IndexedDB:', error);
        toast.error('Failed to save chat: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    },

    /**
     * FIX #3: Expose debounced snapshot saver for use during streaming file changes.
     */
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
    importChat: async (description: string, messages: Message[], metadata?: IChatMetadata) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages, metadata);
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

/**
 * FIX #6: Use window.history.replaceState but also make the URL restorable
 * by storing the mapping in IndexedDB. The navigate function is kept but we also
 * ensure the URL change is reflected so reload works independently.
 */
function navigateChat(nextId: string) {
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
