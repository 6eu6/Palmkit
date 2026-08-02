import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';
import type { Snapshot } from './types'; // Import Snapshot type

export interface IChatMetadata {
  gitUrl: string;
  gitBranch?: string;
  netlifySiteId?: string;

  /** Palmkit worker job ID (for restoring external-worker builds on reload). */
  palmkitJobId?: string;

  /**
   * App type detected by the worker (static | react | vue | nextjs | python | flutter | react-native).
   * Persisted so the preview can decide iframe-blob vs WebContainer vs E2B on reload.
   */
  palmkitAppType?: string;

  /** Source chat/project id this chat was forked from via "Continue in a fresh chat". */
  continuedFrom?: string;

  /**
   * A suggested next step shown as a one-click chip when a continued chat opens.
   * Cleared (removed from metadata) once the user acts on it or dismisses it.
   */
  continuationSuggestion?: string;
}

const logger = createScopedLogger('ChatHistory');

// this is used at the top level and never rejects
export async function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return undefined;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open('palmkitHistory', 4);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });

          /*
           * urlId is NOT unique — the external worker path sometimes saves
           * chats without a urlId (undefined), and multiple undefined values
           * violate the unique constraint. This caused "Failed to save chat:
           * Unable to add key to index 'urlId'" which blocked the UI from
           * updating from 'generating' to 'ready_for_preview'.
           */
          store.createIndex('urlId', 'urlId', { unique: false });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'chatId' });
        }
      }

      if (oldVersion < 3) {
        /*
         * Version 3: recreate the urlId index as non-unique.
         *
         * Version 1-2 had urlId as unique: true. The external worker path
         * sometimes saves chats without a urlId (undefined), and multiple
         * undefined values violate the unique constraint → "Failed to save
         * chat: Unable to add key to index 'urlId'" → the chat save fails
         * → the UI never updates from 'generating' to 'ready_for_preview'
         * → the user sees the build "stuck" at 30% forever.
         *
         * Fix: delete the old unique index and create a new non-unique one.
         */
        if (db.objectStoreNames.contains('chats')) {
          const store = (event.target as IDBOpenDBRequest).transaction?.objectStore('chats');

          if (store) {
            try {
              store.deleteIndex('urlId');
            } catch {
              // index might not exist — ignore
            }

            store.createIndex('urlId', 'urlId', { unique: false });
          }
        }
      }

      if (oldVersion < 4) {
        /*
         * Version 4: `folders` — the Projects feature.
         *
         * A folder groups conversations that belong to the same piece of work.
         * Conversations reference it by `folderId`; the link is deliberately
         * one-way, so deleting a folder can never cascade into deleting the
         * conversations inside it.
         */
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function getAll(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as ChatHistoryItem[]);
    request.onerror = () => reject(request.error);
  });
}

export async function setMessages(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
  mode?: 'chat' | 'work' | 'code',
): Promise<{ mode: 'chat' | 'work' | 'code'; folderId?: string }> {
  /*
   * Resolves with what the record ACTUALLY carries. `mode` may differ from the
   * argument (see below), and `folderId` isn't an argument at all — callers
   * that mirror the chat to the account need the stored values, and this saves
   * them a second read.
   */
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');

    if (timestamp && isNaN(Date.parse(timestamp))) {
      reject(new Error('Invalid timestamp'));
      return;
    }

    const existingRequest = store.get(id);

    existingRequest.onsuccess = () => {
      const existing = existingRequest.result;

      /*
       * A conversation's mode is decided ONCE, when it is created, and is
       * immutable afterwards. The stored value therefore always wins over the
       * `mode` argument.
       *
       * Why this ordering matters: `storeMessageHistory` passes the CURRENT
       * sidebar mode on every save. The sidebar mode changes the instant the
       * user taps another tab — before Remix finishes navigating away — so a
       * save that lands in that window used to re-tag the open conversation
       * with the tab the user was leaving for, and the chat would jump tabs.
       * `mode` now only seeds records that don't have one yet (new chats, and
       * legacy rows written before the column existed).
       */
      const finalMode = existing?.mode || mode || 'code';

      const request = store.put({
        id,
        messages,

        /*
         * Carried over explicitly. `put` REPLACES the whole record, so any
         * field this function doesn't name is silently dropped — a pinned
         * conversation would quietly unpin itself on the next message.
         */
        pinned: existing?.pinned ?? false,
        folderId: existing?.folderId,
        urlId,
        description,
        timestamp: timestamp ?? new Date().toISOString(),
        metadata,
        mode: finalMode,
      });

      request.onsuccess = () => resolve({ mode: finalMode, folderId: existing?.folderId });
      request.onerror = () => reject(request.error);
    };

    existingRequest.onerror = () => reject(existingRequest.error);
  });
}

/**
 * Set the pinned flag on a stored chat, locally only.
 *
 * Used by the account-sync pull path, which must NOT push back to the account
 * — `chatActions.setChatPinned` is the write path that mirrors.
 */
export async function setPinnedLocal(db: IDBDatabase, id: string, pinned: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = db.transaction('chats', 'readwrite').objectStore('chats');
    const existing = store.get(id);

    existing.onsuccess = () => {
      if (!existing.result) {
        resolve();
        return;
      }

      const request = store.put({ ...existing.result, pinned });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    };

    existing.onerror = () => reject(existing.error);
  });
}

/**
 * A project (called a folder in storage — the account-side table already
 * named `projects` holds CONVERSATIONS, so reusing that word here would be a
 * permanent source of confusion).
 */
