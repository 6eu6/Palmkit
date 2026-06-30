/**
 * /api/workspace — Unified Workspace API
 *
 * This is the new API for reading from a project's unified workspace in R2.
 * It replaces the fragmented /api/files?jobId=... with a single endpoint
 * that reads from projects/{projectId}/workspace/{path}.
 *
 * Endpoints:
 *   GET /api/workspace/list?projectId=xxx
 *     → List all files in the workspace (returns relative paths)
 *
 *   GET /api/workspace/file?projectId=xxx&path=worklog.md
 *     → Read a single file from the workspace
 *
 *   GET /api/workspace/manifest?projectId=xxx
 *     → Read the project manifest (metadata)
 *
 *   GET /api/workspace/worklog?projectId=xxx
 *     → Read the project worklog (memory)
 *
 * Auth: user must be authenticated. Project ownership is verified via
 * the build_jobs table (the user must own at least one job for the project).
 */

import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.workspace');

/*
 * R2 S3-compatible credentials are NOT available in CF Pages (only in worker).
 * So we proxy through Supabase Storage which has the mirror.
 */
const BUCKET = 'palmkit-files';

function inferMime(path: string): string {
  if (path.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }

  if (path.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }

  if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.ts') || path.endsWith('.tsx')) {
    return 'text/javascript; charset=utf-8';
  }

  if (path.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }

  if (path.endsWith('.md')) {
    return 'text/markdown; charset=utf-8';
  }

  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }

  if (path.endsWith('.prisma')) {
    return 'application/prisma; charset=utf-8';
  }

  return 'text/plain; charset=utf-8';
}

/**
 * Verify that the user owns the project. A project is "owned" if the user
 * has at least one build job with that project_id.
 */
async function verifyProjectOwnership(supabase: any, userId: string, projectId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('build_jobs')
    .select('id')
    .eq('user_id', userId)
    .or(`project_id.eq.${projectId},id.eq.${projectId}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error(`Ownership check failed for ${projectId}:`, error.message);
    return false;
  }

  return !!data;
}

export async function loader(args: LoaderFunctionArgs) {
  const { request, context } = args;

  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const action = url.pathname.split('/').pop() || '';
  const projectId = url.searchParams.get('projectId');

  if (!projectId) {
    return json({ error: 'projectId is required' }, { status: 400 });
  }

  // Verify the user owns this project
  const owns = await verifyProjectOwnership(authed.supabase, authed.user.id, projectId);

  if (!owns) {
    return json({ error: 'Project not found or access denied' }, { status: 403 });
  }

  // ─── GET /api/workspace/file?projectId=xxx&path=worklog.md ───
  if (action === 'file') {
    const path = url.searchParams.get('path');

    if (!path) {
      return json({ error: 'path is required' }, { status: 400 });
    }

    // Normalize the path — strip leading slashes and ../
    const normalized = path.replace(/^\/+/, '').replace(/\.\./g, '');
    const workspaceKey = `projects/${projectId}/workspace/${normalized}`;
    const storageKey = `${authed.user.id}/${workspaceKey}`;

    const { data: fileData, error: downloadError } = await authed.supabase.storage.from(BUCKET).download(storageKey);

    if (downloadError || !fileData) {
      return json({ error: 'File not found', path: normalized }, { status: 404 });
    }

    const content = await fileData.text();
    const mimeType = inferMime(normalized);

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache',
        'X-File-Size': String(content.length),
      },
    });
  }

  // ─── GET /api/workspace/worklog?projectId=xxx ───
  if (action === 'worklog') {
    const workspaceKey = `projects/${projectId}/workspace/worklog.md`;
    const storageKey = `${authed.user.id}/${workspaceKey}`;

    const { data: fileData, error: downloadError } = await authed.supabase.storage.from(BUCKET).download(storageKey);

    if (downloadError || !fileData) {
      return json({ worklog: null, message: 'No worklog found for this project' }, { status: 200 });
    }

    const content = await fileData.text();

    return json({ worklog: content, size: content.length }, { status: 200 });
  }

  // ─── GET /api/workspace/manifest?projectId=xxx ───
  if (action === 'manifest') {
    const workspaceKey = `projects/${projectId}/workspace/manifest.json`;
    const storageKey = `${authed.user.id}/${workspaceKey}`;

    const { data: fileData, error: downloadError } = await authed.supabase.storage.from(BUCKET).download(storageKey);

    if (downloadError || !fileData) {
      return json(
        {
          manifest: {
            projectId,
            appType: null,
            framework: null,
            createdAt: new Date().toISOString(),
            lastBuildAt: null,
            lastBuildSummary: null,
            fileCount: 0,
            sandboxId: null,
            sandboxState: null,
          },
          message: 'No manifest found — new project',
        },
        { status: 200 },
      );
    }

    const content = await fileData.text();

    try {
      const manifest = JSON.parse(content);
      return json({ manifest }, { status: 200 });
    } catch {
      return json({ error: 'Invalid manifest JSON' }, { status: 500 });
    }
  }

  // ─── GET /api/workspace/list?projectId=xxx ───
  if (action === 'list') {
    // List all files in the workspace prefix in Supabase Storage
    const prefix = `${authed.user.id}/projects/${projectId}/workspace/`;
    const supabase = authed.supabase;

    // Recursively list files (Supabase list only returns one level)
    const files: string[] = [];

    async function listRecursive(currentPrefix: string) {
      const { data, error } = await supabase.storage.from(BUCKET).list(currentPrefix, {
        limit: 1000,
        offset: 0,
      });

      if (error || !data) {
        if (currentPrefix === prefix) {
          logger.error(`Failed to list workspace for ${projectId}:`, error?.message);
        }

        return;
      }

      for (const item of data) {
        const fullPath = `${currentPrefix}${item.name}`;

        if (item.metadata === null) {
          // It's a folder — recurse
          await listRecursive(`${fullPath}/`);
        } else {
          // It's a file — strip the prefix to get relative path
          const relative = fullPath.slice(prefix.length);
          files.push(relative);
        }
      }
    }

    await listRecursive(prefix);

    return json({ files, count: files.length }, { status: 200 });
  }

  return json({ error: 'Unknown action. Use /list, /file, /worklog, or /manifest' }, { status: 400 });
}
