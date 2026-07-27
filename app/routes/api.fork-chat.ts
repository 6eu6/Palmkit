/**
 * /api/fork-chat — "Continue in a fresh chat"
 *
 * When a project's chat gets long, editing it keeps re-sending the whole
 * workspace to the model as context. This route lets the user carry the
 * project into a brand-new chat with a CLEAN context window while keeping the
 * full project + its memory.
 *
 * What it does (server-side, no R2 credentials needed — everything goes through
 * Supabase Storage, which the Oracle worker mirrors and later hydrates into R2):
 *
 *   1. Copies the caller-supplied project files into the NEW project's
 *      workspace mirror: `{userId}/projects/{targetProjectId}/workspace/{path}`.
 *   2. Reads the source project's worklog.md + manifest.json (its memory) and
 *      copies them into the new workspace.
 *   3. Generates `.palmkit/handoff.md` — a compact continuation brief (type,
 *      stack, file list, last state, suggested next step). The worker injects
 *      this into the agents' prompts so the model KNOWS it is continuing an
 *      existing project, with its real state, before doing anything.
 *
 * It returns the welcome text + a suggested next step for the new chat's UI.
 * The client creates the IndexedDB chat + seeds the workbench.
 *
 * Auth: authenticated user only. All keys are scoped under the user's id.
 */

import type { ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.fork-chat');

const BUCKET = 'palmkit-files';

interface ForkBody {
  sourceProjectId?: string;
  targetProjectId?: string;
  projectName?: string;
  files?: Record<string, string>;
}

interface SmartManifest {
  appType?: string | null;
  projectType?: string;
  stack?: { frontend?: string; backend?: string; database?: string; styling?: string };
  entrypoints?: { frontend?: string; backend?: string; html?: string };
  commands?: Record<string, string | undefined>;
  importantFiles?: string[];
  apiRoutes?: string[];
  lastBuildSummary?: string | null;
  lastKnownStatus?: string;
  knownIssues?: string[];
}

/** Build the .palmkit/handoff.md continuation brief. */
function buildHandoff(params: {
  projectName: string;
  sourceProjectId: string;
  filePaths: string[];
  manifest: SmartManifest | null;
  worklog: string | null;
}): string {
  const { projectName, sourceProjectId, filePaths, manifest, worklog } = params;

  const stack = manifest?.stack
    ? [manifest.stack.frontend, manifest.stack.backend, manifest.stack.database, manifest.stack.styling]
        .filter(Boolean)
        .join(' + ')
    : '';

  // The tail of the worklog is the most recent activity — the "last changes".
  const worklogTail = worklog ? worklog.split('\n').slice(-40).join('\n').trim() : '';

  const lines: string[] = [];
  lines.push(`# Continuation Handoff`);
  lines.push('');
  lines.push(
    `This project was carried over from a previous chat (source: ${sourceProjectId}). You are **continuing** it — its files and memory are already in the workspace. Inspect what exists before changing it; do NOT rebuild from scratch.`,
  );
  lines.push('');
  lines.push(`## Project`);
  lines.push(`- **Name**: ${projectName}`);

  if (manifest?.projectType) {
    lines.push(`- **Type**: ${manifest.projectType}`);
  }

  if (manifest?.appType) {
    lines.push(`- **App type**: ${manifest.appType}`);
  }

  if (stack) {
    lines.push(`- **Stack**: ${stack}`);
  }

  if (manifest?.entrypoints) {
    const ep = manifest.entrypoints;
    const epStr = [
      ep.frontend && `frontend: ${ep.frontend}`,
      ep.backend && `backend: ${ep.backend}`,
      ep.html && `html: ${ep.html}`,
    ]
      .filter(Boolean)
      .join(', ');

    if (epStr) {
      lines.push(`- **Entry points**: ${epStr}`);
    }
  }

  if (manifest?.commands) {
    const cmds = Object.entries(manifest.commands)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `${k}: \`${v}\``)
      .join(', ');

    if (cmds) {
      lines.push(`- **Commands**: ${cmds}`);
    }
  }

  if (manifest?.apiRoutes && manifest.apiRoutes.length > 0) {
    lines.push(`- **API routes**: ${manifest.apiRoutes.slice(0, 20).join(', ')}`);
  }

  lines.push('');
  lines.push(`## Files (${filePaths.length})`);

  for (const p of filePaths.slice(0, 80).sort()) {
    lines.push(`- ${p}`);
  }

  if (filePaths.length > 80) {
    lines.push(`- …and ${filePaths.length - 80} more`);
  }

  lines.push('');
  lines.push(`## Current state`);
  lines.push(`- **Last known status**: ${manifest?.lastKnownStatus ?? 'unknown'}`);

  if (manifest?.lastBuildSummary) {
    lines.push(`- **Last build summary**: ${manifest.lastBuildSummary}`);
  }

  if (manifest?.knownIssues && manifest.knownIssues.length > 0) {
    lines.push(`- **Known issues**: ${manifest.knownIssues.join('; ')}`);
  }

  if (worklogTail) {
    lines.push('');
    lines.push(`## Recent activity (worklog tail)`);
    lines.push('```');
    lines.push(worklogTail);
    lines.push('```');
  }

  return lines.join('\n');
}