export interface Folder {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getAllFolders(db: IDBDatabase): Promise<Folder[]> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('folders')) {
      resolve([]);
      return;
    }

    const request = db.transaction('folders', 'readonly').objectStore('folders').getAll();
    request.onsuccess = () => resolve((request.result as Folder[]) ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function putFolderLocal(db: IDBDatabase, folder: Folder): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction('folders', 'readwrite').objectStore('folders').put(folder);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a folder and detach — never delete — the conversations in it.
 *
 * Both stores are touched in ONE transaction so the two can't diverge: a
 * folder row that disappears while its conversations still point at it would
 * leave them invisible, filtered into a project that no longer exists.
 */
export async function deleteFolderLocal(db: IDBDatabase, folderId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['folders', 'chats'], 'readwrite');
    tx.objectStore('folders').delete(folderId);

    let detached = 0;
    const chats = tx.objectStore('chats').getAll();

    chats.onsuccess = () => {
      for (const chat of (chats.result as ChatHistoryItem[]) ?? []) {
        if (chat.folderId === folderId) {
          tx.objectStore('chats').put({ ...chat, folderId: undefined });
          detached++;
        }
      }
    };

    tx.oncomplete = () => resolve(detached);
    tx.onerror = () => reject(tx.error);
  });
}

/** Move a conversation into a project, or out of every project (`undefined`). */
export async function setChatFolderLocal(db: IDBDatabase, id: string, folderId: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = db.transaction('chats', 'readwrite').objectStore('chats');
    const existing = store.get(id);

    existing.onsuccess = () => {
      if (!existing.result) {
        resolve();
        return;
      }

      const request = store.put({ ...existing.result, folderId });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    };

    existing.onerror = () => reject(existing.error);
  });
}

export async function getMessages(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return (await getMessagesById(db, id)) || (await getMessagesByUrlId(db, id));
}

export async function getMessagesByUrlId(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const index = store.index('urlId');
    const request = index.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesById(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteById(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['chats', 'snapshots'], 'readwrite'); // Add snapshots store to transaction
    const chatStore = transaction.objectStore('chats');
    const snapshotStore = transaction.objectStore('snapshots');

    const deleteChatRequest = chatStore.delete(id);
    const deleteSnapshotRequest = snapshotStore.delete(id); // Also delete snapshot

    let chatDeleted = false;
    let snapshotDeleted = false;

    const checkCompletion = () => {
      if (chatDeleted && snapshotDeleted) {
        resolve(undefined);
      }
    };

    deleteChatRequest.onsuccess = () => {
      chatDeleted = true;
      checkCompletion();
    };
    deleteChatRequest.onerror = () => reject(deleteChatRequest.error);

    deleteSnapshotRequest.onsuccess = () => {
      snapshotDeleted = true;
      checkCompletion();
    };

    deleteSnapshotRequest.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        snapshotDeleted = true;
        checkCompletion();
      } else {
        reject(deleteSnapshotRequest.error);
      }
    };

    transaction.oncomplete = () => {
      // This might resolve before checkCompletion if one operation finishes much faster
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getNextId(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAllKeys();

    request.onsuccess = () => {
      /*
       * Ignore any non-numeric keys. The old reduce did Math.max(+cur, +acc),
       * so a single non-numeric chat id (e.g. an imported/forked project keyed
       * by something other than a timestamp) turned the result into NaN — which
       * then became the id "NaN" for EVERY new chat, breaking chat creation and
       * navigation. Coerce defensively and skip anything that isn't finite.
       */
      const highestId = request.result.reduce<number>((max, key) => {
        const n = Number(key);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      resolve(String(highestId + 1));
    };

    request.onerror = () => reject(request.error);
  });
}

export async function getUrlId(db: IDBDatabase, id: string): Promise<string> {
  const idList = await getUrlIds(db);

  if (!idList.includes(id)) {
    return id;
  } else {
    let i = 2;

    while (idList.includes(`${id}-${i}`)) {
      i++;
    }

    return `${id}-${i}`;
  }
}

async function getUrlIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const idList: string[] = [];

    const request = store.openCursor();

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        idList.push(cursor.value.urlId);
        cursor.continue();
      } else {
        resolve(idList);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function forkChat(db: IDBDatabase, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  // Find the index of the message to fork at
  const messageIndex = chat.messages.findIndex((msg) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  // Get messages up to and including the selected message
  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

export async function duplicateChat(db: IDBDatabase, id: string): Promise<string> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

export async function createChatFromMessages(
  db: IDBDatabase,
  description: string,
  messages: Message[],
  metadata?: IChatMetadata,
): Promise<string> {
  const newId = await getNextId(db);
  const newUrlId = await getUrlId(db, newId); // Get a new urlId for the duplicated chat

  await setMessages(
    db,
    newId,
    messages,
    newUrlId, // Use the new urlId
    description,
    undefined, // Use the current timestamp
    metadata,
  );

  return newUrlId; // Return the urlId instead of id for navigation
}

export async function updateChatDescription(db: IDBDatabase, id: string, description: string): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  await setMessages(db, id, chat.messages, chat.urlId, description, chat.timestamp, chat.metadata);
}

export async function updateChatMetadata(
  db: IDBDatabase,
  id: string,
  metadata: IChatMetadata | undefined,
): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  await setMessages(db, id, chat.messages, chat.urlId, chat.description, chat.timestamp, metadata);
}

export async function getSnapshot(db: IDBDatabase, chatId: string): Promise<Snapshot | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readonly');
    const store = transaction.objectStore('snapshots');
    const request = store.get(chatId);

    request.onsuccess = () => resolve(request.result?.snapshot as Snapshot | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function setSnapshot(db: IDBDatabase, chatId: string, snapshot: Snapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.put({ chatId, snapshot });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSnapshot(db: IDBDatabase, chatId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.delete(chatId);

    request.onsuccess = () => resolve();

    request.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        resolve();
      } else {
        reject(request.error);
      }
    };
  });
}
