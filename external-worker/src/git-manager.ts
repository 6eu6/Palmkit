/**
 * Git Manager — per-project version history (M1).
 *
 * Every Palmkit project directory (~/palmkit-projects/{projectId}) is its
 * own git repository. After every agent turn (build or edit) the worker
 * makes an automatic checkpoint commit. The user never sees git — they get
 * the product features it enables:
 *
 *   - a version history per project ("what changed, when")
 *   - real undo: restore the whole project to any checkpoint
 *   - diffs: exactly what an edit touched
 *   - later: one-tap "push to the user's own GitHub"
 *
 * The last 20 checkpoints are exported to .palmkit/history.json (disk + R2
 * + Supabase Storage mirror via writePalmkitFile), so the frontend can
 * render a history panel WITHOUT talking to the worker directly.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from './logger';
import { projectDiskDir, writeProjectFileToDisk, writePalmkitFile } from './workspace-manager';
import type { SupabaseClient } from '@supabase/supabase-js';

const execFileP = promisify(execFile);

export interface Checkpoint {
  hash: string;
  date: string;
  message: string;
}

/** Run git in a project dir with the Palmkit committer identity. */
async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Palmkit',
      GIT_AUTHOR_EMAIL: 'agent@palmkit.app',
      GIT_COMMITTER_NAME: 'Palmkit',
      GIT_COMMITTER_EMAIL: 'agent@palmkit.app',
    },
    maxBuffer: 4 * 1024 * 1024,
  });

  return stdout;
}

const DEFAULT_GITIGNORE = `node_modules/
dist/
.env
*.log
`;

/**
 * Checkpoint a project turn:
 *   1. Flush the build's full file map to disk (covers legacy projects
 *      whose unchanged files only existed in R2/memory).
 *   2. git init on first use (+ .gitignore).
 *   3. git add -A && git commit (skips cleanly when nothing changed).
 *   4. Export the last 20 checkpoints to .palmkit/history.json.
 *
 * Best-effort by design: version history must never fail a build.
 */
export async function commitProjectTurn(
  projectId: string,
  files: Record<string, string>,
  message: string,
  supabase?: SupabaseClient,
  userId?: string,
): Promise<Checkpoint | null> {
  try {
    const dir = projectDiskDir(projectId);
    await fs.mkdir(dir, { recursive: true });

    // 1. Flush the complete file set to disk.
    for (const [rel, content] of Object.entries(files)) {
      try {
        await writeProjectFileToDisk(projectId, rel, content);
      } catch (e) {
        logger.warn(`[git] flush failed for ${rel}: ${e}`);
      }
    }

    // 2. Init on first use.
    let isRepo = true;

    try {
      await fs.access(path.join(dir, '.git'));
    } catch {
      isRepo = false;
    }

    if (!isRepo) {
      await git(dir, ['init', '-q', '-b', 'main']);
      await writeProjectFileToDisk(projectId, '.gitignore', DEFAULT_GITIGNORE);
      logger.info(`[git] initialized repository for project ${projectId}`);
    }

    // 3. Stage + commit. "nothing to commit" is a normal outcome (e.g. a
    //    turn that only answered a question) — return the current head.
    await git(dir, ['add', '-A']);

    const cleanMsg = (message || 'Palmkit checkpoint').replace(/\s+/g, ' ').slice(0, 100);

    try {
      await git(dir, ['commit', '-q', '-m', cleanMsg]);
    } catch (e: any) {
      if (!/nothing to commit|nothing added/i.test(String(e?.stdout ?? '') + String(e?.stderr ?? '') + String(e?.message ?? ''))) {
        throw e;
      }
    }

    // 4. Export history for the frontend.
    const log = await git(dir, ['log', '--pretty=format:%h|%cI|%s', '-n', '20']);
    const checkpoints: Checkpoint[] = log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...rest] = line.split('|');
        return { hash, date, message: rest.join('|') };
      });

    await writePalmkitFile(projectId, 'history.json', JSON.stringify({ checkpoints }, null, 2), supabase, userId);

    const head = checkpoints[0] ?? null;

    if (head) {
      logger.info(`[git] checkpoint ${head.hash} for ${projectId}: ${head.message}`);
    }

    return head;
  } catch (e) {
    logger.warn(`[git] commitProjectTurn failed for ${projectId}: ${e}`);
    return null;
  }
}

/**
 * Restore a project to a checkpoint (used by a future restore endpoint /
 * UI). Returns the list of files at that checkpoint after reset.
 */
export async function restoreCheckpoint(projectId: string, hash: string): Promise<boolean> {
  try {
    const dir = projectDiskDir(projectId);
    await git(dir, ['reset', '--hard', hash]);
    logger.info(`[git] restored ${projectId} to ${hash}`);
    return true;
  } catch (e) {
    logger.warn(`[git] restore failed for ${projectId} @ ${hash}: ${e}`);
    return false;
  }
}
