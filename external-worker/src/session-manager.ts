/**
 * Palmkit Session Manager — the conversation IS the state.
 *
 * Every project has ONE ongoing agent session, stored in the workspace at
 * .palmkit/session.json. A new user message does not start a fresh prompt —
 * it is appended to the session's messages[] and the agent continues with
 * full memory of everything it did before (files it wrote, commands it ran,
 * decisions it made). This replaces the old prompt-per-job model where every
 * edit had to reconstruct context from worklog snippets and a red-alert
 * "THIS IS AN EDIT" prompt block.
 *
 * Compaction: sessions grow fast (tool results carry full file contents).
 * Before saving we deterministically compact older turns — file bodies in
 * old write_file/write_files calls are replaced with short stubs (the real
 * files live in the workspace and can always be re-read with read_file),
 * and old tool results are truncated. The most recent turns stay verbatim
 * so the model keeps precise short-term memory.
 */

import { logger } from './logger';
import { readWorkspaceFile, writeWorkspaceFile } from './workspace-manager';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A stored message. Shape-compatible with the AI SDK's CoreMessage so the
 * loaded array can be passed straight to streamText({ messages }). We keep
 * `content` loosely typed because assistant/tool contents are part arrays
 * (text / tool-call / tool-result) that we persist as-is.
 */
export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: any;
}

interface StoredSession {
  version: 1;
  projectId: string;
  updatedAt: string;
  /** Count of user turns ever appended (survives compaction). */
  turns: number;
  messages: SessionMessage[];
}

const SESSION_PATH = '.palmkit/session.json';

/** Keep the most recent N user-turns verbatim; older turns get compacted. */
const KEEP_RECENT_TURNS = 2;

/** Truncation caps for compacted (older) content. */
const OLD_TOOL_RESULT_CAP = 400;
const OLD_TEXT_CAP = 1200;

/** Hard cap on the serialized session; oldest messages are dropped beyond it. */
const MAX_SESSION_BYTES = 400 * 1024;

/**
 * Load a project's session messages. Returns [] for new projects or when the
 * stored session is unreadable (never fails a build over memory).
 */
export async function loadSession(projectId: string): Promise<{ messages: SessionMessage[]; turns: number }> {
  try {
    const raw = await readWorkspaceFile(projectId, SESSION_PATH);

    if (!raw) {
      return { messages: [], turns: 0 };
    }

    const parsed = JSON.parse(raw) as StoredSession;

    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.messages)) {
      return { messages: [], turns: 0 };
    }

    logger.info(
      `[session] Loaded session for ${projectId}: ${parsed.messages.length} messages, turn ${parsed.turns}`,
    );

    return { messages: parsed.messages, turns: parsed.turns ?? 0 };
  } catch (e) {
    logger.warn(`[session] Failed to load session for ${projectId}: ${e}`);
    return { messages: [], turns: 0 };
  }
}

/**
 * Append this build's exchange (user message + the model's response messages)
 * to the session and persist it, compacting older turns first.
 */
export async function appendToSession(
  projectId: string,
  priorMessages: SessionMessage[],
  priorTurns: number,
  newMessages: SessionMessage[],
  supabase?: SupabaseClient,
  userId?: string,
): Promise<void> {
  try {
    const sanitized = newMessages.map(sanitizeMessage).filter((m): m is SessionMessage => m !== null);
    let all = [...priorMessages, ...sanitized];
    all = compactMessages(all);
    all = enforceByteCap(all);

    const session: StoredSession = {
      version: 1,
      projectId,
      updatedAt: new Date().toISOString(),
      turns: priorTurns + 1,
      messages: all,
    };

    const json = JSON.stringify(session);
    await writeWorkspaceFile(projectId, SESSION_PATH, json);

    // Best-effort mirror so /api/workspace consumers can inspect the session.
    if (supabase && userId) {
      try {
        await supabase.storage
          .from('palmkit-files')
          .upload(`${userId}/projects/${projectId}/workspace/${SESSION_PATH}`, json, {
            contentType: 'application/json',
            upsert: true,
          });
      } catch {
        /* mirror is optional */
      }
    }

    logger.info(
      `[session] Saved session for ${projectId}: ${all.length} messages, ${(json.length / 1024).toFixed(0)}KB, turn ${session.turns}`,
    );
  } catch (e) {
    logger.warn(`[session] Failed to save session for ${projectId}: ${e}`);
  }
}

/**
 * Rough token estimate for preflight checks (chars/4 like the orchestrator).
 */
