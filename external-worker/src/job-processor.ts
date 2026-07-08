/**
 * Job Processor — Phase 2 ACTUAL implementation
 *
 * Lifecycle:
 *   pending → generating → validating → uploading_snapshot → ready_for_preview
 *   OR
 *   pending → generating → failed_clean (with error message)
 *
 * Each phase:
 *   1. claim: atomic claim via claim_next_build_job() RPC
 *   2. plan: planProject(prompt) → spec
 *   3. generate: generateStaticFiles(prompt, spec) → files
 *   4. validate: validateGeneration(result) → issues
 *   5. upload: write each file to R2 at projects/{projectId}/jobs/{jobId}/files/{path}
 *   6. manifest: insert project_files_manifest rows (metadata only)
 *   7. finalize: status = ready_for_preview
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';
import {
  planProject,
  detectAppTypeFromFiles,
  type GenerationResult,
} from './generator';
import { runOrchestratedBuild } from './orchestrator';
import { createRunner } from './build-runner';
import { putFile, getFileText, buildKey, buildWorkspaceKey } from './r2-client';
import { hydrateWorkspaceFromStorage, readWorklog, readWorkspaceFile } from './workspace-manager';
import { getUserApiKey } from './key-fetcher';
import { DEFAULT_IMAGE_MODEL } from './image-gen';
import { emitEvent, emitFileWritten } from './event-emitter';
import { createHash } from 'crypto';

interface BuildJob {
  id: string;
  project_id: string | null;
  user_id: string;
  status: string;
  current_step: string | null;
  progress: number;
  retry_count: number;
  validation_result: any;
}

/**
 * Atomically claim the next pending job using the RPC.
 */
async function claimNextJob(supabase: SupabaseClient): Promise<BuildJob | null> {
  const { data, error } = await supabase.rpc('claim_next_build_job');

  if (error) {
    logger.error('claim_next_build_job RPC failed:', error.message);
    return null;
  }

  // RPC may return null, [], or a single row object depending on Supabase version.
  const job = Array.isArray(data) ? (data[0] ?? null) : data;

  if (!job || !job.id) {
    return null;
  }

  return job as BuildJob;
}

/**
 * Record a build step.
 */
async function recordStep(
  supabase: SupabaseClient,
  jobId: string,
  step: { type: string; status: string; inputSummary?: string; outputSummary?: string; error?: string; order: number },
): Promise<void> {
  const { error } = await supabase.from('build_steps').insert({
    job_id: jobId,
    type: step.type,
    status: step.status,
    step_order: step.order,
    input_summary: step.inputSummary ?? null,
    output_summary: step.outputSummary ?? null,
    error: step.error ?? null,
  });

  if (error) {
    logger.error(`Failed to record step for job ${jobId}:`, error.message);
  }
}

/**
 * Update job progress + current step.
 */
async function updateJobProgress(
  supabase: SupabaseClient,
  jobId: string,
  progress: number,
  currentStep: string,
): Promise<void> {
  const { error } = await supabase
    .from('build_jobs')
    .update({ progress, current_step: currentStep, updated_at: new Date().toISOString() })
    .eq('id', jobId);

  if (error) {
    logger.error(`Failed to update progress for job ${jobId}:`, error.message);
  }
}

/**
 * Mark job as failed_clean with an error message.
 */
