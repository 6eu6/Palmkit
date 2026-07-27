/**
 * continueInFreshChat — the client half of "Continue in a fresh chat".
 *
 * Carries the current project into a brand-new chat with a clean context
 * window while keeping the full project + its memory:
 *
 *   1. Reserve the new chat id (it doubles as the project id / workspace key).
 *   2. POST /api/fork-chat → copies the workspace mirror + writes the handoff
 *      memory server-side, and returns a welcome + a suggested next step.
 *   3. Create the new IndexedDB chat seeded with a welcome assistant message
 *      and a snapshot of the files (so the workbench populates on open).
 *   4. Return the new chat's urlId for navigation.
 */

import { generateId, type Message } from 'ai';
import { getNextId, createChatFromMessages, setSnapshot } from '~/lib/persistence/db';

interface ForkResponse {
  ok?: boolean;
  targetProjectId: string;
  fileCount: number;
  appType: string | null;
  suggestion: string;
  welcome: string;
  error?: string;
}

export async function continueInFreshChat(opts: {
  db: IDBDatabase;
  sourceProjectId: string;
  projectName: string;
  files: Record<string, string>;
}): Promise<string> {
  const { db, sourceProjectId, projectName, files } = opts;

  /*
   * Reserve the id BEFORE the fork call so the server writes the workspace
   * under the same key the new chat will use. createChatFromMessages() calls
   * getNextId() again below and — with nothing inserted in between — returns
   * this same id, so internal id === urlId === targetProjectId for the fresh chat.
   */
  const targetProjectId = await getNextId(db);

  const resp = await fetch('/api/fork-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceProjectId, targetProjectId, projectName, files }),
  });

  const data = (await resp.json().catch(() => ({}))) as ForkResponse;

  if (!resp.ok || !data.ok) {
    throw new Error(data.error || 'Could not continue in a fresh chat');
  }

  const welcomeMsg = {
    id: generateId(),
    role: 'assistant',
    content: data.welcome,
    createdAt: new Date(),
  } as Message;

  const newUrlId = await createChatFromMessages(db, projectName, [welcomeMsg], {
    gitUrl: '',
    continuedFrom: sourceProjectId,
    palmkitAppType: data.appType ?? undefined,
    continuationSuggestion: data.suggestion,
  });

  // Seed the workbench file tree on open (snapshot is keyed by internal chat id).
  const fileMap: Record<string, { type: 'file'; content: string }> = {};

  for (const [path, content] of Object.entries(files)) {
    fileMap[path] = { type: 'file', content };
  }

  await setSnapshot(db, targetProjectId, {
    chatIndex: welcomeMsg.id,
    files: fileMap as any,
  });

  return newUrlId;
}
