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
import { planProject, generateStaticFiles, validateGeneration, repairGeneration, type GenerationResult } from './generator';
import { checkBuild, BUILD_CHECK_TYPES } from './build-checker';
import { createRunner } from './build-runner';
import { putFile, buildKey } from './r2-client';
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
  const prompt: string = job.validation_result?.prompt ?? '';
  const providerName: string = job.validation_result?.provider ?? 'OpenRouter';
  const modelName: string = job.validation_result?.model ?? 'deepseek/deepseek-chat-v3.1';

  if (!prompt) {
    await failJob(supabase, job.id, 'No prompt found in job metadata');
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

    // ─── Phase 1: PLAN ─────────────────────────────────────────────────
    await updateJobProgress(supabase, job.id, 10, 'plan');
    await emitEvent(supabase, job.id, 'planning_started', 'Planning app structure...');
    await recordStep(supabase, job.id, { type: 'plan', status: 'running', order: 1, inputSummary: prompt.slice(0, 100) });

    const spec = planProject(prompt);

    await recordStep(supabase, job.id, {
      type: 'plan',
      status: 'completed',
      order: 1,
      outputSummary: `spec: ${spec.appType}, ${spec.files.length} files`,
    });
    await emitEvent(supabase, job.id, 'planning_completed', `Planned ${spec.files.length} files (${spec.appType})`, { fileCount: spec.files.length, appType: spec.appType });

    logger.info(`Job ${job.id}: plan complete → ${spec.appType}, ${spec.files.length} files`);

    // ─── Phase 2: GENERATE ─────────────────────────────────────────────
    await updateJobProgress(supabase, job.id, 30, 'generate_files');
    await emitEvent(supabase, job.id, 'file_generation_started', `Generating files with ${providerName}...`);
    await recordStep(supabase, job.id, { type: 'generate_file', status: 'running', order: 2 });

    let result: GenerationResult;

    try {
      result = await generateStaticFiles(prompt, spec, providerName, modelName, apiKey);
    } catch (genError: any) {
      await recordStep(supabase, job.id, {
        type: 'generate_file',
        status: 'failed',
        order: 2,
        error: genError.message,
      });
      await emitEvent(supabase, job.id, 'job_failed', `Generation failed: ${genError.message}`, { error: genError.message });
      await failJob(supabase, job.id, `Generation failed (${providerName}/${modelName}): ${genError.message}`);
      return;
    }

    await emitEvent(supabase, job.id, 'file_generation_completed', `Generated ${result.files.length} files (${result.appType})`);

    await recordStep(supabase, job.id, {
      type: 'generate_file',
      status: 'completed',
      order: 2,
      outputSummary: `${result.files.length} files (${result.appType}), ${result.rawText.length} chars`,
    });

    logger.info(`Job ${job.id}: generation complete → ${result.files.length} files (${result.appType})`);

    // Initialise the correct runner for this app type.
    const runner = createRunner(result.appType);

    // ─── Phase 3: VALIDATE ─────────────────────────────────────────────
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

    // ─── Phase 3.5: BUILD CHECK (react / vue / nextjs only) ───────────
    if (BUILD_CHECK_TYPES.has(result.appType)) {
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

    const projectId = job.project_id ?? job.id; // use jobId as projectId if no project yet
    const manifestEntries: Array<Record<string, unknown>> = [];

    for (const file of result.files) {
      const r2Key = buildKey(job.id, file.path, job.project_id ?? undefined);
      const content = file.content;
      const hash = createHash('sha256').update(content).digest('hex');
      const sizeBytes = new TextEncoder().encode(content).length;
      const lineCount = content.split('\n').length;

      // Upload to R2 (primary storage).
      try {
        await putFile(r2Key, content);
        logger.debug(`R2 upload OK: ${r2Key} (${sizeBytes} bytes)`);
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
      const sbKey = `${job.user_id}/${r2Key}`;

      try {
        const { error: sbUploadError } = await supabase.storage
          .from('palmkit-files')
          .upload(sbKey, content, {
            contentType: file.mime_type ?? 'text/plain',
            upsert: true,
          });

        if (sbUploadError) {
          logger.warn(`Supabase Storage mirror failed for ${file.path}: ${sbUploadError.message} (non-fatal, R2 has the copy)`);
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
        storage_key: r2Key,
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
          /* Phase 6: preserve prompt snippet for build history display */
          prompt: (job.validation_result?.prompt ?? prompt).slice(0, 200),
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