export function estimateSessionTokens(messages: SessionMessage[]): number {
  try {
    return Math.ceil(JSON.stringify(messages).length / 4);
  } catch {
    return 0;
  }
}

/*
 * Strip provider-specific parts that must not be replayed on the next request
 * (reasoning signatures, redacted reasoning). Keep text, tool-call and
 * tool-result parts — they are the session's real memory.
 */
function sanitizeMessage(m: any): SessionMessage | null {
  if (!m || typeof m !== 'object' || !m.role) {
    return null;
  }

  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }

  if (Array.isArray(m.content)) {
    const parts = m.content.filter(
      (p: any) => p && (p.type === 'text' || p.type === 'tool-call' || p.type === 'tool-result'),
    );

    if (parts.length === 0) {
      return null;
    }

    return { role: m.role, content: parts };
  }

  return { role: m.role, content: m.content };
}

/*
 * Compact everything except the last KEEP_RECENT_TURNS user-turns:
 *  - write_file / write_files args: file bodies → short stubs
 *  - tool results: truncated to OLD_TOOL_RESULT_CAP chars
 *  - long text parts: truncated to OLD_TEXT_CAP chars
 */
export function compactMessages(messages: SessionMessage[]): SessionMessage[] {
  // Find the index of the KEEP_RECENT_TURNS-th user message from the end.
  let seenUsers = 0;
  let recentStart = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      seenUsers++;

      if (seenUsers >= KEEP_RECENT_TURNS) {
        recentStart = i;
        break;
      }
    }
  }

  return messages.map((m, i) => (i >= recentStart ? m : compactOne(m)));
}

function compactOne(m: SessionMessage): SessionMessage {
  if (typeof m.content === 'string') {
    return m.content.length > OLD_TEXT_CAP
      ? { ...m, content: `${m.content.slice(0, OLD_TEXT_CAP)}… [compacted]` }
      : m;
  }

  if (!Array.isArray(m.content)) {
    return m;
  }

  const content = m.content.map((p: any) => {
    if (p?.type === 'text' && typeof p.text === 'string' && p.text.length > OLD_TEXT_CAP) {
      return { ...p, text: `${p.text.slice(0, OLD_TEXT_CAP)}… [compacted]` };
    }

    if (p?.type === 'tool-call') {
      const args = p.args;

      if (p.toolName === 'write_file' && args?.content && String(args.content).length > 200) {
        return {
          ...p,
          args: {
            ...args,
            content: `[file body compacted — ${String(args.content).length} chars; read_file("${args.path}") for current content]`,
          },
        };
      }

      if (p.toolName === 'write_files' && Array.isArray(args?.files)) {
        return {
          ...p,
          args: {
            ...args,
            files: args.files.map((f: any) => ({
              path: f?.path,
              content: `[file body compacted — ${String(f?.content ?? '').length} chars; read_file("${f?.path}") for current content]`,
            })),
          },
        };
      }

      return p;
    }

    if (p?.type === 'tool-result') {
      try {
        const s = typeof p.result === 'string' ? p.result : JSON.stringify(p.result);

        if (s && s.length > OLD_TOOL_RESULT_CAP) {
          return { ...p, result: `${s.slice(0, OLD_TOOL_RESULT_CAP)}… [compacted]` };
        }
      } catch {
        /* keep as-is */
      }

      return p;
    }

    return p;
  });

  return { ...m, content };
}

/*
 * Drop oldest messages until the serialized session fits MAX_SESSION_BYTES.
 * The FIRST user message (the project's original request) is always kept —
 * it anchors what the project is. Tool messages orphaned by a dropped
 * assistant tool-call are dropped with it to keep the message list valid.
 */
function enforceByteCap(messages: SessionMessage[]): SessionMessage[] {
  let out = messages;

  while (out.length > 4 && JSON.stringify(out).length > MAX_SESSION_BYTES) {
    const firstUserIdx = out.findIndex((m) => m.role === 'user');

    // Drop the earliest message AFTER the anchored first user message.
    let dropIdx = firstUserIdx + 1;

    if (dropIdx >= out.length) {
      break;
    }

    // Dropping an assistant message with tool-calls orphans the following
    // tool message(s) — drop those too.
    let dropEnd = dropIdx + 1;

    while (dropEnd < out.length && out[dropEnd].role === 'tool') {
      dropEnd++;
    }

    out = [...out.slice(0, dropIdx), ...out.slice(dropEnd)];
  }

  return out;
}
