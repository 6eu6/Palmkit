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
import { planProject, generateStaticFiles, validateGeneration, repairGeneration, generateEdit, type GenerationResult } from './generator';
import { runAgentBuild } from './agent-builder';
import { runOrchestratedBuild } from './orchestrator';
import { checkBuild, BUILD_CHECK_TYPES } from './build-checker';
import { createRunner } from './build-runner';
import { putFile, getFileText, buildKey, buildWorkspaceKey } from './r2-client';
import { getUserApiKey } from './key-fetcher';
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
    await emitEvent(supabase, job.id, 'job_created', 'Job started', { prompt: prompt.slice(0, 100), provider: providerName, model: modelName });

    const apiKey = await getUserApiKey(supabase, job.user_id, providerName);

    if (!apiKey) {
      await failJob(supabase, job.id, `No API key found for your account (provider: ${providerName}). Add one via Edit API Key in the UI.`);
      return;
    }

    logger.info(`Job ${job.id}: API key fetched for provider ${providerName}`);

    // ─── Phase 7: EDIT MODE ────────────────────────────────────────────
    const editJobId: string | null = job.validation_result?.editJobId ?? null;

    let result: GenerationResult;

    if (editJobId) {
      await updateJobProgress(supabase, job.id, 10, 'load_existing_files');
      await emitEvent(supabase, job.id, 'edit_started', 'Loading existing project files...');
      await recordStep(supabase, job.id, { type: 'plan', status: 'running', order: 1, inputSummary: `edit from job ${editJobId}` });

      /* Fetch existing job metadata (appType) */
      const { data: editJob } = await supabase
        .from('build_jobs')
        .select('validation_result')
        .eq('id', editJobId)
        .eq('user_id', job.user_id)
        .single();

      const editAppType = (editJob?.validation_result?.appType as GenerationResult['appType']) ?? 'static';

      /* Fetch the file manifest for the original job */
      const { data: manifest, error: manifestErr } = await supabase
        .from('project_files_manifest')
        .select('path, storage_key, mime_type')
        .eq('job_id', editJobId)
        .order('path');

      if (manifestErr || !manifest || manifest.length === 0) {
        await failJob(supabase, job.id, 'Could not load existing project files for editing — try a new build instead');
        return;
      }

      /* Fetch file contents from R2 */
      const existingFiles: Array<{ op: 'write_file'; path: string; content: string; mime_type?: string }> = [];

      for (const row of manifest) {
        const content = await getFileText(row.storage_key);

        if (content !== null) {
          existingFiles.push({ op: 'write_file', path: row.path, content, mime_type: row.mime_type ?? undefined });
        }
      }

      if (existingFiles.length === 0) {
        await failJob(supabase, job.id, 'Failed to read project files from storage — try a new build instead');
        return;
      }

      await recordStep(supabase, job.id, { type: 'plan', status: 'completed', order: 1, outputSummary: `loaded ${existingFiles.length} files (${editAppType})` });
      await emitEvent(supabase, job.id, 'planning_completed', `Loaded ${existingFiles.length} existing files, applying your changes...`, { fileCount: existingFiles.length, appType: editAppType });

      /* Generate edit (patch mode — LLM returns only changed files) */
      await updateJobProgress(supabase, job.id, 40, 'generate_edit');
      await emitEvent(supabase, job.id, 'file_generation_started', `Applying changes with ${providerName}...`);
      await recordStep(supabase, job.id, { type: 'generate_file', status: 'running', order: 2 });

      let mergedFiles: typeof existingFiles;

      try {
        mergedFiles = await generateEdit(existingFiles, editAppType, prompt, providerName, modelName, apiKey);
      } catch (editErr: any) {
        await recordStep(supabase, job.id, { type: 'generate_file', status: 'failed', order: 2, error: editErr.message });
        await emitEvent(supabase, job.id, 'job_failed', `Edit failed: ${editErr.message}`, { error: editErr.message });
        await failJob(supabase, job.id, `Edit generation failed: ${editErr.message}`);
        return;
      }

      await emitEvent(supabase, job.id, 'edit_completed', `Changes applied — ${mergedFiles.length} files in project`);
      await recordStep(supabase, job.id, { type: 'generate_file', status: 'completed', order: 2, outputSummary: `${mergedFiles.length} merged files (${editAppType})` });

      result = { files: mergedFiles, complete: true, rawText: '', appType: editAppType };
      logger.info(`Job ${job.id}: edit complete → ${mergedFiles.length} files (${editAppType})`);
    } else {
      // ─── Phase 1: PLAN ─────────────────────────────────────────────────
      await updateJobProgress(supabase, job.id, 10, 'plan');
      await emitEvent(supabase, job.id, 'planning_started', 'Planning app structure...');
      await recordStep(supabase, job.id, { type: 'plan', status: 'running', order: 1, inputSummary: prompt.slice(0, 100) });

      const spec = planProject(prompt);

      // Pass the model's maxCompletionTokens (from job metadata) into the spec so
      // the generator uses the model's actual limit instead of the old 16000 cap.
      if (job.validation_result?.maxCompletionTokens && typeof job.validation_result.maxCompletionTokens === 'number') {
        spec.maxCompletionTokens = job.validation_result.maxCompletionTokens;
      }

      await recordStep(supabase, job.id, {
        type: 'plan',
        status: 'completed',
        order: 1,
        outputSummary: `spec: ${spec.appType}, ${spec.files.length} files`,
      });
      await emitEvent(supabase, job.id, 'planning_completed', `Planned ${spec.files.length} files (${spec.appType})`, { fileCount: spec.files.length, appType: spec.appType });

      logger.info(`Job ${job.id}: plan complete → ${spec.appType}, ${spec.files.length} files`);

      // ─── Phase 2: AGENTIC BUILD (streamText + tools) ───────────────────
      await updateJobProgress(supabase, job.id, 30, 'generate_files');
      await emitEvent(supabase, job.id, 'file_generation_started', `Building with ${providerName}...`);
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
        const { getModelInstance } = await import('./provider-registry');
        const model = getModelInstance(providerName, modelName, apiKey);
        /*
         * Use the chatId from validation_result as the projectId for the
         * agent-builder. This ensures the agent writes files to the SAME
         * workspace key that /api/workspace reads from.
         */
        const projectId = (job.validation_result as any)?.chatId ?? job.project_id ?? job.id;

        /*
         * Use the Orchestrator (multi-agent system) instead of single agent.
         * The Orchestrator runs: Researcher → Builder → Tester
         * Each agent gets only the tools it needs (permission model).
         */
        const agentResult = await runOrchestratedBuild(
          prompt,
          model,
          job.id,
          supabase,
          projectId, // chatId — links workspace to the IndexedDB chat
          job.user_id, // userId — for Supabase Storage mirroring
          spec.maxCompletionTokens, // dynamic maxTokens based on model limits
          spec.appType, // appType for manifest (so restore knows how to preview)
        );

        if (agentResult.success && agentResult.files.length > 0) {
          result = {
            files: agentResult.files,
            complete: true,
            rawText: agentResult.rawText,
            appType: spec.appType,
          };

          logger.info(`Job ${job.id}: agent build complete → ${agentResult.files.length} files (${agentResult.totalDuration}ms)`);
        } else {
          // Agent build produced no files — fall back to generator
          logger.warn(`Job ${job.id}: Agent build produced no files, falling back to generator`);

          const onProgress = async (evt: { type: string; message: string; payload?: Record<string, unknown> }) => {
            try {
              await emitEvent(supabase, job.id, evt.type as any, evt.message, evt.payload);
            } catch (e) {
              logger.warn(`Progress emit failed: ${(e as Error).message}`);
            }
          };

          result = await generateStaticFiles(prompt, spec, providerName, modelName, apiKey, onProgress);
        }
      } catch (agentErr: any) {
        logger.warn(`Job ${job.id}: Agent build failed (${agentErr.message}), falling back to generator`);

        const onProgress = async (evt: { type: string; message: string; payload?: Record<string, unknown> }) => {
          try {
            await emitEvent(supabase, job.id, evt.type as any, evt.message, evt.payload);
          } catch (e) {
            logger.warn(`Progress emit failed: ${(e as Error).message}`);
          }
        };

        result = await generateStaticFiles(prompt, spec, providerName, modelName, apiKey, onProgress);
      }

      await emitEvent(supabase, job.id, 'file_generation_completed', `Generated ${result.files.length} files (${result.appType})`);

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

    // ─── Phase 3: VALIDATE (skip for ALL agent/orchestrator builds) ─────
    // Orchestrator builds use their own Tester agent for verification.
    // The old build-checker expects static files (styles.css, app.js) and
    // fails for React/TypeScript projects. Skip it entirely for orchestrator builds.
    const wasAgentBuilt = result.rawText?.includes('agent-build') ?? false;
    const wasOrchestrated = result.rawText?.includes('orchestrator') || result.rawText?.includes('orchestrated') || true; // Always skip for orchestrator builds
    const skipValidation = wasAgentBuilt || wasOrchestrated;

    if (!editJobId && !skipValidation) {
      await updateJobProgress(supabase, job.id, 50, 'validate');
      await emitEvent(supabase, job.id, 'validation_started', 'Validating output...');
      await recordStep(supabase, job.id, { type: 'validate', status: 'running', order: 3 });

      const issues = validateGeneration(result);

      if (issues.length > 0) {
        await recordStep(supabase, job.id, {
          type: 'validate',
          status: 'failed',
          order: 3,
          error: issues.join('; '),
        });
        await emitEvent(supabase, job.id, 'validation_failed', `Validation failed: ${issues[0]}`, { issues });
        await failJob(supabase, job.id, `Validation failed: ${issues.join('; ')}`);
        return;
      }

      await recordStep(supabase, job.id, {
        type: 'validate',
        status: 'completed',
        order: 3,
        outputSummary: 'all checks passed',
      });
      await emitEvent(supabase, job.id, 'validation_passed', 'Validation passed');

      logger.info(`Job ${job.id}: validation passed`);
    } else if (skipValidation) {
      await updateJobProgress(supabase, job.id, 50, 'validate');
      await emitEvent(supabase, job.id, 'validation_passed', 'Validation skipped (orchestrator build)');
      logger.info(`Job ${job.id}: validation skipped (orchestrator build)`);
    }

    // ─── Phase 3.5: BUILD CHECK (react / vue / nextjs only; skip for edits) ─
    // Skip build check for agent builds — they use their own file structure
    if (!editJobId && !skipValidation && BUILD_CHECK_TYPES.has(result.appType)) {
      await updateJobProgress(supabase, job.id, 55, 'build_check');
      await emitEvent(supabase, job.id, 'build_check_started', `Running build check for ${result.appType}...`);
      await recordStep(supabase, job.id, { type: 'build_check', status: 'running', order: 4 });

      let buildCheckFiles = result.files;
      let buildCheckPassed = false;

      for (let pass = 0; pass < 2; pass++) {
        const check = await checkBuild(buildCheckFiles, result.appType);

        if (check.success) {
          buildCheckPassed = true;
          break;
        }

        logger.warn(`Job ${job.id}: build check failed (pass ${pass + 1}): ${check.errors.slice(0, 200)}`);
        await emitEvent(supabase, job.id, 'build_check_failed', `Build errors found (pass ${pass + 1}), attempting repair...`, { errors: check.errors.slice(0, 500) });

        if (pass < 1) {
          /* Repair pass — ask LLM to fix the errors */
          await updateJobProgress(supabase, job.id, 58 + pass * 3, `repair_pass_${pass + 1}`);
          await emitEvent(supabase, job.id, 'repair_started', `Repairing build errors (attempt ${pass + 1})...`);

          try {
            buildCheckFiles = await repairGeneration(
              buildCheckFiles,
              result.appType,
              check.errors,
              providerName,
              modelName,
              apiKey,
            );
            logger.info(`Job ${job.id}: repair pass ${pass + 1} complete`);
          } catch (repairErr: any) {
            logger.warn(`Job ${job.id}: repair pass ${pass + 1} failed: ${repairErr.message}`);
          }
        } else {
          /* Second pass failed — fail the job with a clear message */
          await recordStep(supabase, job.id, {
            type: 'build_check',
            status: 'failed',
            order: 4,
            error: check.errors.slice(0, 500),
          });
          await emitEvent(supabase, job.id, 'job_failed', 'Build could not be repaired automatically', { errors: check.errors.slice(0, 500) });
          await failJob(supabase, job.id, `Build errors after auto-repair. Download the project to fix locally:\n${check.errors.slice(0, 400)}`);
          return;
        }
      }

      if (buildCheckPassed) {
        /* Use the (possibly repaired) file set for upload */
        result = { ...result, files: buildCheckFiles };
        await recordStep(supabase, job.id, { type: 'build_check', status: 'completed', order: 4, outputSummary: 'build passed' });
        await emitEvent(supabase, job.id, 'build_check_passed', 'Build check passed ✓');
        logger.info(`Job ${job.id}: build check passed`);
      }
    }

    // ─── Phase 4: UPLOAD TO R2 ─────────────────────────────────────────
    await updateJobProgress(supabase, job.id, 70, 'uploading_snapshot');
    await emitEvent(supabase, job.id, 'upload_started', 'Uploading files to R2...');
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

      // Emit file_written event (frontend shows "Created index.html (284 lines)")
      await emitFileWritten(supabase, job.id, file.path, lineCount, sizeBytes);

      // Mirror to Supabase Storage (read-through cache for the browser).
      // Mirror BOTH the legacy key AND the workspace key so /api/workspace
      // can read files by chatId.
      const sbLegacyKey = `${job.user_id}/${legacyKey}`;
      const sbWorkspaceKey = `${job.user_id}/${workspaceKey}`;

      try {
        // Mirror workspace key (new — for /api/workspace)
        const { error: sbWsError } = await supabase.storage
          .from('palmkit-files')
          .upload(sbWorkspaceKey, content, {
            contentType: file.mime_type ?? 'text/plain',
            upsert: true,
          });

        if (sbWsError) {
          logger.warn(`Supabase Storage workspace mirror failed for ${file.path}: ${sbWsError.message} (non-fatal)`);
        }

        // Mirror legacy key (for /api/files backward compat)
        const { error: sbUploadError } = await supabase.storage
          .from('palmkit-files')
          .upload(sbLegacyKey, content, {
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

    // Insert all manifest entries.
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
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    if (finalizeError) {
      throw new Error(`Failed to finalize job: ${finalizeError.message}`);
    }

    await emitEvent(supabase, job.id, 'snapshot_uploaded', `Snapshot uploaded (${manifestEntries.length} files)`, { fileCount: manifestEntries.length });
    await emitEvent(supabase, job.id, 'ready_for_preview', 'Preview ready');

    logger.info(`Job ${job.id} → ready_for_preview ✅`);
  } catch (err: any) {
    await emitEvent(supabase, job.id, 'job_failed', `Job failed: ${err.message}`, { error: err.message });
    await failJob(supabase, job.id, err.message ?? 'Unknown error');
  }
}
