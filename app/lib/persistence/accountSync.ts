import type { Message } from 'ai';
import { authUserStore } from '~/lib/stores/auth';
import type { Snapshot } from './types';
import { getMessages, setMessages, setSnapshot } from './db';

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

export interface AccountProjectSummary {
  url_id: string;
  description: string | null;
  updated_at: string;
}

export interface AccountProject extends AccountProjectSummary {
  messages: Message[];
  snapshot: Snapshot | null;
}

const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced upsert of a project to the account (keyed by urlId). */
export function pushProjectDebounced(
  urlId: string,
  payload: { description?: string; messages: Message[]; snapshot?: Snapshot | null },
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
  payload: { description?: string; messages: Message[]; snapshot?: Snapshot | null },
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
    await setMessages(db, urlId, project.messages, project.url_id, project.description ?? undefined);

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
        await setMessages(db, project.url_id, project.messages, project.url_id, project.description ?? undefined);

        if (project.snapshot) {
          await setSnapshot(db, project.url_id, project.snapshot);
        }
      } catch {
        // best-effort
      }
    }
  }
}
