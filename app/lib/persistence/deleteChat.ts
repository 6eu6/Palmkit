import { deleteById, getMessages } from './db';
import { chatId } from './useChatHistory';
import { deleteAccountProject } from './accountSync';
import { deleteAllLockedForChat } from './lockedFiles';
import { killCurrentRemotePreview } from '~/lib/sandbox/remotePreview';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('deleteChat');

/**
 * Delete a conversation everywhere it lives.
 *
 * This is the single source of truth for "delete a chat" — the desktop
 * sidebar and the mobile projects drawer both call it. The drawer used to
 * call `deleteById` on its own, which left the account-synced copy behind in
 * Supabase; the next `syncAllFromAccount` pass then pulled the "deleted" chat
 * straight back into the list.
 *
 * Six layers, each best-effort so one failure can't block the others:
 *
 *  1. Cloud sandbox (E2B) — kill the running dev server so it stops consuming
 *     quota for the next ~7 minutes.
 *  2. localStorage snapshot — the chat's file-state snapshot.
 *  3. Supabase account copy (row + Storage snapshot) — so it isn't re-pulled.
 *  4. IndexedDB (`chats` + `snapshots` stores) — the conversation itself.
 *  5. Workbench store — file tree + previews, when the deleted chat is active,
 *     so stale files don't bleed into the next conversation.
 *  6. Locked files — every lock entry for this chat, in localStorage + memory.
 *
 * Layer 4 is the only one that throws: if IndexedDB still holds the chat the
 * delete has not happened, and the caller must surface that to the user.
 */
export async function deleteChatCompletely(db: IDBDatabase, id: string): Promise<void> {
  // 1. Kill the cloud sandbox if this chat owns the active one.
  try {
    killCurrentRemotePreview();
  } catch (error) {
    logger.error('Failed to kill sandbox for chat', id, error);
  }

  // 2. Drop the localStorage snapshot.
  try {
    localStorage.removeItem(`snapshot:${id}`);
  } catch (error) {
    logger.error('Failed to remove snapshot for chat', id, error);
  }

  /*
   * 3. Remove the account-synced copy. Read the record BEFORE the IndexedDB
   *    delete — afterwards there is no urlId left to address the row with.
   */
  try {
    const item = await getMessages(db, id);

    if (item?.urlId) {
      await deleteAccountProject(item.urlId);
    }
  } catch (error) {
    logger.error('Failed to delete account project copy for chat', id, error);
  }

  // 4. The conversation itself (throws — see the doc comment).
  await deleteById(db, id);

  // 5. Clear the workbench when the deleted chat is the active one.
  if (chatId.get() === id) {
    try {
      workbenchStore.files.set({});
      workbenchStore.previews.set([]);
    } catch (error) {
      logger.error('Failed to clear workbench store for chat', id, error);
    }
  }

  // 6. Purge locked files.
  try {
    deleteAllLockedForChat(id);
  } catch (error) {
    logger.error('Failed to purge locked files for chat', id, error);
  }

  logger.debug('Chat deleted (all layers):', id);
}
