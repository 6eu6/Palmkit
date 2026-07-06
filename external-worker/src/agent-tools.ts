/**
 * Agent Tools — The core of Palmkit's agentic architecture
 *
 * These tools give the LLM the SAME capabilities as Super Z's CLI:
 * - write_file: Write a file directly to R2 (like Super Z's Write tool)
 * - read_file: Read a file from R2 (like Super Z's Read tool)
 * - list_files: List all files in the project (like Super Z's LS/Glob)
 * - run_shell: Run a shell command in E2B sandbox (like Super Z's Bash)
 * - done: Signal that the build is complete (like Super Z's final response)
 *
 * KEY DESIGN PRINCIPLES (matching Super Z's pattern):
 * 1. NO format constraints — LLM writes files directly, no XML/JSON wrappers
 * 2. LLM decides everything — how many files, what order, when to verify
 * 3. LLM can verify its own work — read_file after write_file
 * 4. LLM can fix issues — write_file again to overwrite, no regeneration
 * 5. Progress is tracked via events — user sees real-time updates
 *
 * This replaces:
 * - build-orchestrator.ts (forced JSON planning — caused parse errors)
 * - task-decomposer.ts (forced JSON decomposition — caused failures)
 * - The <palmkitArtifact> XML format (forced XML — caused truncation)
 *
 * The LLM now works EXACTLY like Super Z:
 *   "I'll create the HTML shell first." → write_file("index.html", "...")
 *   "Let me verify it looks right." → read_file("index.html")
 *   "Now I'll add the CSS." → write_file("index.html", "...updated...")
 *   "Let me check if it builds." → run_shell("npm run build")
 *   "Everything looks good." → done()
 */

import { tool } from 'ai';
import { z } from 'zod';
import { putFile, getFileText, buildWorkspaceKey } from './r2-client';
import { logger } from './logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emitEvent } from './event-emitter';
import { runInE2B } from './e2b-runner';
import { generateImage, DEFAULT_IMAGE_MODEL } from './image-gen';

/**
 * Max file-content size inlined into a file_written event. Files at/under this
 * stream to the client via Realtime (the reliable delivery path everything
 * depends on); larger files fall back to a workspace fetch. 300KB covers our
 * compressed image-asset modules and stays well under Supabase Realtime's ~1MB
 * message limit.
 */
const MAX_INLINE_CONTENT = 300 * 1024;

/** Media config for generate_image — the OpenRouter key + the image model. */
export interface MediaConfig {
  apiKey: string;
  model: string;
}

/*
 * Per-JOB in-memory file stores. Files are also written to R2 (workspace) for
 * persistence.
 *
 * CRITICAL: this MUST be keyed by jobId. It used to be a single module-level
 * Map shared by every build the long-running worker processed. When two builds
 * ran concurrently they wrote into the SAME map, so one user's files leaked
 * into another user's project (observed: a "restaurant website" build's pages
 * appearing inside an unrelated Lithos hero-section build) and produced broken
 * output with duplicate entry points (App.jsx + App.tsx, main.jsx + main.tsx).
 * Scoping the map per job fully isolates concurrent builds.
 */
const jobFileMaps = new Map<string, Map<string, string>>();

function getJobFiles(jobId: string): Map<string, string> {
  let m = jobFileMaps.get(jobId);

  if (!m) {
    m = new Map<string, string>();
    jobFileMaps.set(jobId, m);
  }

  return m;
}

/** Per-job count of write_file calls per path — used to nudge a looping model. */
const jobWriteCounts = new Map<string, Map<string, number>>();

function bumpWriteCount(jobId: string, path: string): number {
  let m = jobWriteCounts.get(jobId);

  if (!m) {
    m = new Map<string, number>();
    jobWriteCounts.set(jobId, m);
  }

  const n = (m.get(path) ?? 0) + 1;
  m.set(path, n);

  return n;
}

function getWriteCount(jobId: string, path: string): number {
  return jobWriteCounts.get(jobId)?.get(path) ?? 0;
}

export function resetProjectFiles(jobId: string): void {
  getJobFiles(jobId).clear();
  jobWriteCounts.delete(jobId);
}

export function getProjectFiles(jobId: string): Record<string, string> {
  return Object.fromEntries(getJobFiles(jobId));
}

export function getProjectFile(jobId: string, path: string): string | undefined {
  return getJobFiles(jobId).get(path);
}

/** Release a job's file map once its build is finished (prevents unbounded growth). */
export function disposeProjectFiles(jobId: string): void {
  jobFileMaps.delete(jobId);
  jobWriteCounts.delete(jobId);
}

/*
 * Per-job record of the LAST build/compile command run via run_shell. Lets the
 * orchestrator gate ready_for_preview on the real build result (and drive a
 * repair loop) instead of assuming success once files exist.
 */
