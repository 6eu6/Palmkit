import type { Message } from 'ai';
import { authUserStore } from '~/lib/stores/auth';
import type { Snapshot } from './types';
import {
  getAllFolders,
  getMessages,
  putFolderLocal,
  setChatFolderLocal,
  setMessages,
  setPinnedLocal,
  setSnapshot,
  type Folder,
} from './db';

/**
 * Account-backed project sync. All functions are best-effort: when the user is
 * signed out (or the network fails) they no-op, and the local IndexedDB store
 * remains the source of truth. When signed in, projects (chats + file
 * snapshots) are mirrored to the account so work follows the user across
 * devices.
 */

const ENDPOINT = '/api/account/projects';

function isSignedIn(): boolean {
  return Boolean(authUserStore.get());
}

export type ProjectMode = 'chat' | 'work' | 'code';

export interface AccountProjectSummary {
  url_id: string;
  description: string | null;
  updated_at: string;

  /**
   * Workspace tab the conversation belongs to. Older rows (written before the
   * column existed) come back null and are treated as 'code', matching the
   * local IndexedDB default.
   */
  mode: ProjectMode | null;

  /** Pinned-to-top flag, mirrored so a pin follows the user across devices. */
  pinned?: boolean | null;

  /** Project this conversation belongs to, if any. */
  folder_id?: string | null;
}

export interface AccountProject extends AccountProjectSummary {
  messages: Message[];
  snapshot: Snapshot | null;
}

const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced upsert of a project to the account (keyed by urlId). */
export function pushProjectDebounced(
  urlId: string,
  payload: {
    description?: string;
    messages: Message[];
    snapshot?: Snapshot | null;
    mode?: ProjectMode;
    pinned?: boolean;
    folderId?: string;
  },
  delay = 1500,
) {
  if (!isSignedIn() || !urlId) {
    return;
  }

  const existing = pushTimers.get(urlId);

  if (existing) {
    clearTimeout(existing);
  }

  pushTimers.set(
    urlId,
    setTimeout(() => {
      pushTimers.delete(urlId);
      void pushProjectNow(urlId, payload);
    }, delay),
  );
}

export async function pushProjectNow(
  urlId: string,
  payload: {
    description?: string;
    messages: Message[];
    snapshot?: Snapshot | null;
    mode?: ProjectMode;
    pinned?: boolean;
    folderId?: string;
  },
): Promise<void> {
  if (!isSignedIn() || !urlId) {
    return;
  }

  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url_id: urlId,
        description: payload.description ?? null,
        messages: payload.messages ?? [],
        snapshot: payload.snapshot ?? null,

        /*
         * Without this the tab a conversation belongs to never left the
         * device: every chat pulled back from the account defaulted to 'code',
         * so a fresh browser (or a second device) showed the whole history
         * piled into the Code tab.
         */
        mode: payload.mode ?? null,
        pinned: payload.pinned ?? false,
        folder_id: payload.folderId ?? null,
      }),
    });
  } catch {
    // best-effort; local store still holds the data
  }
}

export async function pullProject(urlId: string): Promise<AccountProject | null> {
  if (!isSignedIn() || !urlId) {
    return null;
  }

  try {
    const res = await fetch(`${ENDPOINT}?id=${encodeURIComponent(urlId)}`);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { project: AccountProject | null };

    return data.project;
  } catch {
    return null;
  }
}

export async function listAccountProjects(): Promise<AccountProjectSummary[]> {
  if (!isSignedIn()) {
    return [];
  }

  try {
    const res = await fetch(ENDPOINT);

    if (!res.ok) {
      return [];
    }

    const data = (await res.json()) as { projects: AccountProjectSummary[] };

    return data.projects ?? [];
  } catch {
    return [];
  }
}

export async function deleteAccountProject(urlId: string): Promise<void> {
  if (!isSignedIn() || !urlId) {
    return;
  }

  try {
    await fetch(`${ENDPOINT}?id=${encodeURIComponent(urlId)}`, { method: 'DELETE' });
  } catch {
    // best-effort
  }
}

/**
 * If a chat isn't in the local store but exists on the account, pull it down
 * and seed IndexedDB so the normal restore path can pick it up. Returns true
 * when something was seeded.
 */
