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

  const {
    prompt,
    model,
    provider,
    projectId,
    files,
    editJobId,
    reasoningEffort,
    modelRoles,
    skills,
    libraries,
    agentConfig,
  } = body;

  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }

  if (!model || !provider) {
    return json({ error: 'model and provider are required' }, { status: 400 });
  }

  /*
   * Look up the model's maxCompletionTokens from the LLM manager so the
   * Oracle worker can use the model's actual output limit instead of a
   * hardcoded 16000-token cap (which caused JSON truncation on big projects).
   */
  let maxCompletionTokens: number | undefined;

  /*
   * Also capture the model's context window (maxTokenAllowed). The worker uses
   * it to compute how full the context actually got during the build, which
   * drives the honest "continue in a fresh chat" nudge — a real token
   * measurement instead of a naive file count.
   */
  let contextWindow: number | undefined;

  try {
    const llmManagerModule = await import('~/lib/modules/llm/manager');
    const { PROVIDER_LIST } = await import('~/utils/constants');
    const providerObj = PROVIDER_LIST.find((p) => p.name === provider);

    if (providerObj) {
      const staticModels = llmManagerModule.LLMManager.getInstance().getStaticModelListFromProvider(providerObj);
      const modelDetails = staticModels.find((m) => m.name === model);
      maxCompletionTokens = modelDetails?.maxCompletionTokens;
      contextWindow = modelDetails?.maxTokenAllowed;
    }
  } catch (e) {
    logger.warn(`Could not look up model limits for ${provider}/${model}:`, (e as Error).message);
  }

  /*
   * Insert a new build_jobs row with status='pending'.
   * Let the DB generate the UUID primary key (gen_random_uuid()).
   */
  const { data: newJob, error: insertError } = await authed.supabase
    .from('build_jobs')
    .insert({
      /*
       * Don't set project_id — it's a UUID column referencing the projects
       * table, but our chatId is a timestamp string (e.g. "1782790105150").
       * Instead, we store the chatId in validation_result.chatId (jsonb).
       * The workspace files are keyed on chatId, not project_id.
       */
      project_id: null,
      user_id: authed.user.id,
      status: 'pending',
      current_step: 'queued',
      progress: 0,
      retry_count: 0,
      has_completion_marker: false,
      validation_result: {
        prompt,
        model,
        provider,
        fileCount: Object.keys(files ?? {}).length,

        /*
         * Store the chat ID (projectId) in validation_result so we can
         * query build_jobs by chat ID later. This links the build job to
         * the IndexedDB chat, enabling workspace file restore on reload.
         * We use validation_result (jsonb) instead of adding a new column
         * because we can't run DDL via the REST API.
         */
        ...(projectId ? { chatId: projectId } : {}),
        ...(maxCompletionTokens ? { maxCompletionTokens } : {}),
        ...(contextWindow ? { contextWindow } : {}),
        ...(editJobId ? { editJobId } : {}),

        /*
         * Model Router + thinking control (Design v2).
         * reasoningEffort: 'off' | 'medium' | 'max' — how hard reasoning
         * models think. modelRoles: per-task model overrides
         * ({ brain, builder, tester, vision, media }); empty = main model.
         */
        ...(reasoningEffort && ['off', 'medium', 'max'].includes(reasoningEffort) ? { reasoningEffort } : {}),
        ...(modelRoles && typeof modelRoles === 'object' ? { modelRoles } : {}),

        /*
         * Skills: enabled instruction playbooks ({ name, instructions }) that
         * the orchestrator injects into the Planner/Builder prompt. Cap to keep
         * the row small and prevent prompt bloat from a runaway client.
         */
        ...(Array.isArray(skills) && skills.length > 0
          ? {
              skills: skills
                .filter(
                  (s: unknown): s is { name: string; instructions: string } =>
                    !!s && typeof (s as any).name === 'string' && typeof (s as any).instructions === 'string',
                )
                .slice(0, 12)
                .map((s) => ({ name: s.name.slice(0, 80), instructions: s.instructions.slice(0, 2000) })),
            }
          : {}),

        /*
         * Libraries: reference material ({ name, kind, content }) injected into
         * the Builder. Capped like skills to keep the row small.
         */
        ...(Array.isArray(libraries) && libraries.length > 0
          ? {
              libraries: libraries
                .filter(
                  (l: unknown): l is { name: string; kind: string; content: string } =>
                    !!l && typeof (l as any).name === 'string' && typeof (l as any).content === 'string',
                )
                .slice(0, 12)
                .map((l) => ({
                  name: l.name.slice(0, 80),
                  kind: typeof l.kind === 'string' ? l.kind.slice(0, 24) : 'ref',
                  content: l.content.slice(0, 4000),
                })),
            }
          : {}),

        /*
         * Agents: optional pipeline phases the user turned off (Researcher /
         * Tester). Only present when non-default; the orchestrator honours it.
         */
        ...(agentConfig && typeof agentConfig === 'object'
          ? { agentConfig: { researcher: agentConfig.researcher !== false, tester: agentConfig.tester !== false } }
          : {}),
      },
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
 *     appType, runtimeMode  // from worker's validation_result
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

  /*
   * Fetch job_events for the frontend progress display.
   *
   * IMPORTANT: this must NOT be capped low. A single build routinely emits
   * 100+ events (reasoning, file_written, todos, tool calls). The old
   * `.limit(50)` returned only seq 0-49, so the frontend froze mid-build and
   * never received the terminal `ready_for_preview` event — the #1 cause of
   * builds appearing "stuck / never ending".
   *
   * Incremental fetch: callers may pass `?sinceSeq=<n>` to receive only
   * events with a higher seq than they already have (the polling loop tracks
   * lastEventSeq). Default 0 returns the full ordered log.
   */
  const sinceSeqRaw = url.searchParams.get('sinceSeq');
  const sinceSeq = sinceSeqRaw ? Number.parseInt(sinceSeqRaw, 10) || 0 : 0;

  const { data: events } = await authed.supabase
    .from('job_events')
    .select('type, seq, message, payload, created_at')
    .eq('job_id', jobId)
    .gt('seq', sinceSeq - 1) // seq >= sinceSeq (inclusive of first unseen)
    .order('seq', { ascending: true })
    .limit(2000);

  const vr = (job.validation_result ?? {}) as Record<string, unknown>;

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
    validationResult: job.validation_result,
    appType: (vr.appType as string) ?? null,
    runtimeMode: (vr.runtimeMode as string) ?? null,
  });
}