export interface BuildResult {
  command: string;
  passed: boolean;
  output: string; // trimmed stdout+stderr, enough to diagnose the failure
}

const jobBuildResults = new Map<string, BuildResult>();

/** True if a command actually compiles the project (so its exit code is meaningful). */
function isBuildCommand(command: string): boolean {
  return /(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|vite\s+build\b|next\s+build\b|tsc\b|expo\s+export\b|flutter\s+build\b/i.test(
    command,
  );
}

export function getBuildResult(jobId: string): BuildResult | undefined {
  return jobBuildResults.get(jobId);
}

export function disposeBuildResult(jobId: string): void {
  jobBuildResults.delete(jobId);
}

/**
 * Create the agent tools for a specific job.
 *
 * Each tool:
 * 1. Performs the action (write/read/list/run)
 * 2. Emits a progress event so the user sees what's happening
 * 3. Returns the result to the LLM so it can decide what to do next
 *
 * The LLM controls the entire flow — we just provide the tools.
 *
 * @param jobId - The build job ID (used for event tracking)
 * @param supabase - Supabase client for event emission
 * @param projectId - The project ID (used for R2 workspace key)
 */
export function createAgentTools(
  jobId: string,
  supabase: SupabaseClient,
  projectId: string,
  media?: MediaConfig,
) {
  // Per-job file map — isolated from any other build running concurrently.
  const projectFiles = getJobFiles(jobId);

  /**
   * Register a generated text file exactly like write_file does: memory map +
   * R2 workspace + a file_written event (content inlined only when small). Used
   * by generate_image to drop the image module into the project.
   */
  const registerFile = async (path: string, content: string) => {
    projectFiles.set(path, content);

    try {
      await putFile(buildWorkspaceKey(projectId, path), content);
    } catch (e) {
      logger.warn(`[agent] R2 write failed for ${path}: ${e}`);
    }

    const lines = content.split('\n').length;
    const inlineContent = content.length <= MAX_INLINE_CONTENT ? content : undefined;
    await emitEvent(supabase, jobId, 'file_written' as any, `📝 ${path} (${lines} lines, ${content.length} chars)`, {
      filePath: path,
      path,
      lines,
      size: content.length,
      content: inlineContent,
      truncated: inlineContent === undefined,
    });
  };

  return {
    // ═══════════════════════════════════════════════════════════════════
    // write_file — Write a file to the project workspace (like Super Z's Write tool)
    // ═══════════════════════════════════════════════════════════════════
    write_file: tool({
      description:
        'Write a file to the project. Use this to create or update any file — HTML, CSS, JS, JSON, etc. ' +
        'The file is saved instantly and can be read back with read_file to verify. ' +
        'If the file already exists, it will be overwritten with the new content. ' +
        'For JSON files (package.json, tsconfig.json), you can pass either a string or a JSON object.',
      parameters: z.object({
        path: z
          .string()
          .describe('The file path, e.g. "index.html", "src/App.tsx", "styles.css"'),
        content: z
          .any()
          .describe(
            'The COMPLETE file content. Pass as a STRING for code files (HTML, CSS, JS, JSX). For JSON files (package.json), you can pass either a string or a JSON object. Write the full file — no placeholders, no truncation.',
          ),
      }),
      execute: async ({ path, content }) => {
        // Convert object/array content to string (for JSON files)
        const fileContent =
          typeof content === 'string' ? content : JSON.stringify(content, null, 2);

        /*
         * LOOP BREAKER. Some models (GLM-4.x) get stuck rewriting the same file
         * over and over. If this write is IDENTICAL to what's already saved,
         * it's a no-op — refuse it and firmly redirect the model, instead of
         * silently accepting it and letting the loop continue until the
         * orchestrator's backstop aborts the whole build.
         */
        const prevContent = projectFiles.get(path);

        if (prevContent !== undefined && prevContent === fileContent) {
          logger.info(`[agent] write_file: ${path} unchanged — refusing redundant rewrite`);
          bumpWriteCount(jobId, path);

          return {
            success: true,
            path,
            unchanged: true,
            message:
              `${path} is ALREADY saved with EXACTLY this content — nothing changed. ` +
              `STOP rewriting ${path}. Move on to a different file that still needs work, ` +
              `or call done() if the project is complete.`,
          };
        }

        /*
         * HARD LOCK. If this path has already been written several times, refuse
         * further writes and force the model to make progress instead. This is
         * the definitive loop breaker for models that keep re-editing one file
         * with tiny changes (so the identical-content check above never fires)
         * and never move on to the remaining files — which would otherwise leave
         * the project incomplete and fail the build.
         */
        const priorCount = getWriteCount(jobId, path);

        if (priorCount >= 4) {
          logger.warn(`[agent] write_file: ${path} LOCKED — ${priorCount} prior writes; refusing to break the loop`);
          bumpWriteCount(jobId, path);

          return {
            success: false,
            path,
            locked: true,
            message:
              `REFUSED — ${path} is now LOCKED (you have written it ${priorCount} times). Rewriting it again will NOT help. ` +
              `Create the files you have NOT written yet (e.g. the source/entry files), then call done(). ` +
              `If every file already exists, call done() NOW.`,
          };
        }

        const writeCount = bumpWriteCount(jobId, path);

        // Store in memory
        projectFiles.set(path, fileContent);

        // Also store to R2 workspace for persistence
        try {
          const r2Key = buildWorkspaceKey(projectId, path);
          await putFile(r2Key, fileContent);
        } catch (e) {
          logger.warn(`[agent] R2 write failed for ${path}: ${e}`);
          // Non-fatal — memory copy is enough for the build
        }

        // Emit progress event with filePath + content so the client can render the
        // file in real-time WITHOUT a fetch round-trip to /api/workspace.
        //
        // The client (use-external-worker.ts) listens for `file_written` events
        // and now reads `payload.filePath` + `payload.content` directly.
        //
        // We cap content at 100KB per event to keep Realtime payloads manageable
        // (Supabase Realtime has a ~1MB message limit). For files > 100KB, the
        // client falls back to fetching via /api/workspace at ready_for_preview.
        const lines = fileContent.split('\n').length;
        const inlineContent =
          fileContent.length <= MAX_INLINE_CONTENT ? fileContent : undefined;

        await emitEvent(
          supabase,
          jobId,
          'file_written' as any,
          `📝 ${path} (${lines} lines, ${fileContent.length} chars)`,
          {
            filePath: path,
            path,
            lines,
            size: fileContent.length,
            content: inlineContent,
            truncated: inlineContent === undefined,
          },
        );

        logger.info(
          `[agent] write_file: ${path} (${fileContent.length} chars, ${lines} lines, inline=${inlineContent !== undefined})`,
        );

        /*
         * If the model has now written this same path several times (even with
         * small changes each time), nudge it to stop fiddling and move on — this
         * heads off the slow "rewrite the same file forever" loop before the
         * orchestrator's hard backstop has to abort.
         */
        const loopNudge =
          writeCount >= 3
            ? ` NOTE: you have written ${path} ${writeCount} times now — this version is saved. Do NOT rewrite it again unless something is genuinely wrong; move on to another file or call done().`
            : '';

        return {
          success: true,
          path,
          size: fileContent.length,
          lines,
          message: `File ${path} written successfully (${fileContent.length} chars, ${lines} lines).${loopNudge}`,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // read_file — Read a file from the project (like Super Z's Read tool)
    // ═══════════════════════════════════════════════════════════════════
    read_file: tool({
      description:
        'Read a file from the current project. Use this to verify your work after writing, ' +
        'or to read an existing file before modifying it. Returns the full file content.',
      parameters: z.object({
        path: z
          .string()
          .describe('The file path to read, e.g. "index.html"'),
      }),
      execute: async ({ path }) => {
        // Try memory first (faster, includes current build's changes)
        let content = projectFiles.get(path);

        // If not in memory, try R2 workspace (existing files from previous builds)
        if (!content) {
          try {
            const r2Key = buildWorkspaceKey(projectId, path);
            const r2Content = await getFileText(r2Key);

            if (r2Content) {
              content = r2Content;
              projectFiles.set(path, content); // Cache in memory
            }
          } catch (e) {
            logger.warn(`[agent] R2 read failed for ${path}: ${e}`);
          }
        }

        if (!content) {
          return {
            error: `File not found: ${path}`,
            availableFiles: Array.from(projectFiles.keys()),
          };
        }

        logger.info(`[agent] read_file: ${path} (${content.length} chars)`);

        return {
          path,
          content,
          size: content.length,
          lines: content.split('\n').length,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // list_files — List all files in the project (like Super Z's LS/Glob)
    // ═══════════════════════════════════════════════════════════════════
    list_files: tool({
      description:
        'List all files in the current project. Use this to see the project structure ' +
        'and verify all expected files have been created.',
      parameters: z.object({}),
      execute: async () => {
        const files = Array.from(projectFiles.entries()).map(([path, content]) => ({
          path,
          size: content.length,
          lines: content.split('\n').length,
        }));

        files.sort((a, b) => a.path.localeCompare(b.path));

        logger.info(`[agent] list_files: ${files.length} files`);

        return {
          totalFiles: files.length,
          files,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // edit_file — Edit a specific part of a file by replacing old text with new text.
    //
    // IMPORTANT: many LLMs (GLM-4.x/5.x included) sometimes pass `oldText` and
    // `newText` as JSON objects/arrays instead of strings — even when the
    // schema says string. This causes "Type validation failed" which aborts
    // the entire build. We accept `z.any()` and coerce at runtime:
    //   - string → use as-is
    //   - object/array → JSON.stringify with 2-space indent
    //   - number/boolean → String()
    //   - null/undefined → empty string
    // ═══════════════════════════════════════════════════════════════════
    edit_file: tool({
      description:
        'Edit a specific part of a file by replacing old text with new text. ' +
        'Use this for targeted changes instead of rewriting the whole file with write_file. ' +
        'The oldText must match EXACTLY (including whitespace and indentation). ' +
        'Pass oldText and newText as STRINGS (not objects).',
      parameters: z.object({
        path: z.string().describe('The file path to edit'),
        oldText: z
          .any()
          .describe('The exact text to find and replace (must match exactly). Pass as a STRING.'),
        newText: z
          .any()
          .describe('The new text to replace it with. Pass as a STRING.'),
      }),
      execute: async ({ path, oldText: rawOld, newText: rawNew }) => {
        // Coerce to string — handles LLMs that pass objects/arrays/numbers
        const coerce = (v: any): string => {
          if (v === null || v === undefined) {
            return '';
          }

          if (typeof v === 'string') {
            return v;
          }

          if (typeof v === 'number' || typeof v === 'boolean') {
            return String(v);
          }

          // object or array — stringify with indentation
          try {
            return JSON.stringify(v, null, 2);
          } catch {
            return String(v);
          }
        };

        const oldText = coerce(rawOld);
        const newText = coerce(rawNew);

        let content = projectFiles.get(path);

        if (!content) {
          // Try R2
          try {
            const r2Key = buildWorkspaceKey(projectId, path);
            const r2Content = await getFileText(r2Key);

            if (r2Content) {
              content = r2Content;
              projectFiles.set(path, content);
            }
          } catch { /* ignore */ }
        }

        if (!content) {
          return { error: `File not found: ${path}`, availableFiles: Array.from(projectFiles.keys()) };
        }

        if (!content.includes(oldText)) {
          return {
            error: `oldText not found in ${path}. Make sure it matches exactly (including whitespace).`,
            fileLength: content.length,
            first100Chars: content.slice(0, 100),
          };
        }

        const updated = content.replace(oldText, newText);
        projectFiles.set(path, updated);

        // Write to R2
        try {
          const r2Key = buildWorkspaceKey(projectId, path);
          await putFile(r2Key, updated);
        } catch (e) {
          logger.warn(`[agent] R2 write failed for ${path}: ${e}`);
        }

        // Emit file_written with the new content so the client UI updates live.
        const lines = updated.split('\n').length;
        const inlineContent =
          updated.length <= MAX_INLINE_CONTENT ? updated : undefined;

        await emitEvent(
          supabase,
          jobId,
          'file_written' as any,
          `✏️ ${path} edited (${lines} lines)`,
          {
            filePath: path,
            path,
            lines,
            size: updated.length,
            content: inlineContent,
            truncated: inlineContent === undefined,
          },
        );

        logger.info(`[agent] edit_file: ${path} (replaced ${oldText.length} chars with ${newText.length})`);

        return {
          success: true,
          path,
          oldLength: content.length,
          newLength: updated.length,
          message: `Edited ${path} successfully.`,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // delete_file — Delete a file from the project
    // ═══════════════════════════════════════════════════════════════════
    delete_file: tool({
      description:
        'Delete a file from the project. Use this to remove unused or obsolete files.',
      parameters: z.object({
        path: z.string().describe('The file path to delete'),
      }),
      execute: async ({ path }) => {
        const existed = projectFiles.delete(path);

        if (!existed) {
          return { error: `File not found: ${path}` };
        }

        // Delete from R2
        try {
          const { deleteFile } = await import('./r2-client');
          const r2Key = buildWorkspaceKey(projectId, path);
          await deleteFile(r2Key);
        } catch (e) {
          logger.warn(`[agent] R2 delete failed for ${path}: ${e}`);
        }

        logger.info(`[agent] delete_file: ${path}`);

        return {
          success: true,
          path,
          message: `Deleted ${path}`,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // run_tests — Run the project's test suite (separate from run_shell)
    // ═══════════════════════════════════════════════════════════════════
    run_tests: tool({
      description:
        'Run the project test suite (npm test, vitest, jest, etc.). ' +
        'Returns test results including pass/fail counts. ' +
        'Use this after making changes to verify nothing broke.',
      parameters: z.object({}),
      execute: async () => {
        const files = Object.fromEntries(projectFiles);

        if (Object.keys(files).length === 0) {
          return { exitCode: 0, stdout: 'No files to test.', stderr: '', success: true, passed: 0, failed: 0 };
        }

        /*
         * CRITICAL: force RUN-ONCE mode. `npm test` for a Vite/React project is
         * usually `vitest`, which DEFAULTS TO WATCH MODE and never exits — the
         * process just waits for file changes, so the command hangs until the
         * E2B timeout and the Tester stalls forever at "Run test suite" (never
         * reaching screenshot/report). vitest, jest and react-scripts all honour
         * CI=true → run once and exit. `timeout` is a hard safety net so even a
         * stubborn watcher is killed and we fall through to the next runner.
         */
        const result = await runInE2B(
          jobId,
          "CI=true timeout 150 sh -c 'npm test 2>&1 || npx --yes vitest run 2>&1 || npx --yes jest --ci 2>&1 || echo \"No tests found\"'",
          files,
        );

        const passed = (result.stdout.match(/\d+ passing/gi) || [])[0]?.match(/\d+/)?.[0] || '0';
        const failed = (result.stdout.match(/\d+ failing/gi) || [])[0]?.match(/\d+/)?.[0] || '0';

        logger.info(`[agent] run_tests: passed=${passed}, failed=${failed}`);

        return {
          exitCode: result.exitCode,
          stdout: result.stdout.substring(0, 3000),
          stderr: result.stderr.substring(0, 2000),
          success: result.exitCode === 0,
          passed: parseInt(passed),
          failed: parseInt(failed),
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // take_screenshot — Take a screenshot of the running app (via E2B)
    // ═══════════════════════════════════════════════════════════════════
    take_screenshot: tool({
      description:
        'Take a screenshot of the running dev server to visually verify the app. ' +
        'The screenshot is taken from the E2B sandbox at http://localhost:3000. ' +
        'Use this to check if the UI renders correctly after building.',
      parameters: z.object({}),
      execute: async () => {
        const files = Object.fromEntries(projectFiles);

        if (Object.keys(files).length === 0) {
          return { error: 'No files written yet. Build the project first.' };
        }

        // Run a screenshot command in E2B
        // Install playwright in the sandbox and take a screenshot
        const result = await runInE2B(
          jobId,
          'npx playwright install chromium 2>/dev/null; node -e "' +
            'const { chromium } = require(\"playwright\");' +
            '(async () => {' +
            '  const browser = await chromium.launch();' +
            '  const page = await browser.newPage();' +
            '  try {' +
            '    await page.goto(\"http://localhost:3000\", { timeout: 10000 });' +
            '    const title = await page.title();' +
            '    const bodyText = await page.textContent(\"body\");' +
            '    console.log(\"TITLE:\" + title);' +
            '    console.log(\"BODY:\" + (bodyText || \"\").slice(0, 500));' +
            '    console.log(\"SCREENSHOT_OK\");' +
            '  } catch(e) { console.log(\"ERROR:\" + e.message); }' +
            '  await browser.close();' +
            '})();"',
          files,
        );

        logger.info(`[agent] take_screenshot: exit ${result.exitCode}`);

        const output = result.stdout + result.stderr;

        return {
          success: output.includes('SCREENSHOT_OK'),
          title: output.match(/TITLE:(.*)/)?.[1] || 'Unknown',
          bodyText: output.match(/BODY:(.*)/)?.[1]?.slice(0, 300) || '',
          error: output.includes('ERROR:') ? output.match(/ERROR:(.*)/)?.[1] : undefined,
          rawOutput: output.substring(0, 2000),
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // list_uploads — List files uploaded by the user (in uploads/ folder)
    // ═══════════════════════════════════════════════════════════════════
    list_uploads: tool({
      description:
        'List files that the user has uploaded to the project (in the uploads/ folder). ' +
        'Use this to see what files the user has provided — images, CSVs, PDFs, etc. ' +
        'You can then read these files with read_file to use them in the project.',
      parameters: z.object({}),
      execute: async () => {
        // List files from R2 under uploads/ prefix
        try {
          const { listObjects } = await import('./r2-client');
          const prefix = `projects/${projectId}/workspace/uploads/`;
          const keys = await listObjects(prefix);
          const uploadFiles = keys.map((k) => k.slice(prefix.length)).filter((f) => f.length > 0);

          logger.info(`[agent] list_uploads: ${uploadFiles.length} files`);

          return {
            totalUploads: uploadFiles.length,
            files: uploadFiles,
          };
        } catch (e) {
          logger.warn(`[agent] list_uploads failed: ${e}`);
          return { totalUploads: 0, files: [] };
        }
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // generate_image — Generate a REAL image asset (logo, hero, illustration)
    // ═══════════════════════════════════════════════════════════════════
    generate_image: tool({
      description:
        'Generate a real image asset (logo, hero background, illustration, icon) from a text prompt ' +
        'and save it into the project as an importable module. Use this instead of external placeholder ' +
        'URLs or emoji whenever the user needs original artwork — e.g. "design a logo", "a hero image of…". ' +
        'Give a "name" (kebab-case, no extension, e.g. "logo" or "hero-bg") and a detailed "prompt" ' +
        '(describe subject, style, colors, background — say "transparent background" for logos/icons). ' +
        'Returns the import path; then import it in your code, e.g. ' +
        "`import logo from './assets/logo';` and use it as an <img src={logo} /> or a CSS background.",
      parameters: z.object({
        name: z
          .string()
          .describe('Asset name, kebab-case, no extension (e.g. "logo", "hero-bg", "empty-state").'),
        prompt: z.string().describe('Detailed image description: subject, style, colors, background.'),
      }),
      execute: async ({ name, prompt }) => {
        if (!media?.apiKey) {
          return {
            ok: false,
            error:
              'Image generation is not available for this build (no OpenRouter key). ' +
              'Use a tasteful CSS/SVG placeholder instead.',
          };
        }

        const safe = String(name)
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'asset';
        const modulePath = `src/assets/${safe}.ts`;

        try {
          await emitEvent(supabase, jobId, 'file_chunk' as any, `🎨 Generating image "${safe}"…`);

          // Logos/icons need alpha (keep PNG); heroes/photos compress to JPEG.
          const transparent = /logo|icon|mark|avatar|badge|transparent/i.test(`${safe} ${prompt}`);

          const img = await generateImage({
            apiKey: media.apiKey,
            model: media.model || DEFAULT_IMAGE_MODEL,
            prompt,
            transparent,
          });

          // Store as an importable ES module exporting the data URI. This flows
          // through the existing text-only file pipeline (bundles + previews)
          // without needing a binary asset path.
          const mod =
            `// Generated by Palmkit (${img.mime}, ~${Math.round(img.bytes / 1024)}KB). Do not edit.\n` +
            `const src = ${JSON.stringify(img.dataUri)};\nexport default src;\n`;

          await registerFile(modulePath, mod);

          return {
            ok: true,
            path: modulePath,
            importAs: safe.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()),
            usage: `import asset from './assets/${safe}'; then use asset as an <img src> or CSS background url.`,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`[agent] generate_image "${safe}" failed: ${msg}`);
          return {
            ok: false,
            error: `Image generation failed (${msg}). Use a tasteful CSS/SVG placeholder instead — do not retry.`,
          };
        }
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // search_code — Search across all project files (like Super Z's Grep)
    // ═══════════════════════════════════════════════════════════════════
    search_code: tool({
      description:
        'Search for a pattern across all project files. Returns matching lines with file paths and line numbers. ' +
        'Use this to find where a function, variable, import, or string is used.',
      parameters: z.object({
        pattern: z
          .string()
          .describe('The text or regex pattern to search for, e.g. "useState" or "app.get"'),
      }),
      execute: async ({ pattern }) => {
        const results: Array<{ path: string; line: number; text: string }> = [];

        try {
          const regex = new RegExp(pattern, 'gi');

          for (const [path, content] of projectFiles.entries()) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push({ path, line: i + 1, text: lines[i].trim().slice(0, 120) });
              }
              regex.lastIndex = 0; // reset regex state
            }
          }
        } catch (e) {
          // If regex fails, do a simple string search
          const lowerPattern = pattern.toLowerCase();

          for (const [path, content] of projectFiles.entries()) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerPattern)) {
                results.push({ path, line: i + 1, text: lines[i].trim().slice(0, 120) });
              }
            }
          }
        }

        logger.info(`[agent] search_code: "${pattern}" → ${results.length} matches`);

        return {
          pattern,
          totalMatches: results.length,
          results: results.slice(0, 50), // cap at 50 results
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // run_shell — Run a shell command in E2B sandbox (like Super Z's Bash)
    // ═══════════════════════════════════════════════════════════════════
    run_shell: tool({
      description:
        'Run a shell command in an isolated sandbox to verify the build. Returns stdout, stderr, and exit code. ' +
        'The sandbox PERSISTS across calls within this build: node_modules and other state from a previous ' +
        'command (e.g. "npm install") are still there on the next call, and your latest project files are always ' +
        'synced in before the command runs. So you can run "npm install" once and then "npm run build" as a ' +
        'separate later call without reinstalling. (Running them together as ' +
        '"cd /home/user/project && npm install && npm run build" is also fine.)',
      parameters: z.object({
        command: z
          .string()
          .describe('The shell command to run, e.g. "npm run build" or "ls -la"'),
      }),
      execute: async ({ command }) => {
        // Run in E2B sandbox — isolated, secure, with project files
        const files = Object.fromEntries(projectFiles);

        if (Object.keys(files).length === 0) {
          logger.warn(`[agent] run_shell called with 0 files — skipping E2B sandbox`);
          return {
            command,
            exitCode: 0,
            stdout: 'No files written yet. Write files first using write_file before running shell commands.',
            stderr: '',
            success: true,
            message: 'Skipped — no files to test. Use write_file first.',
          };
        }

        /*
         * LIVE TERMINAL: announce the command BEFORE it runs so the client's
         * read-only terminal shows "$ npm run build" with a spinner while E2B
         * executes, then the matching shell_output event fills in stdout/stderr
         * and the exit code. Command-level granularity (E2B returns the whole
         * output at once) — enough to watch the build work in real time.
         */
        await emitEvent(supabase, jobId, 'shell_command' as any, `$ ${command}`, { command, running: true });

        const result = await runInE2B(jobId, command, files);

        logger.info(`[agent] run_shell (E2B): "${command}" → exit ${result.exitCode}`);

        await emitEvent(
          supabase,
          jobId,
          'shell_output' as any,
          `$ ${command} → exit ${result.exitCode}`,
          {
            command,
            exitCode: result.exitCode,
            stdout: (result.stdout ?? '').slice(0, 3000),
            stderr: (result.stderr ?? '').slice(0, 2000),
          },
        );

        /*
         * If this was a real build/compile command, record its result for the
         * job so the orchestrator can gate completion + drive a repair loop.
         */
        if (isBuildCommand(command)) {
          const output = `${result.stdout}\n${result.stderr}`.trim();
          jobBuildResults.set(jobId, {
            command,
            passed: result.exitCode === 0,
            output: output.slice(-4000), // keep the tail — that's where errors are
          });
        }

        return {
          command,
          exitCode: result.exitCode,
          stdout: result.stdout.substring(0, 3000),
          stderr: result.stderr.substring(0, 2000),
          success: result.exitCode === 0,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // done — Signal that the build is complete (like Super Z's final response)
    // ═══════════════════════════════════════════════════════════════════
    done: tool({
      description:
        'Signal that you have finished building the project. Call this ONLY when all files ' +
        'have been written and verified. This marks the build as complete and triggers preview generation.',
      parameters: z.object({
        summary: z
          .string()
          .optional()
          .describe('A brief summary of what was built, e.g. "Space travel landing page with React, Tailwind, and Framer Motion"'),
      }),
      execute: async ({ summary }) => {
        const fileCount = projectFiles.size;
        const totalSize = Array.from(projectFiles.values()).reduce((sum, c) => sum + c.length, 0);

        logger.info(`[agent] done: ${fileCount} files, ${totalSize} chars total`);

        await emitEvent(supabase, jobId, 'file_generation_completed' as any,
          `✅ Build complete! ${fileCount} files, ${totalSize} chars${summary ? ' — ' + summary : ''}`,
          { fileCount, totalSize, summary },
        );

        return {
          success: true,
          fileCount,
          totalSize,
          message: `Build marked as complete. ${fileCount} files written.`,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // update_todos — Publish the agent's current task list (structured).
    //
    // The agent calls this whenever its plan changes — typically:
    //   1. Once at the very start (all items "pending")
    //   2. After completing each item (flip it to "done", next one to "in_progress")
    //   3. Once at the end (all items "done")
    //
    // The frontend renders these as a checklist with green ✓ for done,
    // spinner for in_progress, and empty ○ for pending — exactly like
    // chat.z.ai / Claude Code / Cursor todos panel.
    //
    // IMPORTANT: many LLMs (notably GLM-4.x) serialize the `todos` array
    // as a JSON STRING instead of a JSON array, even when the schema says
    // array. We accept both forms and parse the string if needed — without
    // this, the tool call fails with "Type validation failed" and the
    // whole build aborts.
    // ═══════════════════════════════════════════════════════════════════
    update_todos: tool({
      description:
        'Publish your current task list so the user can see what you are working on. ' +
        'Call this AT THE START to share your plan, and AGAIN whenever a task completes ' +
        'so the user sees live progress. Each task has a status: "pending", "in_progress", or "done". ' +
        'Only ONE task should be "in_progress" at a time. Keep task text short (max 80 chars). ' +
        'Pass the `todos` parameter as a JSON ARRAY (not a string), e.g. ' +
        '[{"text":"Create App.tsx","status":"in_progress"},{"text":"Add styles","status":"pending"}].',
      /*
       * `todos` is OPTIONAL on purpose. Some models (observed with GLM-5.2) call
       * update_todos with EMPTY args `{}`. If the param is required, the AI SDK
       * throws a schema-validation error BEFORE execute() runs — and that error
       * aborts the whole Builder stream, killing the build with 0 files. Making
       * it optional lets a malformed call reach execute(), which handles every
       * shape gracefully (returns a soft error the model can recover from)
       * instead of crashing. A non-essential progress tool must never be able to
       * fail a build.
       */
      parameters: z.object({
        todos: z
          .any()
          .optional()
          .describe(
            'The complete current task list as a JSON array. ' +
              'Each item must have: { "text": string (max 120 chars), "status": "pending" | "in_progress" | "done" }. ' +
              'Send the FULL list every time, not just changes. Max 20 items.',
          ),
      }),
      execute: async ({ todos: rawTodos }) => {
        // Coerce: if the LLM passed a JSON string, parse it. If it passed
        // an array directly, use it as-is. If anything else, fail gracefully.
        let todos: Array<{ text: string; status: 'pending' | 'in_progress' | 'done' }>;

        if (typeof rawTodos === 'string') {
          try {
            const parsed = JSON.parse(rawTodos);
            todos = Array.isArray(parsed) ? parsed : [];
          } catch {
            return {
              success: false,
              error:
                'Could not parse `todos` — pass a JSON array, not a string. ' +
                  'Example: [{"text":"Create App.tsx","status":"in_progress"}]',
            };
          }
        } else if (Array.isArray(rawTodos)) {
          todos = rawTodos;
        } else {
          return {
            success: false,
            error: '`todos` must be a JSON array. Got: ' + typeof rawTodos,
          };
        }

        // Validate + sanitize each item
        const validStatuses = new Set(['pending', 'in_progress', 'done']);
        const sanitized = todos
          .filter((t) => t && typeof t === 'object')
          .map((t) => ({
            text: String(t.text ?? '').slice(0, 120),
            status: validStatuses.has(t.status) ? t.status : 'pending',
          }))
          .filter((t) => t.text.length > 0)
          .slice(0, 20);

        if (sanitized.length === 0) {
          return {
            success: false,
            error: 'No valid todos found. Each item needs {text, status}.',
          };
        }

        const done = sanitized.filter((t) => t.status === 'done').length;
        const inProgress = sanitized.filter((t) => t.status === 'in_progress').length;
        const pending = sanitized.filter((t) => t.status === 'pending').length;

        logger.info(
          `[agent] update_todos: ${sanitized.length} items (${done} done, ${inProgress} in_progress, ${pending} pending)`,
        );

        await emitEvent(
          supabase,
          jobId,
          'todos_updated',
          `📋 Todos: ${done}/${sanitized.length} done`,
          {
            todos: sanitized,
            counts: { total: sanitized.length, done, inProgress, pending },
            /*
             * Include the agent name so the client can route the event to
             * the correct agent's todo snapshot in agentTodosStore.
             * Without this, dispatchJobEvent falls back to 'Worker' and
             * the TodosPanel (which looks for 'Builder') never finds the data.
             */
            agent: 'Builder',
          },
        );

        return {
          success: true,
          counts: { total: sanitized.length, done, inProgress, pending },
          message: `Todos updated: ${done}/${sanitized.length} done, ${inProgress} in progress`,
        };
      },
    }),

    /*
     * ask_user — let the agent ask the user a question mid-stream.
     *
     * This replaces the pre-build clarifier popup. Instead of blocking the
     * build with a modal, the Planner/Builder can ask a question INSIDE the
     * stream. The question appears as a special event in the BuildStream;
     * the user sees it and can answer. If the user hasn't answered by the
     * time the tool returns (a few seconds), the agent proceeds with sensible
     * defaults — the question is a hint, not a hard gate.
     *
     * Why not a hard pause: streamText's tool execution is synchronous within
     * a step — we can't block the stream waiting for user input without a
     * complex pause/resume mechanism. The "proceed with defaults" approach is
     * simpler and still valuable: the user SEES the question (transparency)
     * and can correct course in the next message if the defaults were wrong.
     */
    ask_user: tool({
      description:
        'Ask the user a clarifying question. Use sparingly — only when a missing detail would make the build fail or produce a wrong result. The user sees the question in the chat stream. If they do not answer in time, proceed with sensible defaults.',
      parameters: z.object({
        question: z.string().describe('The question to ask the user (keep it short, one sentence).'),
        options: z
          .array(z.string())
          .optional()
          .describe('Optional list of suggested answers the user can pick from.'),
        default_choice: z
          .string()
          .describe('What you will do if the user does not answer. Proceed with this.'),
      }),
      execute: async (args) => {
        const { question, options, default_choice } = args;

        try {
          await emitEvent(supabase, jobId, 'file_chunk', `❓ ${question}`, {
            agent: 'Planner',
            kind: 'question',
            question,
            options: options ?? [],
            defaultChoice: default_choice,
          });
        } catch {
          /* best-effort */
        }

        return {
          answered: false,
          answer: default_choice,
          message: `User has not answered yet. Proceeding with: ${default_choice}`,
        };
      },
    }),
  };
}
