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

import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/cloudflare';
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
  /*
   * Query build_jobs where validation_result->>'chatId' = projectId AND user_id = userId.
   * We use the jsonb path operator (->>) to extract chatId from the validation_result
   * JSONB column. This links the build job to the IndexedDB chat.
   */
  const { data, error } = await supabase
    .from('build_jobs')
    .select('id')
    .eq('user_id', userId)
    .filter('validation_result->>chatId', 'eq', projectId)
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
  const action = url.searchParams.get('action') || 'list';
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

  // ─── GET /api/workspace?action=download&projectId=xxx&path=downloads/file.zip ───
  // Serves a file as an attachment (forces download in the browser).
  // Used for generated outputs in the downloads/ folder.
  if (action === 'download') {
    const path = url.searchParams.get('path');

    if (!path) {
      return json({ error: 'path is required' }, { status: 400 });
    }

    const normalized = path.replace(/^\/+/, '').replace(/\.\./g, '');
    const workspaceKey = `projects/${projectId}/workspace/${normalized}`;
    const storageKey = `${authed.user.id}/${workspaceKey}`;

    const { data: fileData, error: downloadError } = await authed.supabase.storage
      .from(BUCKET)
      .download(storageKey);

    if (downloadError || !fileData) {
      return json({ error: 'File not found', path: normalized }, { status: 404 });
    }

    const content = await fileData.text();
    const mimeType = inferMime(normalized);
    const filename = normalized.split('/').pop() || 'download';

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
        'X-File-Size': String(content.length),
      },
    });
  }

  // ─── GET /api/workspace?action=uploads&projectId=xxx ───
  // Lists files in the uploads/ folder specifically.
  if (action === 'uploads') {
    const prefix = `${authed.user.id}/projects/${projectId}/workspace/uploads/`;
    const supabase = authed.supabase;
    const files: string[] = [];

    async function listUploads(currentPrefix: string) {
      const { data, error } = await supabase.storage.from(BUCKET).list(currentPrefix, {
        limit: 1000,
        offset: 0,
      });

      if (error || !data) {
        return;
      }

      for (const item of data) {
        const fullPath = `${currentPrefix}${item.name}`;

        if (item.metadata === null) {
          await listUploads(`${fullPath}/`);
        } else {
          const relative = fullPath.slice(prefix.length);
          files.push(relative);
        }
      }
    }

    await listUploads(prefix);

    return json({ uploads: files, count: files.length }, { status: 200 });
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

  return json(
    { error: 'Unknown action. Use action=list, action=file, action=worklog, action=manifest, or action=download' },
    { status: 400 },
  );
}

/*
 * POST /api/workspace — Upload files to the workspace
 *
 * Body: multipart/form-data with:
 *   - projectId: string (the chat ID)
 *   - path: string (relative path in workspace, e.g. "uploads/photo.png")
 *   - file: File (the uploaded file)
 *
 * The file is stored in Supabase Storage at:
 *   {userId}/projects/{projectId}/workspace/{path}
 *
 * This allows users to upload images, CSVs, PDFs, etc. that the agent
 * can then read with read_file and use in the project.
 */
export async function action(args: ActionFunctionArgs) {
  const { request, context } = args;

  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData();
  const projectId = formData.get('projectId') as string | null;
  const filePath = formData.get('path') as string | null;
  const file = formData.get('file') as File | null;

  if (!projectId || !filePath || !file) {
    return json({ error: 'projectId, path, and file are required' }, { status: 400 });
  }

  // Verify ownership
  const owns = await verifyProjectOwnership(authed.supabase, authed.user.id, projectId);

  if (!owns) {
    return json({ error: 'Project not found or access denied' }, { status: 403 });
  }

  // Normalize the path — strip leading slashes, prevent directory traversal
  const normalized = filePath.replace(/^\/+/, '').replace(/\.\./g, '');

  // Read file content
  const arrayBuffer = await file.arrayBuffer();
  const content = new Uint8Array(arrayBuffer);

  // Upload to Supabase Storage
  const storageKey = `${authed.user.id}/projects/${projectId}/workspace/${normalized}`;

  const { error: uploadError } = await authed.supabase.storage
    .from(BUCKET)
    .upload(storageKey, content, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    });

  if (uploadError) {
    logger.error(`Upload failed for ${normalized}:`, uploadError.message);
    return json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 });
  }

  return json(
    {
      success: true,
      path: normalized,
      size: content.byteLength,
      contentType: file.type || 'application/octet-stream',
    },
    { status: 201 },
  );
}