/** A concrete, human-facing suggested next step for the fresh chat. */
function buildSuggestion(projectName: string, manifest: SmartManifest | null): string {
  const issue = manifest?.knownIssues?.[0];

  if (issue) {
    return `Fix: ${issue}`;
  }

  if (manifest?.lastKnownStatus === 'build_failed') {
    return `Diagnose and fix the failing build`;
  }

  return `Add the next feature to ${projectName}`;
}

export async function action(args: ActionFunctionArgs) {
  const { request, context } = args;

  const authed = await getAuthedUser(request, context);

  if (!authed?.user || !authed.supabase) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: ForkBody;

  try {
    body = (await request.json()) as ForkBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sourceProjectId, targetProjectId, projectName: rawName, files } = body;

  if (!sourceProjectId || !targetProjectId) {
    return json({ error: 'sourceProjectId and targetProjectId are required' }, { status: 400 });
  }

  if (!files || Object.keys(files).length === 0) {
    return json({ error: 'No files to carry over' }, { status: 400 });
  }

  const userId = authed.user.id;
  const supabase = authed.supabase;
  const projectName = (rawName || 'your project').slice(0, 80);

  const targetPrefix = `${userId}/projects/${targetProjectId}/workspace`;
  const sourcePrefix = `${userId}/projects/${sourceProjectId}/workspace`;

  // 1. Copy the project files into the new workspace mirror.
  const filePaths = Object.keys(files).filter(
    (p) => p !== 'worklog.md' && p !== 'manifest.json' && !p.startsWith('.palmkit/'),
  );

  let uploaded = 0;

  for (const path of filePaths) {
    const normalized = path.replace(/^\/+/, '').replace(/\.\./g, '');
    const { error } = await supabase.storage.from(BUCKET).upload(`${targetPrefix}/${normalized}`, files[path], {
      contentType: 'text/plain',
      upsert: true,
    });

    if (error) {
      logger.warn(`Failed to upload ${normalized}: ${error.message}`);
    } else {
      uploaded++;
    }
  }

  if (uploaded === 0) {
    return json({ error: 'Failed to copy project files' }, { status: 500 });
  }

  // 2. Read the source project's memory (worklog + manifest).
  let worklog: string | null = null;
  let manifest: SmartManifest | null = null;

  try {
    const { data } = await supabase.storage.from(BUCKET).download(`${sourcePrefix}/worklog.md`);

    if (data) {
      worklog = await data.text();
    }
  } catch {
    // best-effort
  }

  try {
    const { data } = await supabase.storage.from(BUCKET).download(`${sourcePrefix}/manifest.json`);

    if (data) {
      manifest = JSON.parse(await data.text()) as SmartManifest;
    }
  } catch {
    // best-effort
  }

  // 3. Seed the new workspace's memory so the worker treats it as a continuation.
  const forkNote = `\n## ${new Date().toISOString()}\n\n**Continued in a fresh chat** — carried over ${uploaded} files from ${sourceProjectId}.\n`;
  const newWorklog = (worklog ?? `# Project Worklog\n\nThis file is the project's memory.\n`) + forkNote;

  await supabase.storage.from(BUCKET).upload(`${targetPrefix}/worklog.md`, newWorklog, {
    contentType: 'text/markdown',
    upsert: true,
  });

  if (manifest) {
    await supabase.storage.from(BUCKET).upload(`${targetPrefix}/manifest.json`, JSON.stringify(manifest, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });
  }

  const handoff = buildHandoff({ projectName, sourceProjectId, filePaths, manifest, worklog });

  await supabase.storage.from(BUCKET).upload(`${targetPrefix}/.palmkit/handoff.md`, handoff, {
    contentType: 'text/markdown',
    upsert: true,
  });

  logger.info(`Forked ${sourceProjectId} → ${targetProjectId}: ${uploaded} files, handoff ${handoff.length} chars`);

  const suggestion = buildSuggestion(projectName, manifest);
  const statusLine =
    manifest?.lastBuildSummary?.slice(0, 160) ||
    (manifest?.lastKnownStatus ? `last build ${manifest.lastKnownStatus}` : 'ready to continue');

  const welcome =
    `I've carried **${projectName}** into a fresh chat — all ${uploaded} file${uploaded === 1 ? '' : 's'} and the ` +
    `project's memory came with it, so this conversation starts with a clean, fast context.\n\n` +
    `**Current state:** ${statusLine}.\n\nWhat would you like to do next?`;

  return json({
    ok: true,
    targetProjectId,
    fileCount: uploaded,
    appType: manifest?.appType ?? null,
    suggestion,
    welcome,
  });
}
