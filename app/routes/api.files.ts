/**
 * /api/files — Phase 2 R2 Proxy
 *
 * The browser cannot access R2 directly (CORS, credentials). This route
 * fetches files from R2 via the external worker's signed URL pattern OR
 * via Supabase Storage if we're using that as a fallback.
 *
 * For Phase 2 narrow scope: the external worker writes files to R2 AND
 * mirrors them to Supabase Storage (palmkit-files bucket) so the browser
 * can fetch via Supabase's built-in signed URLs. This avoids needing a
 * separate R2 proxy with credentials in CF Pages.
 *
 * Flow:
 *   Browser → GET /api/files?jobId=xxx&path=index.html
 *   → look up storage_key in project_files_manifest
 *   → fetch from Supabase Storage (palmkit-files bucket)
 *   → return with correct Content-Type
 *
 * Auth: user must own the job (RLS enforces).
 */

import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.files');

const BUCKET = 'palmkit-files';

function inferMime(path: string): string {
  if (path.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }

  if (path.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }

  if (path.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }

  if (path.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }

  if (path.endsWith('.svg')) {
    return 'image/svg+xml';
  }

  return 'text/plain; charset=utf-8';
}

export async function loader(args: LoaderFunctionArgs) {
  const { request, context } = args;

  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');
  const path = url.searchParams.get('path');

  if (!jobId || !path) {
    return json({ error: 'jobId and path are required' }, { status: 400 });
  }

  // Look up the manifest entry (RLS: user must own the job).
  const { data: manifest, error: manifestError } = await authed.supabase
    .from('project_files_manifest')
    .select('storage_key, storage_provider, mime_type, size_bytes')
    .eq('job_id', jobId)
    .eq('path', path)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (manifestError || !manifest) {
    return json({ error: 'File not found in manifest' }, { status: 404 });
  }

  /*
   * Phase 2: fetch from Supabase Storage (worker mirrors R2 → Storage).
   * The RLS policy requires the first path segment to be the user_id.
   * The worker writes the mirror at: <user_id>/<r2Key>
   */
  const storageKey = `${authed.user.id}/${manifest.storage_key}`;

  const { data: fileData, error: downloadError } = await authed.supabase.storage.from(BUCKET).download(storageKey);

  if (downloadError || !fileData) {
    logger.error(`Failed to download ${storageKey}:`, downloadError?.message);
    return json({ error: 'File not found in storage' }, { status: 404 });
  }

  const content = await fileData.text();
  const mimeType = manifest.mime_type ?? inferMime(path);

  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache',
      'X-File-Size': String(manifest.size_bytes ?? content.length),
    },
  });
}