export async function seedChatFromAccount(db: IDBDatabase, urlId: string): Promise<boolean> {
  if (!isSignedIn() || !urlId) {
    return false;
  }

  try {
    const local = await getMessages(db, urlId);

    if (local && local.messages && local.messages.length > 0) {
      return false;
    }
  } catch {
    // ignore — treat as missing locally
  }

  const project = await pullProject(urlId);

  if (!project || !project.messages || project.messages.length === 0) {
    return false;
  }

  try {
    await setMessages(
      db,
      urlId,
      project.messages,
      project.url_id,
      project.description ?? undefined,
      undefined,
      undefined,
      project.mode ?? 'code',
    );

    if (project.pinned) {
      await setPinnedLocal(db, urlId, true);
    }

    if (project.folder_id) {
      await setChatFolderLocal(db, urlId, project.folder_id);
    }

    if (project.snapshot) {
      await setSnapshot(db, urlId, project.snapshot);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * One-time-ish seed of all account projects into the local store so the chat
 * list shows them. Only fills chats missing locally; never overwrites local.
 */
export async function syncAllFromAccount(db: IDBDatabase): Promise<void> {
  if (!isSignedIn()) {
    return;
  }

  const projects = await listAccountProjects();

  for (const summary of projects) {
    try {
      const local = await getMessages(db, summary.url_id);

      if (local && local.messages && local.messages.length > 0) {
        continue;
      }
    } catch {
      // missing locally — seed it
    }

    const project = await pullProject(summary.url_id);

    if (project && project.messages?.length) {
      try {
        await setMessages(
          db,
          project.url_id,
          project.messages,
          project.url_id,
          project.description ?? undefined,
          undefined,
          undefined,
          project.mode ?? summary.mode ?? 'code',
        );

        if (project.pinned ?? summary.pinned) {
          await setPinnedLocal(db, project.url_id, true);
        }

        const folderId = project.folder_id ?? summary.folder_id;

        if (folderId) {
          await setChatFolderLocal(db, project.url_id, folderId);
        }

        if (project.snapshot) {
          await setSnapshot(db, project.url_id, project.snapshot);
        }
      } catch {
        // best-effort
      }
    }
  }
}

const FOLDERS_ENDPOINT = '/api/account/folders';

interface AccountFolder {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

/** Mirror a folder to the account (create or rename). Best-effort. */
export async function pushFolder(folder: Folder): Promise<void> {
  if (!isSignedIn()) {
    return;
  }

  try {
    await fetch(FOLDERS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: folder.id,
        name: folder.name,
        color: folder.color ?? null,
        created_at: folder.createdAt,
      }),
    });
  } catch {
    // best-effort; the local store still holds it
  }
}

export async function deleteAccountFolder(id: string): Promise<void> {
  if (!isSignedIn() || !id) {
    return;
  }

  try {
    await fetch(`${FOLDERS_ENDPOINT}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // best-effort
  }
}

/**
 * Pull the account's folders into the local store.
 *
 * Must run BEFORE conversations are seeded: a conversation restored with a
 * folderId whose folder isn't there yet would be filtered into a project the
 * sidebar cannot show.
 */
export async function syncFoldersFromAccount(db: IDBDatabase): Promise<void> {
  if (!isSignedIn()) {
    return;
  }

  try {
    const res = await fetch(FOLDERS_ENDPOINT);

    if (!res.ok) {
      return;
    }

    const data = (await res.json()) as { folders?: AccountFolder[]; unavailable?: boolean };

    if (data.unavailable || !data.folders?.length) {
      return;
    }

    const local = new Map((await getAllFolders(db)).map((f) => [f.id, f]));

    for (const remote of data.folders) {
      const mine = local.get(remote.id);

      // Last write wins, which is all a name and a colour need.
      if (mine && Date.parse(mine.updatedAt) >= Date.parse(remote.updated_at)) {
        continue;
      }

      await putFolderLocal(db, {
        id: remote.id,
        name: remote.name,
        color: remote.color ?? undefined,
        createdAt: remote.created_at,
        updatedAt: remote.updated_at,
      });
    }
  } catch {
    // best-effort
  }
}
