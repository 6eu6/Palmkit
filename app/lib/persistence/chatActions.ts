import { getMessages, setMessages } from './db';
import { pushProjectNow } from './accountSync';
import { description as descriptionStore, chatId as chatIdStore } from './useChatHistory';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('chatActions');

/**
 * Conversation-level actions that must land in BOTH stores.
 *
 * IndexedDB is the local source of truth and the account copy is what follows
 * the user across devices — a change written to only one of them silently
 * reverts the next time the other wins. `db.ts` cannot do the account half
 * itself: `accountSync` imports from `db`, so the call has to be made a layer
 * up, which is what this module is for.
 */

/** Longest description we accept. Matches the sidebar's single-line row. */
const MAX_DESCRIPTION_LENGTH = 100;

export interface RenameResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate a user-supplied conversation title.
 *
 * Deliberately permissive about the alphabet. The previous rule was
 * `/^[a-zA-Z0-9\s\-_.,!?()[\]{}'"]+$/`, which accepts only Latin text — it
 * rejected Arabic (and every other non-Latin script, and emoji) with
 * "can only contain letters, numbers, spaces, and basic punctuation". What
 * actually needs excluding is control characters, not the world's scripts.
 */
export function validateChatTitle(raw: string): RenameResult {
  const title = raw.trim();

  if (title.length === 0) {
    return { ok: false, error: 'Name cannot be empty.' };
  }

  if (title.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, error: `Name must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` };
  }

  // C0/C1 control characters — newlines, NULs and friends would break the row.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(title)) {
    return { ok: false, error: 'Name cannot contain line breaks or control characters.' };
  }

  return { ok: true };
}

/**
 * Rename a conversation everywhere: IndexedDB, the account copy, and — when
 * it is the conversation currently on screen — the header/title store.
 *
 * The old path wrote to IndexedDB only, so a rename survived until the next
 * sync from another device and then reverted to the auto-generated title.
 */
export async function renameChat(db: IDBDatabase, id: string, rawTitle: string): Promise<RenameResult> {
  const check = validateChatTitle(rawTitle);

  if (!check.ok) {
    return check;
  }

  const title = rawTitle.trim();
  const chat = await getMessages(db, id);

  if (!chat) {
    return { ok: false, error: 'Conversation not found.' };
  }

  await setMessages(db, id, chat.messages, chat.urlId, title, chat.timestamp, chat.metadata, chat.mode);

  if (chatIdStore.get() === id) {
    descriptionStore.set(title);
  }

  // Mirror immediately (not debounced) — a rename is a deliberate, one-off act.
  if (chat.urlId) {
    await pushProjectNow(chat.urlId, {
      description: title,
      messages: chat.messages,
      mode: chat.mode,
      pinned: chat.pinned ?? false,
    }).catch((error) => logger.error('Failed to mirror rename to the account', error));
  }

  return { ok: true };
}

/**
 * Pin or unpin a conversation.
 *
 * Writes the flag straight onto the stored record rather than going through
 * `setMessages`, so pinning never rewrites `timestamp` — the list is ordered
 * by recency and a pin is not activity.
 */
export async function setChatPinned(db: IDBDatabase, id: string, pinned: boolean): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Conversation not found.');
  }

  await new Promise<void>((resolve, reject) => {
    const store = db.transaction('chats', 'readwrite').objectStore('chats');
    const request = store.put({ ...chat, pinned });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  if (chat.urlId) {
    await pushProjectNow(chat.urlId, {
      description: chat.description,
      messages: chat.messages,
      mode: chat.mode,
      pinned,
    }).catch((error) => logger.error('Failed to mirror pin state to the account', error));
  }
}
