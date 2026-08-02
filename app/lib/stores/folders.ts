import { atom } from 'nanostores';
import {
  deleteFolderLocal,
  getAllFolders,
  putFolderLocal,
  setChatFolderLocal,
  getMessages,
  type Folder,
} from '~/lib/persistence/db';
import { deleteAccountFolder, pushFolder, pushProjectNow } from '~/lib/persistence/accountSync';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('folders');

export type { Folder };

/** All of the user's projects, newest activity first. */
export const foldersStore = atom<Folder[]>([]);

/**
 * The project the sidebar is currently scoped to, or undefined for
 * "everything". Driven by the `?project=<id>` query parameter so the scope
 * survives a reload and can be linked to.
 */
export const activeFolderIdStore = atom<string | undefined>(undefined);

export const MAX_FOLDER_NAME = 60;

export function validateFolderName(raw: string): { ok: boolean; error?: string } {
  const name = raw.trim();

  if (!name) {
    return { ok: false, error: 'Project name cannot be empty.' };
  }

  if (name.length > MAX_FOLDER_NAME) {
    return { ok: false, error: `Project name must be ${MAX_FOLDER_NAME} characters or fewer.` };
  }

  // Same rule as conversation titles: reject control characters, not scripts.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) {
    return { ok: false, error: 'Project name cannot contain line breaks or control characters.' };
  }

  return { ok: true };
}

export async function loadFolders(db: IDBDatabase): Promise<void> {
  try {
    const folders = await getAllFolders(db);
    foldersStore.set(folders.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  } catch (error) {
    logger.error('Failed to load projects', error);
  }
}

/**
 * Create a project.
 *
 * The id is minted on the client so the project is usable immediately —
 * conversations can be moved into it before the account round-trip finishes,
 * and the mirror later lands under the same identity rather than forking.
 */
export async function createFolder(db: IDBDatabase, rawName: string): Promise<Folder | null> {
  const check = validateFolderName(rawName);

  if (!check.ok) {
    throw new Error(check.error);
  }

  const now = new Date().toISOString();
  const folder: Folder = { id: crypto.randomUUID(), name: rawName.trim(), createdAt: now, updatedAt: now };

  await putFolderLocal(db, folder);
  await loadFolders(db);
  void pushFolder(folder);

  return folder;
}

export async function renameFolder(db: IDBDatabase, id: string, rawName: string): Promise<void> {
  const check = validateFolderName(rawName);

  if (!check.ok) {
    throw new Error(check.error);
  }

  const existing = foldersStore.get().find((f) => f.id === id);

  if (!existing) {
    throw new Error('Project not found.');
  }

  const updated: Folder = { ...existing, name: rawName.trim(), updatedAt: new Date().toISOString() };

  await putFolderLocal(db, updated);
  await loadFolders(db);
  void pushFolder(updated);
}

/**
 * Delete a project. Its conversations are DETACHED, never deleted — they
 * return to the ungrouped list.
 *
 * Losing a dozen conversations behind one tap on "Delete project" would be
 * unrecoverable: the conversation delete path also tears down snapshots,
 * sandboxes and the account row.
 */
export async function deleteFolder(db: IDBDatabase, id: string): Promise<number> {
  const detached = await deleteFolderLocal(db, id);

  if (activeFolderIdStore.get() === id) {
    activeFolderIdStore.set(undefined);
  }

  await loadFolders(db);
  void deleteAccountFolder(id);

  return detached;
}

/** Move a conversation into a project, or out of every project. */
export async function moveChatToFolder(db: IDBDatabase, chatId: string, folderId: string | undefined): Promise<void> {
  await setChatFolderLocal(db, chatId, folderId);

  const chat = await getMessages(db, chatId);

  if (chat?.urlId) {
    await pushProjectNow(chat.urlId, {
      description: chat.description,
      messages: chat.messages,
      mode: chat.mode,
      pinned: chat.pinned ?? false,
      folderId,
    }).catch((error) => logger.error('Failed to mirror project move to the account', error));
  }
}
