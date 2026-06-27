/**
 * /api/jobs — Phase 2 Build Job API (thin CF Pages endpoint)
 *
 * This is the THIN API that stays on Cloudflare Pages. It does NOT run
 * generation — that's the external worker's job. This route only:
 *
 *   POST   /api/jobs          → enqueue a new build job (status='pending')
 *   GET    /api/jobs/:id      → fetch job status + progress + current step
 *   GET    /api/jobs/:id/events → SSE stream of status updates (Phase 2.1)
 *
 * The external worker polls Supabase for 'pending' jobs, claims them via
 * the claim_next_build_job() RPC, and updates status as it progresses.
 * The browser polls GET /api/jobs/:id (every 2s) to render progress.
 *
 * See ROADMAP.md → Phase 2.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.jobs');

/**
 * POST /api/jobs — enqueue a new build job.
 *
 * Body:
 *   {
 *     prompt: string,
 *     model: string,
 *     provider: string,
 *     projectId?: string  // optional, for incremental edits
 *     files?: Record<string, string>  // existing files (for edits)
 *   }
 *
 * Response:
 *   200 { jobId: string, status: 'pending' }
 *   401 { error: 'Unauthorized' }
 *   500 { error: string }
 */
export async function action(args: ActionFunctionArgs) {
  const { request, context } = args;

  // Auth
  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { prompt, model, provider, projectId, files } = body;

  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }

  if (!model || !provider) {
    return json({ error: 'model and provider are required' }, { status: 400 });
  }

  /*
   * Insert a new build_jobs row with status='pending'.
   * Let the DB generate the UUID primary key (gen_random_uuid()).
   */
  const { data: newJob, error: insertError } = await authed.supabase
    .from('build_jobs')
    .insert({
      project_id: projectId ?? null,
      user_id: authed.user.id,
      status: 'pending',
      current_step: 'queued',
      progress: 0,
      retry_count: 0,
      has_completion_marker: false,
      validation_result: { prompt, model, provider, fileCount: Object.keys(files ?? {}).length },
    })
    .select('id')
    .single();

  if (insertError || !newJob) {
    logger.error('Failed to insert build job:', insertError?.message ?? 'no data returned');
    return json({ error: 'Failed to enqueue job' }, { status: 500 });
  }

  const jobId = newJob.id as string;

  /*
   * If files were provided (incremental edit), upload them to Storage
   * under palmkit-files/<userId>/<jobId>/_input/<path>.
   * The worker reads these as the starting fileset.
   */
  if (files && Object.keys(files).length > 0) {
    const inputPrefix = `${authed.user.id}/${jobId}/_input`;

    for (const [path, content] of Object.entries(files)) {
      const { error: uploadError } = await authed.supabase.storage
        .from('palmkit-files')
        .upload(`${inputPrefix}/${path}`, content as string, {
          contentType: 'text/plain',
          upsert: true,
        });

      if (uploadError) {
        logger.warn(`Failed to upload input file ${path}:`, uploadError.message);

        // Non-fatal — worker will proceed without the input file.
      }
    }
  }

  logger.info(`Enqueued job ${jobId} for user ${authed.user.id}: "${prompt.slice(0, 60)}..."`);

  return json({ jobId, status: 'pending' });
}

/**
 * GET /api/jobs?id=<jobId> — fetch job status.
 *
 * Response:
 *   200 {
 *     jobId, status, currentStep, progress, retryCount,
 *     errorSummary, hasCompletionMarker, fileCount,
 *     files: [{ path, size, integrity }]  // from manifest
 *   }
 *   401 { error: 'Unauthorized' }
 *   404 { error: 'Job not found' }
 */
export async function loader(args: LoaderFunctionArgs) {
  const { request, context } = args;

  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('id');

  if (!jobId) {
    return json({ error: 'id query param is required' }, { status: 400 });
  }

  // Fetch the job (RLS ensures user can only see their own).
  const { data: job, error: jobError } = await authed.supabase
    .from('build_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (jobError || !job) {
    return json({ error: 'Job not found' }, { status: 404 });
  }

  // Fetch the file manifest for the job (by job_id, not project_id — job-first flow).
  const { data: manifest } = await authed.supabase
    .from('project_files_manifest')
    .select('path, size_bytes, integrity, mime_type')
    .eq('job_id', jobId)
    .order('path');

  const files: Array<{ path: string; size_bytes: number; integrity: string; mime_type: string }> = manifest ?? [];

  // Fetch recent job_events (for frontend progress display).
  const { data: events } = await authed.supabase
    .from('job_events')
    .select('type, seq, message, payload, created_at')
    .eq('job_id', jobId)
    .order('seq', { ascending: true })
    .limit(50);

  return json({
    jobId: job.id,
    status: job.status,
    currentStep: job.current_step,
    progress: job.progress,
    retryCount: job.retry_count,
    errorSummary: job.error_summary,
    hasCompletionMarker: job.has_completion_marker,
    fileCount: files.length,
    files,
    events: events ?? [],
    updatedAt: job.updated_at,
  });
}
