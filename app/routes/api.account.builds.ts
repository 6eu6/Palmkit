/**
 * /api/account/builds — Phase 6 Project History
 *
 * GET  → list up to 20 completed builds (status=ready_for_preview) for the
 *         authenticated user, sorted newest first.
 *
 * GET ?id=<jobId> → single build detail (files list for re-opening).
 *
 * DELETE ?id=<jobId> → remove the job record (R2 files stay; add cleanup later).
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');

  if (jobId) {
    const { data: job, error } = await authed.supabase
      .from('build_jobs')
      .select('id, status, validation_result, created_at, updated_at, project_id')
      .eq('id', jobId)
      .eq('user_id', authed.user.id)
      .single();

    if (error || !job) {
      return json({ error: 'Build not found' }, { status: 404 });
    }

    const { data: files } = await authed.supabase
      .from('project_files_manifest')
      .select('path, size_bytes, mime_type, integrity')
      .eq('job_id', jobId)
      .order('path');

    return json({ job, files: files ?? [] });
  }

  const { data: builds, error } = await authed.supabase
    .from('build_jobs')
    .select('id, status, validation_result, created_at, updated_at')
    .eq('user_id', authed.user.id)
    .eq('status', 'ready_for_preview')
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ builds: builds ?? [] });
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');

  if (!jobId) {
    return json({ error: 'id required' }, { status: 400 });
  }

  const { error } = await authed.supabase.from('build_jobs').delete().eq('id', jobId).eq('user_id', authed.user.id);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ ok: true });
}