async function failJob(supabase: SupabaseClient, jobId: string, errorMessage: string): Promise<void> {
  logger.error(`Job ${jobId} FAILED: ${errorMessage}`);

  await supabase
    .from('build_jobs')
    .update({
      status: 'failed_clean',
      error_summary: errorMessage.slice(0, 500),
      current_step: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  await recordStep(supabase, jobId, {
    type: 'finalize',
    status: 'failed',
    order: 99,
    error: errorMessage,
  });
}

/**
 * Process one job end-to-end.
 */
export async function processNextJob(supabase: SupabaseClient): Promise<void> {
  const job = await claimNextJob(supabase);

  if (!job) {
    return;
  }

  logger.info(`Processing job ${job.id} (user=${job.user_id})`);

  // Extract prompt + provider + model from validation_result (stored by /api/jobs on enqueue).
  // NO defaults — the worker must use exactly what the user selected.
  // If model or provider is missing, fail with a clear error.
  const prompt: string = job.validation_result?.prompt ?? '';
  const providerName: string = job.validation_result?.provider ?? '';
  const modelName: string = job.validation_result?.model ?? '';

  if (!prompt) {
    await failJob(supabase, job.id, 'No prompt found in job metadata');
    return;
  }

  if (!modelName || !providerName) {
    await failJob(
      supabase,
      job.id,
      `No model or provider specified. Model="${modelName}", Provider="${providerName}". The user must select a model and provider before building.`,
    );
    return;
  }

  try {
    // ─── Phase 0: FETCH + DECRYPT USER'S API KEY ──────────────────────
    await updateJobProgress(supabase, job.id, 5, 'fetch_api_key');
    await emitEvent(supabase, job.id, 'job_created', 'Job started', {
      prompt: prompt.slice(0, 100),
      provider: providerName,
      model: modelName,
    });

    const apiKey = await getUserApiKey(supabase, job.user_id, providerName);

    if (!apiKey) {
      await failJob(
        supabase,
        job.id,
        `No API key found for your account (provider: ${providerName}). Add one via Edit API Key in the UI.`,
      );
      return;
    }

    logger.info(`Job ${job.id}: API key fetched for provider ${providerName}`);

    /*
     * Create the model instance ONCE — used by both the edit path (agent
     * loop via runOrchestratedBuild) and the new-build path. Previously it
     * was created only inside the new-build block, so the edit path got
     * 'model is not defined'.
     */
    const { getModelInstance } = await import('./provider-registry');
    const model = getModelInstance(providerName, modelName, apiKey);

    /*
     * Per-role model overrides (Model Router). Built once — used by both
     * the edit path (agent loop) and the new-build path. Previously only
     * defined inside the new-build block, so the edit path got
     * 'agentModels is not defined'.
     */
    const agentModels: Partial<Record<'brain' | 'builder' | 'tester', typeof model>> = {};

    /*
     * Skills, libraries, agentConfig, media, designScheme — all extracted
     * from validation_result ONCE at the top level so BOTH the edit path
     * and the new-build path can use them. Previously they were defined
     * only inside the new-build block.
     */
    const roleIds = (job.validation_result?.modelRoles ?? {}) as Partial<
      Record<'brain' | 'builder' | 'tester' | 'vision' | 'media', string>
    >;

    const skills = Array.isArray(job.validation_result?.skills)
      ? (job.validation_result.skills as { name: string; instructions: string }[])
      : undefined;

    const libraries = Array.isArray(job.validation_result?.libraries)
      ? (job.validation_result.libraries as { name: string; kind: string; content: string }[])
      : undefined;

    const agentConfig =
      job.validation_result?.agentConfig && typeof job.validation_result.agentConfig === 'object'
        ? (job.validation_result.agentConfig as { researcher: boolean; tester: boolean })
        : undefined;

    /*
     * Media config for generate_image AND generate_video AND analyze_screenshot.
     *
     * RADICAL REBUILD: the user can now assign a SEPARATE model for the
     * 'vision' role (VLM that analyzes screenshots) and the 'media' role
     * (image + video generation). The Builder agent TALKS TO these models
     * via tool calls — it doesn't need to know which provider they run on.
     *
     * - media.apiKey: the OpenRouter (or provider) key for image gen
     * - media.model: the image model (defaults to gemini-2.5-flash-image)
     * - media.videoApiKey: the Z.ai key for video gen (cogvideox)
     * - media.videoModel: the video model
     * - media.visionApiKey: the Z.ai key for the VLM (analyze_screenshot)
     *
     * If the user assigned a 'vision' or 'media' model in Settings, we use
     * THAT provider's key + model. Otherwise we fall back to the main
     * provider's key.
     */
    /*
     * MEDIA CONFIG — provider-agnostic.
     *
     * The user picks models for each role in Settings:
     *   - Media role → image + video generation model
     *   - Vision role → VLM for analyze_screenshot
     *
     * We resolve the provider from the model name and build a MediaConfig
     * that carries the right API keys + models for each task.
     */
    const mediaRoleModel = roleIds.media || '';
    const visionRoleModel = roleIds.vision || '';

    // Determine provider from model name
    const getProvider = (modelName: string): 'zai' | 'openrouter' | 'google' => {
      if (/glm|cogvideo/i.test(modelName)) return 'zai';
      if (/gemini|veo/i.test(modelName)) return 'google';
      return 'openrouter'; // default for everything else
    };

    const imageProvider = getProvider(mediaRoleModel || DEFAULT_IMAGE_MODEL);
    const videoProvider = getProvider(mediaRoleModel || 'cogvideox-2b');
    const visionProvider = getProvider(visionRoleModel || 'glm-4.6v');

    const media = apiKey
      ? {
          // Image generation
          imageApiKey: apiKey,
          imageModel: mediaRoleModel || DEFAULT_IMAGE_MODEL,
          imageProvider,
          // Video generation
          videoApiKey: apiKey,
          videoModel: mediaRoleModel || 'cogvideox-2b',
          videoProvider,
          // Vision (VLM)
          visionApiKey: apiKey,
          visionModel: visionRoleModel || 'glm-4.6v',
          visionProvider,
          // Legacy compat
          apiKey,
          model: mediaRoleModel || DEFAULT_IMAGE_MODEL,
        }
      : undefined;

    const designScheme = job.validation_result?.designScheme as
      | { palette: Record<string, string>; font: string[]; features: string[] }
      | undefined;

    // ─── Phase 7: EDIT MODE ────────────────────────────────────────────
    const editJobId: string | null = job.validation_result?.editJobId ?? null;

    /*
     * Context window for this model, captured at enqueue time by /api/jobs from
     * the model registry (maxTokenAllowed). Used to compute how full the context
     * actually got during this build — the honest signal behind the "continue in
     * a fresh chat" nudge (replaces the old file-count guess).
     */
    const contextWindow: number | undefined =
      typeof job.validation_result?.contextWindow === 'number' ? job.validation_result.contextWindow : undefined;

    // Server-measured context pressure for this build (both edit + new-build paths).
    let contextPressure: { tokens: number; window: number; ratio: number; truncated: boolean } | null = null;

    let result: GenerationResult;

    /*
     * Whether the generation phase already emitted a `file_written` event for
     * every file (with inline content). The orchestrator path does this via the
     * write_file tool as the agent works; the edit path (generateEdit) does NOT.
     *
     * When true, the R2 upload phase must NOT re-emit file_written — doing so
     * double-counts files ("16 files" for an 8-file app) and creates a second,
     * duplicate Builder activity group that never receives an agent_completed
     * event, so it stays stuck on "Running" and makes a finished build look
     * like it never ends.
     */
    let filesAnnouncedDuringGeneration = false;

    if (editJobId) {
      await updateJobProgress(supabase, job.id, 10, 'load_existing_files');
      await emitEvent(supabase, job.id, 'edit_started', 'Loading existing project files...');
      await recordStep(supabase, job.id, {
        type: 'plan',
        status: 'running',
        order: 1,
        inputSummary: `edit from job ${editJobId}`,
      });

      /*
       * projectId for the edit — same as the upload phase's projectId.
       * Defined here (not at the upload phase) because runOrchestratedBuild
       * needs it when called from the edit path.
       */
      const editProjectId = (job.validation_result as any)?.chatId ?? job.project_id ?? job.id;

      /* Fetch existing job metadata (appType) */
      const { data: editJob } = await supabase
        .from('build_jobs')
        .select('validation_result')
        .eq('id', editJobId)
        .eq('user_id', job.user_id)
        .single();

      const editAppType = (editJob?.validation_result?.appType as GenerationResult['appType']) ?? 'static';

      /*
       * Fetch the file manifest for the original job. The target job might
       * still be building (the front-end now blocks this via the Stop button,
       * but be defensive): if the manifest isn't there yet, poll a few times
       * before failing — an in-flight build will write it on completion. This
       * turns a hard failure into a graceful wait for the common race.
       */
      let manifest: Array<{ path: string; storage_key: string; mime_type: string | null }> | null = null;
      let manifestErr: unknown = null;
      /*
       * Poll for the manifest. The target job might still be building (the
       * user may have hit Stop on a prior build, then sent a new message —
       * the prior job continues to completion in the background). Wait up to
       * 5 min so a typical 3-4 min build finishes and the edit picks up its
       * files + worklog. If the target failed/cancelled or 5 min elapses,
       * fall back to a fresh build instead of failing — losing context is
       * worse than starting over.
       */
      const MANIFEST_POLL_MS = 5_000;
      const MANIFEST_POLL_MAX = 60; // 5 min total — covers a typical full build

      let targetFailed = false;

      for (let attempt = 0; attempt < MANIFEST_POLL_MAX; attempt++) {
        const { data, error } = await supabase
          .from('project_files_manifest')
          .select('path, storage_key, mime_type')
          .eq('job_id', editJobId)
          .order('path');

        manifest = data;
        manifestErr = error;

        if (!error && data && data.length > 0) {
          break;
        }

        // Manifest not ready — is the target job still building?
        const { data: targetJob } = await supabase
          .from('build_jobs')
          .select('status, error_summary')
          .eq('id', editJobId)
          .single();

        const targetStatus = targetJob?.status;
        const targetError = targetJob?.error_summary;

        /*
         * A cancelled job uses status='failed_clean' + error_summary='Cancelled
         * by user' (the DB CHECK constraint doesn't allow 'cancelled'). That's
         * NOT a real failure — the orchestrator wrote a partial manifest. So
         * only treat it as failed if error_summary is something else. If the
         * manifest is already there (partial), the loop above already broke;
         * if not yet, keep waiting — the partial manifest lands shortly after
         * the cancel.
         */
        if (targetStatus === 'failed_clean' && targetError !== 'Cancelled by user') {
          targetFailed = true;
          break;
        }

        if (attempt < MANIFEST_POLL_MAX - 1) {
          await emitEvent(
            supabase,
            job.id,
            'edit_progress',
            `Waiting for the previous build to finish… (${Math.round((attempt + 1) * 5)}s)`,
          );
          await new Promise((r) => setTimeout(r, MANIFEST_POLL_MS));
        }
      }

      if (manifestErr || !manifest || manifest.length === 0) {
        /*
         * The previous build didn't produce a manifest within 5 min (still
         * running, or failed/cancelled). Fail with a clear, actionable
         * message so the user knows to wait or start fresh.
         */
        const reason = targetFailed ? 'the previous build failed' : 'the previous build is still running after 5 min';
        await failJob(
          supabase,
          job.id,
          `Could not load the previous build's files (${reason}). Please wait for it to finish or start a new build.`,
        );
        return;
      }

      /*
       * Fetch file contents from R2 in PARALLEL (was sequential — 9 files ×
       * ~200ms = 1.8s wasted per edit). Promise.all cuts that to a single
       * round-trip's latency (~200ms for all files). Order is preserved by
       * mapping back to the manifest's row order.
       */
      const existingFiles: Array<{ op: 'write_file'; path: string; content: string; mime_type?: string }> = [];

      const contents = await Promise.all(
        manifest.map((row) => getFileText(row.storage_key).then((c) => ({ row, c }))),
      );

      for (const { row, c: content } of contents) {
        if (content !== null) {
          existingFiles.push({ op: 'write_file', path: row.path, content, mime_type: row.mime_type ?? undefined });
        }
      }

      if (existingFiles.length === 0) {
        await failJob(supabase, job.id, 'Failed to read project files from storage — try a new build instead');
        return;
      }

      await recordStep(supabase, job.id, {
        type: 'plan',
        status: 'completed',
        order: 1,
        outputSummary: `loaded ${existingFiles.length} files (${editAppType})`,
      });
      await emitEvent(
        supabase,
        job.id,
        'planning_completed',
        `Editing your project...`,
        { fileCount: existingFiles.length, appType: editAppType },
      );

      /* Generate edit (patch mode — LLM returns only changed files) */
      await updateJobProgress(supabase, job.id, 40, 'generate_edit');
      await emitEvent(supabase, job.id, 'file_generation_started', `Building your project...`);
      await recordStep(supabase, job.id, { type: 'generate_file', status: 'running', order: 2 });

      let mergedFiles: typeof existingFiles;

      /*
       * Edit heartbeat.
       *
       * Unlike the create path (which streams file_chunk events in real time),
       * generateEdit is ONE synchronous generateText call — so the UI sees no
       * progress for up to the full edit window and the chat looks frozen.
       * Emit a heartbeat every 25s so the front-end can show "still working…"
       * and the user knows the edit is in flight, not dead.
       */
      const editStart = Date.now();
      const heartbeat = setInterval(async () => {
        const elapsed = Math.round((Date.now() - editStart) / 1000);
        await emitEvent(
          supabase,
          job.id,
          'edit_progress',
          `Building…`,
          { elapsed },
        ).catch(() => undefined);
      }, 25_000);

      try {
        /*
         * Feed the project's full memory into the edit: worklog (recent
         * history) + .palmkit/ structured memory (project identity, design
         * decisions, manifest with importantFiles). The edit path was blind
         * to .palmkit/ before — edits contradicted earlier design decisions
         * and missed the project's entrypoints. Now the edit LLM sees the
         * same context the Planner sees on a fresh build.
         */
        const editProjectId = (job.validation_result as any)?.chatId ?? job.project_id ?? job.id;
        const editWorklog = await readWorklog(editProjectId).catch(() => null);

        const [projectMd, decisionsMd, manifestJson] = await Promise.all([
          readWorkspaceFile(editProjectId, '.palmkit/project.md').catch(() => null),
          readWorkspaceFile(editProjectId, '.palmkit/decisions.md').catch(() => null),
          readWorkspaceFile(editProjectId, 'manifest.json').catch(() => null),
        ]);

        const projectMemory =
          projectMd || decisionsMd || manifestJson
            ? { projectMd: projectMd ?? undefined, decisionsMd: decisionsMd ?? undefined, manifestJson: manifestJson ?? undefined }
            : null;

        const editReasoningEffort = job.validation_result?.reasoningEffort as 'off' | 'medium' | 'max' | undefined;

        /*
         * Stream callback — forward edit text deltas as 'edit_progress' events
         * so the UI shows the edit happening live (same as build streaming).
         * Throttle to avoid flooding Supabase: emit every ~500ms or on
         * meaningful chunks (line breaks).
         */
        let lastEmit = 0;
        let deltaBuffer = '';
        const streamCallback = async (delta: string) => {
          deltaBuffer += delta;
          const now = Date.now();

          if (now - lastEmit > 500 || deltaBuffer.includes('\n')) {
            const snippet = deltaBuffer.slice(-200);

            await emitEvent(supabase, job.id, 'edit_progress', `Editing… ${snippet}`, {
              delta: snippet,
            }).catch(() => undefined);
            lastEmit = now;
            deltaBuffer = '';
          }
        };

        const conversationHistory = job.validation_result?.conversationHistory as
          | Array<{ role: string; content: string }>
          | undefined;

        /*
         * Edit via agent loop (Builder agent with preloaded files).
         *
         * The old generateEdit was a single LLM call — no read_file, no
         * run_shell, no verify. Now we reuse runOrchestratedBuild in edit
         * mode: the Builder gets preloaded files + worklog + conversation
         * history, and can read_file to inspect, edit_file to modify,
         * run_shell to verify the build, and fix errors — a full agent
         * loop, same as a new build but starting from existing files.
         *
         * Planner + Researcher are skipped (edit mode). Tester still runs
         * to verify the edit didn't break the build.
         */
        const preloadFiles = existingFiles.map((f) => ({ path: f.path, content: f.content }));

        const editMaxTokens = job.validation_result?.maxCompletionTokens as number | undefined;

        const editAgentResult = await runOrchestratedBuild(
          prompt,
          model,
          job.id,
          supabase,
          editProjectId,
          job.user_id,
          editMaxTokens,
          editAppType,
          contextWindow,
          {
            agentModels,
            reasoningEffort: editReasoningEffort,
            media,
            skills,
            libraries,
            agentConfig,
            designScheme,
            preloadFiles,
            conversationHistory,
          },
        );

        mergedFiles = editAgentResult.files as typeof existingFiles;

        const win = contextWindow && contextWindow > 0 ? contextWindow : 128_000;
        contextPressure = {
          tokens: editAgentResult.contextTokens,
          window: win,
          ratio: win > 0 ? editAgentResult.contextTokens / win : 0,
          truncated: editAgentResult.truncated,
        };
      } catch (editErr: any) {
        await recordStep(supabase, job.id, {
          type: 'generate_file',
          status: 'failed',
          order: 2,
          error: editErr.message,
        });
        await emitEvent(supabase, job.id, 'job_failed', `Edit failed: ${editErr.message}`, { error: editErr.message });
        await failJob(supabase, job.id, `Edit generation failed: ${editErr.message}`);
        return;
      } finally {
        clearInterval(heartbeat);
      }

      await emitEvent(supabase, job.id, 'edit_completed', `Changes applied — ${mergedFiles.length} files in project`);
      await recordStep(supabase, job.id, {
        type: 'generate_file',
        status: 'completed',
        order: 2,
        outputSummary: `${mergedFiles.length} merged files (${editAppType})`,
      });

      result = { files: mergedFiles, complete: true, rawText: '', appType: editAppType };
      logger.info(`Job ${job.id}: edit complete → ${mergedFiles.length} files (${editAppType})`);
    } else {
      // ─── Phase 1: PLAN ─────────────────────────────────────────────────
      // The brain decides what to build — no hardcoded planning step.
      // planProject() was guessing appType from keywords and showing
      // "Planned 3 files (static)" which was wrong and confusing.
      // We still call planProject() to get maxCompletionTokens, but
      // we DON'T emit the planning events.
      await updateJobProgress(supabase, job.id, 10, 'plan');

      const spec = planProject(prompt);

      // Pass the model's maxCompletionTokens (from job metadata) into the spec so
      // the generator uses the model's actual limit instead of the old 16000 cap.
      if (job.validation_result?.maxCompletionTokens && typeof job.validation_result.maxCompletionTokens === 'number') {
        spec.maxCompletionTokens = job.validation_result.maxCompletionTokens;
      }

      logger.info(`Job ${job.id}: plan complete → ${spec.appType}, ${spec.files.length} files`);

      // ─── Phase 2: AGENTIC BUILD (streamText + tools) ───────────────────
      await updateJobProgress(supabase, job.id, 30, 'generate_files');
      await emitEvent(supabase, job.id, 'file_generation_started', `Building your project...`);
      await recordStep(supabase, job.id, { type: 'generate_file', status: 'running', order: 2 });

      /*
       * AGENTIC BUILD — gives the LLM tools and lets it work freely.
       *
       * This replaces the orchestrator/decomposer with a simpler, more
       * powerful approach: the LLM gets tools (write_file, read_file,
       * list_files, run_shell, done) and decides everything itself.
       *
       * This is EXACTLY how Super Z works:
       * - Gets the full prompt
       * - Uses Write, Read, Bash tools
       * - Decides what to do
       * - Works until done
       *
       * No JSON parsing, no XML format, no format constraints.
       * The LLM writes files directly and calls done() when finished.
       */
      try {
        /*
         * Use the chatId from validation_result as the projectId for the
         * agent-builder. This ensures the agent writes files to the SAME
         * workspace key that /api/workspace reads from.
         */
        const projectId = (job.validation_result as any)?.chatId ?? job.project_id ?? job.id;

        /*
         * CONTINUATION HYDRATION — for a project forked via /api/fork-chat, the
         * workspace (copied files + worklog + .palmkit/handoff.md) lives only in
         * Supabase Storage because the Cloudflare route has no R2 credentials.
         * Copy that mirror into R2 now so the orchestrator's normal continuation
         * path (worklog present → Researcher runs, read_file finds files, handoff
         * injected) works. No-op for normal new/edit builds.
         */
        try {
          const hydrated = await hydrateWorkspaceFromStorage(projectId, job.user_id, supabase);

          if (hydrated > 0) {
            await emitEvent(
              supabase,
              job.id,
              'file_chunk' as any,
              `📦 Restored ${hydrated} file(s) + project memory from the previous chat`,
              { continuation: true, hydrated },
            );
          }
        } catch (hydrateErr) {
          logger.warn(`Job ${job.id}: workspace hydration failed: ${hydrateErr}`);
        }

        /*
         * Use the Orchestrator (multi-agent system).
         * The Orchestrator runs: Researcher → Builder → Tester
         * Each agent gets only the tools it needs (permission model).
         *
         * NO LEGACY FALLBACK — the old generateStaticFiles (XML <palmkitArtifact>
         * parsing) was removed because:
         *   1. It doesn't emit reasoning / todos / agent_started events, so
         *      the new structured UI panels (Thought Process, Todos, Activity
         *      Stream) never render when it's used.
         *   2. It uses brittle XML parsing that truncates large files.
         *   3. It hides orchestrator bugs instead of surfacing them — the
         *      user sees "Generating... X chars" forever without knowing the
         *      orchestrator actually failed.
         *
         * Now if the orchestrator fails or produces 0 files, we fail the job
         * with a clear error message instead of silently falling back.
         */
        /*
         * Model Router (Design v2): the user can assign a model per role —
         * brain (planning/research), builder (code-writing agents), tester
         * (verification), vision (VLM for analyze_screenshot), media
         * (image + video generation). Each is instantiated on the same
         * provider/key as the main model; a missing role falls back to the
         * main model.
         *
         * RADICAL REBUILD: vision and media roles are now wired. The Builder
         * agent TALKS TO the vision model via analyze_screenshot (it sends a
         * screenshot and gets back a description), and to the media model
         * via generate_image/generate_video. The Builder doesn't need to be
         * the vision model itself — it just calls the tool.
         *
         * reasoningEffort tunes how hard reasoning models think (off/medium/max).
         */
        for (const roleName of ['brain', 'builder', 'tester', 'vision', 'media'] as const) {
          const id = roleIds[roleName];

          if (id && typeof id === 'string' && id !== modelName) {
            try {
              if (roleName === 'vision' || roleName === 'media') {
                // Vision and media models are NOT used as the main agent —
                // they're called via tools. Store them in agentModels so
                // createAgentTools can pass them to the VLM/video-gen
                // wrappers. We don't add them to the brain/builder/tester
                // loop.
                agentModels[roleName as 'brain' | 'builder' | 'tester'] = getModelInstance(providerName, id, apiKey) as any;
                logger.info(`Job ${job.id}: model router — ${roleName} → ${id} (tool model)`);
              } else {
                agentModels[roleName] = getModelInstance(providerName, id, apiKey);
                logger.info(`Job ${job.id}: model router — ${roleName} → ${id}`);
              }
            } catch (e) {
              logger.warn(`Job ${job.id}: model router — failed to init ${roleName}=${id}: ${e}`);
            }
          }
        }

        const reasoningEffort = job.validation_result?.reasoningEffort as 'off' | 'medium' | 'max' | undefined;

        // Also pass conversation history for new builds — the brain needs context
        // from prior messages to understand references like "make it blue instead"
        const newBuildConversationHistory = job.validation_result?.conversationHistory as
          | Array<{ role: string; content: string }>
          | undefined;

        const agentResult = await runOrchestratedBuild(
          prompt,
          model,
          job.id,
          supabase,
          projectId,
          job.user_id,
          spec.maxCompletionTokens,
          spec.appType,
          contextWindow,
          { agentModels, reasoningEffort, media, skills, libraries, agentConfig, designScheme, conversationHistory: newBuildConversationHistory },
        );

        // Capture the server-measured context pressure for the fork nudge.
        contextPressure = {
          tokens: agentResult.contextTokens,
          window: agentResult.contextWindow,
          ratio: agentResult.contextRatio,
          truncated: agentResult.truncated,
        };

        if (agentResult.success && agentResult.files.length > 0) {
          result = {
            files: agentResult.files,
            complete: true,
            rawText: agentResult.rawText,
            appType: spec.appType,
          };

          /*
           * Refine the app type from the files the model ACTUALLY produced.
           * planProject's prompt-keyword guess is often wrong for anything off
           * the beaten path (a canvas game, a less common framework, a TS/JS
           * mismatch). The generated package.json + entry files are the source
           * of truth, and this drives the correct preview runtime + build check.
           */
          const filesRecord: Record<string, string> = {};
          for (const f of agentResult.files) {
            filesRecord[f.path] = (f.content as string) ?? '';
          }
          const detectedAppType = detectAppTypeFromFiles(filesRecord);

          if (detectedAppType && detectedAppType !== result.appType) {
            logger.info(`Job ${job.id}: appType refined ${result.appType} → ${detectedAppType} (from generated files)`);
            result.appType = detectedAppType;

            // Emit the corrected appType so the frontend's auto-launch
            // (use-worker-sandbox.ts) picks it up. Without this, the frontend
            // keeps the old appType from planProject (e.g., 'static') and
            // never auto-launches the E2B sandbox for React apps.
            await emitEvent(supabase, job.id, 'file_chunk' as any, `Detected: ${detectedAppType} app`, {
              kind: 'appType_refined',
              appType: detectedAppType,
            });
          }

          /*
           * The orchestrator already emitted a file_written event (with inline
           * content) for every file as the Builder wrote it. Mark that so the
           * upload phase below does NOT re-emit them as duplicates.
           */
          filesAnnouncedDuringGeneration = true;

          logger.info(
            `Job ${job.id}: agent build complete → ${agentResult.files.length} files (${agentResult.totalDuration}ms)`,
          );
        } else {
          /*
           * Orchestrator produced 0 files — fail cleanly with an actionable
           * error message instead of silently falling back to the legacy
           * generator.
           *
           * Common causes:
           *   - Builder hit maxSteps without calling done() (need higher limit
           *     or better prompt)
           *   - edit_file/write_file type validation failed (model sent wrong
           *     arg types — should be handled by the runtime coercion in the
           *     tool's execute() function)
           *   - LLM provider returned an error (rate limit, model unavailable)
           *
           * The user sees this error in the UI and can retry. Much better
           * than the silent fallback that produced broken legacy output.
           */
          const agentSummaries = agentResult.agentResults
            .map(
              (a) =>
                `${a.role}: ${a.success ? 'ok' : 'failed'} (${a.text.length} chars, ${Math.round(a.duration / 1000)}s)`,
            )
            .join('; ');

          const errorMsg =
            `Build did not produce any files. Agent results: ${agentSummaries}. ` +
            `This usually means the LLM hit the step limit without calling done(), or a tool call failed validation. ` +
            `Please try again — the model may succeed on retry.`;

          logger.error(`Job ${job.id}: orchestrator produced 0 files. ${agentSummaries}`);
          await emitEvent(supabase, job.id, 'job_failed', errorMsg);
          await failJob(supabase, job.id, errorMsg);
          return;
        }
      } catch (agentErr: any) {
        /*
         * Orchestrator threw an exception — fail cleanly with the actual error
         * message. No legacy fallback.
         */
        const errMsg = agentErr.message ?? String(agentErr);
        logger.error(`Job ${job.id}: orchestrator failed: ${errMsg}`);
        await emitEvent(supabase, job.id, 'job_failed', `Build failed: ${errMsg}`);
        await failJob(supabase, job.id, `Build failed: ${errMsg}`);
        return;
      }

      await emitEvent(
        supabase,
        job.id,
        'file_generation_completed',
        `Build complete`,
      );

      await recordStep(supabase, job.id, {
        type: 'generate_file',
        status: 'completed',
        order: 2,
        outputSummary: `${result.files.length} files (${result.appType}), ${result.rawText.length} chars`,
      });

      logger.info(`Job ${job.id}: generation complete → ${result.files.length} files (${result.appType})`);
    }

    // Initialise the correct runner for this app type.
    const runner = createRunner(result.appType);

    // ─── Phase 3: VALIDATION (skipped — the orchestrator handles verification) ─
    await updateJobProgress(supabase, job.id, 50, 'validate');
    await emitEvent(supabase, job.id, 'validation_passed', 'Build verified');
    logger.info(`Job ${job.id}: build verified`);

    // ─── Phase 4: UPLOAD TO R2 ─────────────────────────────────────────
    await updateJobProgress(supabase, job.id, 70, 'uploading_snapshot');
    await emitEvent(supabase, job.id, 'upload_started', 'Finalizing your project...');
    await recordStep(supabase, job.id, { type: 'finalize', status: 'running', order: 4 });

    /*
     * Use the chatId from validation_result as the project ID for workspace
     * keying. This links the R2 workspace to the IndexedDB chat, so
     * /api/workspace can find files by chatId.
     *
     * Fall back to job.id if chatId is not set (older jobs).
     */
    const chatId = (job.validation_result as any)?.chatId as string | undefined;
    const projectId = chatId ?? job.project_id ?? job.id;
    const manifestEntries: Array<Record<string, unknown>> = [];

    for (const file of result.files) {
      // Write to BOTH the workspace key (new unified location) AND the
      // job-scoped key (backward compat for /api/files that still reads it).
      // Once /api/files is migrated to read from workspace, the job-scoped
      // write can be removed.
      const workspaceKey = buildWorkspaceKey(projectId, file.path);
      const legacyKey = buildKey(job.id, file.path, job.project_id ?? undefined);
      const content = file.content;
      const hash = createHash('sha256').update(content).digest('hex');
      const sizeBytes = new TextEncoder().encode(content).length;
      const lineCount = content.split('\n').length;

      // Upload to R2 workspace (primary storage — new).
      try {
        await putFile(workspaceKey, content);
        logger.debug(`R2 workspace upload OK: ${workspaceKey} (${sizeBytes} bytes)`);
      } catch (uploadError: any) {
        logger.warn(`R2 workspace upload failed for ${workspaceKey}: ${uploadError?.message || uploadError}`);
        // Non-fatal — the legacy upload below may still succeed
      }

      // Upload to R2 job-scoped (legacy — for backward compat with /api/files).
      try {
        await putFile(legacyKey, content);
        logger.debug(`R2 legacy upload OK: ${legacyKey} (${sizeBytes} bytes)`);
      } catch (uploadError: any) {
        await recordStep(supabase, job.id, {
          type: 'finalize',
          status: 'failed',
          order: 4,
          error: `R2 upload failed for ${file.path}: ${uploadError.message}`,
        });
        await emitEvent(supabase, job.id, 'job_failed', `Upload failed for ${file.path}: ${uploadError.message}`);
        await failJob(supabase, job.id, `R2 upload failed for ${file.path}: ${uploadError.message}`);
        return;
      }

      /*
       * Emit a file_written event ONLY if the generation phase didn't already
       * announce this file (i.e. the edit path). For the orchestrator path the
       * agent already emitted file_written per file with inline content, so
       * re-emitting here would double-count and spawn a duplicate "Running"
       * activity group. See filesAnnouncedDuringGeneration above.
       */
      if (!filesAnnouncedDuringGeneration) {
        await emitFileWritten(supabase, job.id, file.path, lineCount, sizeBytes);
      }

      // Mirror to Supabase Storage (read-through cache for the browser).
      // Mirror BOTH the legacy key AND the workspace key so /api/workspace
      // can read files by chatId.
      const sbLegacyKey = `${job.user_id}/${legacyKey}`;
      const sbWorkspaceKey = `${job.user_id}/${workspaceKey}`;

      try {
        // Mirror workspace key (new — for /api/workspace)
        const { error: sbWsError } = await supabase.storage.from('palmkit-files').upload(sbWorkspaceKey, content, {
          contentType: file.mime_type ?? 'text/plain',
          upsert: true,
        });

        if (sbWsError) {
          logger.warn(`Supabase Storage workspace mirror failed for ${file.path}: ${sbWsError.message} (non-fatal)`);
        }

        // Mirror legacy key (for /api/files backward compat)
        const { error: sbUploadError } = await supabase.storage.from('palmkit-files').upload(sbLegacyKey, content, {
          contentType: file.mime_type ?? 'text/plain',
          upsert: true,
        });

        if (sbUploadError) {
          logger.warn(`Supabase Storage legacy mirror failed for ${file.path}: ${sbUploadError.message} (non-fatal)`);
        }
      } catch (sbErr: any) {
        logger.warn(`Supabase Storage mirror exception for ${file.path}: ${sbErr.message} (non-fatal)`);
      }

      // Record manifest entry (metadata only — no content in DB).
      manifestEntries.push({
        job_id: job.id,
        project_id: job.project_id,
        user_id: job.user_id,
        path: file.path,
        version: 1,
        hash,
        size_bytes: sizeBytes,
        mime_type: file.mime_type ?? 'text/plain',
        storage_provider: 'r2',
        storage_key: workspaceKey,
        integrity: 'complete',
      });
    }

    /*
     * Insert manifest entries. A cancelled-then-resumed job may have partial
     * rows (integrity='partial') from finalizePartial() in the orchestrator.
     * Delete any existing rows for this job first, then insert the complete
     * set — cleanest way to avoid the unique constraint violation without
     * relying on ON CONFLICT (the constraint name isn't reliably inferable).
     */
    await supabase.from('project_files_manifest').delete().eq('job_id', job.id);

    const { error: manifestError } = await supabase.from('project_files_manifest').insert(manifestEntries);

    if (manifestError) {
      await recordStep(supabase, job.id, {
        type: 'finalize',
        status: 'failed',
        order: 4,
        error: `Manifest insert failed: ${manifestError.message}`,
      });
      await failJob(supabase, job.id, `Manifest insert failed: ${manifestError.message}`);
      return;
    }

    await recordStep(supabase, job.id, {
      type: 'finalize',
      status: 'completed',
      order: 4,
      outputSummary: `${manifestEntries.length} files uploaded to R2 + manifest`,
    });

    logger.info(`Job ${job.id}: upload complete → ${manifestEntries.length} files in R2`);

    // ─── Phase 5: FINALIZE ─────────────────────────────────────────────
    const { error: finalizeError } = await supabase
      .from('build_jobs')
      .update({
        status: 'ready_for_preview',
        current_step: 'done',
        progress: 100,
        has_completion_marker: true,
        validation_result: {
          ...job.validation_result,
          fileCount: result.files.length,
          completeness: 'complete',
          appType: result.appType,
          runtimeMode: runner.runtimeMode,
          prompt: (job.validation_result?.prompt ?? prompt).slice(0, 200),
          ...(editJobId ? { editJobId } : {}),
          ...(contextPressure ? { contextPressure } : {}),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (finalizeError) {
      throw new Error(`Failed to finalize job: ${finalizeError.message}`);
    }

    await emitEvent(supabase, job.id, 'snapshot_uploaded', `Project ready`, {
      fileCount: manifestEntries.length,
    });
    await emitEvent(supabase, job.id, 'ready_for_preview', 'Preview ready');

    logger.info(`Job ${job.id} → ready_for_preview ✅`);
  } catch (err: any) {
    await emitEvent(supabase, job.id, 'job_failed', `Job failed: ${err.message}`, { error: err.message });
    await failJob(supabase, job.id, err.message ?? 'Unknown error');
  }
}
