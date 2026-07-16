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
import { streamText, type LanguageModelV1 } from 'ai';
import { putFile, getFileText, buildWorkspaceKey } from './r2-client';
import { writeProjectFileToDisk, readProjectFileFromDisk } from './workspace-manager';
import { logger } from './logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emitEvent } from './event-emitter';
import { runInE2B } from './e2b-runner';
import { generateImage, DEFAULT_IMAGE_MODEL } from './image-gen';
import { analyzeScreenshot } from './vision';
import { generateVideo } from './video-gen';

/**
 * Max file-content size inlined into a file_written event. Files at/under this
 * stream to the client via Realtime (the reliable delivery path everything
 * depends on); larger files fall back to a workspace fetch. 300KB covers our
 * compressed image-asset modules and stays well under Supabase Realtime's ~1MB
 * message limit.
 */
const MAX_INLINE_CONTENT = 300 * 1024;

/**
 * Media config — provider-agnostic. The user picks models for each role
 * (vision, media) in Settings. This config carries those choices so the
 * tools can route to the right API.
 */
export interface MediaConfig {
  // Image generation
  imageApiKey: string;
  imageModel: string;
  imageProvider: 'openrouter' | 'zai' | 'google';

  // Video generation
  videoApiKey: string;
  videoModel: string;
  videoProvider: 'zai' | 'openrouter' | 'google';

  // Vision (VLM for analyze_screenshot)
  visionApiKey: string;
  visionModel: string;
  visionProvider: 'zai' | 'openrouter' | 'google';

  // Legacy compat (some code still reads these)
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

export function getJobFiles(jobId: string): Map<string, string> {
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
  model?: LanguageModelV1,
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

  /*
   * Core write implementation — shared by write_file (single) and
   * write_files (batch). Every guard lives HERE so both tools behave
   * identically: JSON-envelope unwrap, identical-content refusal, the
   * per-path hard lock, R2 persistence, and the file_written event.
   */
  const performWrite = async (path: string, content: any) => {
        /*
         * Convert object/array content to string. For .json files, raw JSON is
         * correct. For JS/TS files it is NOT: models pass config objects for
         * postcss.config.js / tailwind.config.js, and saving raw JSON into a
         * .js file crashes Vite at startup ("Unexpected token ':'") — observed
         * live, it took the whole preview down. Wrap it as a proper ES module.
         */
        let fileContent: string;

        if (typeof content === 'string') {
          /*
           * JSON-UNWRAP GUARD. Some models (GLM-4.x, some OpenRouter models)
           * wrap file content in a JSON envelope like {"content": "actual code"}
           * or {"text": "actual code"} instead of passing the raw string.
           * If the string looks like a JSON object with a single string-valued
           * "content" / "text" / "code" key, extract the inner value — that's
           * the actual file the model intended to write.
           *
           * Heuristic: starts with '{' AND contains a "content"/"text"/"code"
           * key whose value is a string. Only unwrap if the inner string is
           * longer than the wrapper (the wrapper is noise, the inner value is
           * the real file). This avoids false positives on legitimate JSON files.
           */
          const trimmed = content.trimStart();

          if (
            trimmed.startsWith('{') &&
            !path.endsWith('.json') &&
            !path.endsWith('.json5')
          ) {
            try {
              const parsed = JSON.parse(trimmed);

              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const innerKey = ['content', 'text', 'code', 'source', 'file_content'].find(
                  (k) => typeof parsed[k] === 'string' && parsed[k].length > trimmed.length * 0.5,
                );

                if (innerKey) {
                  logger.info(
                    `[agent] write_file: ${path} — unwrapped JSON envelope (key="${innerKey}", wrapper=${trimmed.length} chars, inner=${parsed[innerKey].length} chars)`,
                  );
                  fileContent = parsed[innerKey];
                } else {
                  fileContent = content;
                }
              } else {
                fileContent = content;
              }
            } catch {
              // Not valid JSON — use as-is
              fileContent = content;
            }
          } else {
            fileContent = content;
          }
        } else {
          const json = JSON.stringify(content, null, 2);

          /*
           * Include .jsx, .tsx, .mts, .cts in the JS/TS detection.
           * Previously only .mjs/.js/.ts matched — so a model that passed an
           * object for tailwind.config.js worked, but postcss.config.cjs or
           * any .jsx content got raw JSON.stringified, crashing Vite.
           */
          if (/\.(mjs|jsx?|mts?|cts?)$/i.test(path)) {
            fileContent = `export default ${json};\n`;
          } else if (/\.cjs$/i.test(path)) {
            fileContent = `module.exports = ${json};\n`;
          } else {
            fileContent = json;
          }
        }

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

        // M1: disk is the source of truth (fast, local, git-able).
        try {
          await writeProjectFileToDisk(projectId, path, fileContent);
        } catch (e) {
          logger.warn(`[agent] disk write failed for ${path}: ${e}`);
        }

        // R2 stays as delivery + backup (the Cloudflare app serves from it).
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
  };

  return {
    // ═══════════════════════════════════════════════════════════════════
    // write_file — Write a single file to the project workspace
    // ═══════════════════════════════════════════════════════════════════
    write_file: tool({
      description:
        'Write ONE file to the project. Prefer write_files (batch) when creating several files at once. ' +
        'The file is saved instantly and can be read back with read_file to verify. ' +
        'If the file already exists, it will be overwritten with the new content.',
      parameters: z.object({
        path: z
          .string()
          .describe('The file path, e.g. "index.html", "src/App.tsx", "styles.css"'),
        content: z
          .any()
          .describe(
            'The COMPLETE file content. Pass as a STRING for code files (HTML, CSS, JS, JSX). For JSON files (package.json), a string or a JSON object is accepted. Write the full file — no placeholders, no truncation.',
          ),
      }),
      execute: async ({ path, content }) => performWrite(path, content),
    }),

    // ═══════════════════════════════════════════════════════════════════
    // write_files — Batch write: create MANY files in ONE tool call.
    // Palmkit's fast path: the model plans silently, then ships the whole
    // scaffolding in a single step instead of one LLM round trip per file.
    // ═══════════════════════════════════════════════════════════════════
    write_files: tool({
      description:
        'Write MULTIPLE files to the project in ONE call. This is the PREFERRED way to create a new project: ' +
        'think first, then pass ALL the files (scaffolding + sources) as one array. Each entry is {path, content} ' +
        'with the COMPLETE file content as a raw string (no placeholders, no JSON envelopes). ' +
        'Files are saved instantly and stream to the user one by one.',
      parameters: z.object({
        /*
         * z.any() + runtime coercion, NOT z.array(): GLM-4.x/5.x sometimes
         * pass the array as a JSON STRING ('[{"path": ...}]'). A strict
         * schema makes the SDK reject the call before execute() ever runs,
         * killing the whole build — same failure class the done() tool
         * already guards against. We accept anything and coerce here.
         */
        files: z
          .any()
          .describe(
            'All files to write, in dependency order (package.json and configs first). An ARRAY of {path, content} objects.',
          ),
      }),
      execute: async ({ files }) => {
        /* Coerce: JSON-string → array; single object → [object]. */
        let list: Array<{ path?: string; content?: any }> = [];

        if (typeof files === 'string') {
          try {
            const parsed = JSON.parse(files);
            list = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            return {
              success: false,
              written: 0,
              total: 0,
              message:
                'Could not parse the files argument — pass files as an ARRAY of {path, content} objects, not a string.',
            };
          }
        } else if (Array.isArray(files)) {
          list = files;
        } else if (files && typeof files === 'object') {
          list = [files];
        }

        /* Entries themselves may also arrive as JSON strings. */
        list = list.map((f: any) => {
          if (typeof f === 'string') {
            try {
              return JSON.parse(f);
            } catch {
              return {};
            }
          }

          return f;
        });

        const results: Array<{ path: string; success: boolean; message?: string }> = [];

        for (const f of list) {
          if (!f?.path) {
            continue;
          }

          try {
            const r = await performWrite(f.path, f.content);
            results.push({ path: f.path, success: r.success !== false, message: r.message });
          } catch (e) {
            results.push({ path: f.path, success: false, message: String(e) });
          }
        }

        const ok = results.filter((r) => r.success).length;
        logger.info(`[agent] write_files: ${ok}/${results.length} files written`);

        return {
          success: ok > 0,
          written: ok,
          total: results.length,
          results,
          message:
            `Wrote ${ok}/${results.length} files.` +
            (ok === results.length ? ' All saved.' : ' Some writes were refused — see per-file results.'),
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // read_file — Read a file from the project (like Super Z's Read tool)
    // ═══════════════════════════════════════════════════════════════════
    read_file: tool({
      description:
        'Read a file from the current project. ALWAYS use this (not run_shell("cat")) to inspect file contents. ' +
        'Use this to verify your work after writing, or to read an existing file before modifying it.',
      parameters: z.object({
        path: z
          .string()
          .describe('The file path to read, e.g. "index.html"'),
      }),
      execute: async ({ path }) => {
        // Try memory first (faster, includes current build's changes)
        let content = projectFiles.get(path);

        // M1: then the project's disk dir (source of truth on this box)
        if (!content) {
          const fromDisk = await readProjectFileFromDisk(projectId, path);

          if (fromDisk !== null) {
            content = fromDisk;
            projectFiles.set(path, content);
          }
        }

        // Finally R2 (legacy projects / projects built on another box)
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
        'List all files in the current project workspace. ' +
        'ALWAYS use this (not run_shell("ls")) to see what files exist. Returns paths, sizes, and line counts.',
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
            /*
             * JSON-UNWRAP GUARD (same as write_file). Some models wrap the
             * replacement text in {"content": "..."} instead of passing the
             * raw string. Extract the inner value when detected.
             */
            const trimmed = v.trimStart();

            if (trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed);

                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  const innerKey = ['content', 'text', 'code', 'source'].find(
                    (k) => typeof parsed[k] === 'string' && parsed[k].length > trimmed.length * 0.5,
                  );

                  if (innerKey) {
                    logger.info(`[agent] edit_file: unwrapped JSON envelope (key="${innerKey}")`);
                    return parsed[innerKey];
                  }
                }
              } catch {
                // Not valid JSON — use as-is
              }
            }

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

        /*
         * Un-brick delete-then-rewrite. The write LOCK (>=4 writes) refuses
         * further writes to a path. Models that hit the lock sometimes
         * delete_file the path intending to rewrite it fresh — but the lock
         * counter survived the delete, so the rewrite was REFUSED and the
         * file was permanently lost (observed live: src/App.jsx and
         * KanbanBoard.jsx vanished from a "complete" build). After a real
         * delete, grant exactly one more write by stepping the counter back.
         */
        const m = jobWriteCounts.get(jobId);

        if (m && (m.get(path) ?? 0) >= 4) {
          m.set(path, 3);
        }

        // Make the deletion visible in the build stream — silent destructive
        // ops made post-mortems impossible.
        await emitEvent(supabase, jobId, 'file_chunk' as any, `🗑️ Deleted ${path}`, {
          agent: 'Builder',
          kind: 'file_deleted',
          filePath: path,
        });

        logger.info(`[agent] delete_file: ${path}`);

        return {
          success: true,
          path,
          message: `Deleted ${path}. You may now rewrite it ONCE — write the complete, correct content in a single write_file call.`,
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
        if (!media?.imageApiKey && !media?.apiKey) {
          return {
            ok: false,
            error:
              'Image generation is not available (no API key configured). ' +
              'Configure a Media model in Settings, or use a CSS/SVG placeholder.',
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

          // Use the user's chosen image model from Settings (Media role)
          const img = await generateImage({
            apiKey: media.imageApiKey || media.apiKey,
            model: media.imageModel || media.model || DEFAULT_IMAGE_MODEL,
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

          // Emit the generated image to the stream for user visibility
          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `🎨 Image "${safe}" ready (${Math.round(img.bytes / 1024)}KB)`,
            {
              agent: 'Brain',
              kind: 'image_ready',
              name: safe,
              dataUrl: img.dataUri,
              mime: img.mime,
              sizeBytes: img.bytes,
              isImage: true,
            },
          );

          return {
            ok: true,
            path: modulePath,
            importAs: safe.replace(/-([a-z])/g, (_m, c) => c.toUpperCase()),
            usage: `import asset from './assets/${safe}'; then use asset as an <img src> or CSS background url.`,
            message: `Image generated and saved. It's visible in the stream — the user can see it and request changes if needed.`,
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
        'Your project files are AUTOMATICALLY synced to the sandbox before every command — you never need to check if files exist with ls/find/cat. ' +
        'The sandbox PERSISTS across calls: node_modules from "npm install" survive into later calls. ' +
        'IMPORTANT: Do NOT use this to check if files exist (use list_files and read_file instead). ' +
        'Only use this for: npm install, npm run build, npx prisma generate, npm run dev, etc.',
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

        let result: { stdout: string; stderr: string; exitCode: number };

        try {
          result = await runInE2B(jobId, command, files);
        } catch (e2bErr: any) {
          const errMsg = e2bErr?.message ?? String(e2bErr);

          /*
           * E2B BILLING BLOCK — surface the clear actionable error to the
           * model AND the user. The model can't fix this; the user must
           * increase the spending limit. Emit a job_failed event so the
           * UI shows the error prominently.
           */
          if (/billing spending limit|team is blocked|Billing limit/i.test(errMsg)) {
            await emitEvent(
              supabase,
              jobId,
              'job_failed',
              `❌ E2B billing limit reached. ${errMsg}`,
              { fatal: true, billing: true },
            );

            return {
              command,
              exitCode: -1,
              stdout: '',
              stderr: errMsg,
              success: false,
              fatal: true,
              message:
                'E2B sandbox creation is blocked due to billing spending limit. ' +
                'The user must increase the spending limit at https://e2b.dev/dashboard?tab=billing. ' +
                'Stop retrying — this cannot be fixed by code changes.',
            };
          }

          result = { stdout: '', stderr: errMsg, exitCode: -1 };
        }

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
        'have been written and verified. This marks the build as complete and triggers preview generation. ' +
        'Be HONEST in your summary — say what completed and what did not.',
      /*
       * Use z.any().optional() for array params — GLM-4.x serializes arrays
       * as JSON STRINGS ("[\"a\", \"b\"]") instead of actual arrays.
       * If we use z.array(), the AI SDK rejects the tool call BEFORE
       * execute() runs — the model gets a validation error and the build
       * fails with 8 files on disk but no completion signal.
       *
       * We parse strings in execute() (same pattern as update_todos).
       */
      parameters: z.object({
        summary: z
          .string()
          .describe('A brief summary of what was built (1-2 sentences).'),
        completed: z
          .any()
          .optional()
          .describe('List of features that were successfully built. Pass as a JSON array of strings, e.g. ["counter with increment", "reset button", "dark theme"]'),
        incomplete: z
          .any()
          .optional()
          .describe('Things that did not complete. Pass as a JSON array of objects, each with {item, reason, suggestion}.'),
        next_steps: z
          .any()
          .optional()
          .describe('Optional suggestions for what the user could do next. Pass as a JSON array of strings.'),
      }),
      execute: async (args) => {
        /*
         * COERCE: GLM-4.x sends arrays as JSON strings. Parse them safely.
         */
        const parseStringArray = (v: any): string[] => {
          if (Array.isArray(v)) return v.map(String);
          if (typeof v === 'string') {
            try { const p = JSON.parse(v); return Array.isArray(p) ? p.map(String) : []; }
            catch { return v ? [v] : []; }
          }
          return [];
        };

        const coerceIncomplete = (v: any): Array<{ item: string; reason: string; suggestion: string }> => {
          if (!v) return [];
          if (Array.isArray(v)) {
            return v.map((i: any) => ({
              item: typeof i === 'string' ? i : String(i?.item ?? ''),
              reason: typeof i === 'string' ? '' : String(i?.reason ?? ''),
              suggestion: typeof i === 'string' ? '' : String(i?.suggestion ?? ''),
            }));
          }
          if (typeof v === 'string') {
            try { const p = JSON.parse(v); return Array.isArray(p) ? coerceIncomplete(p) : []; }
            catch { return []; }
          }
          return [];
        };

        const summary: string = typeof args.summary === 'string' ? args.summary : '';
        const completed = parseStringArray(args.completed);
        const incomplete = coerceIncomplete(args.incomplete);
        const next_steps = parseStringArray(args.next_steps);
        const fileCount = projectFiles.size;
        const totalSize = Array.from(projectFiles.values()).reduce((sum, c) => sum + c.length, 0);
        const filePaths = Array.from(projectFiles.keys());

        /*
         * CRITICAL GATE: refuse done() if the project has no entry point.
         * The model was calling done() after writing ONLY config files
         * (package.json, vite.config.js, tailwind.config.js, postcss.config.js)
         * without index.html or src/App.jsx — producing a 404 preview.
         *
         * Now: if there's no index.html AND no src/App.* / src/main.*,
         * REFUSE done() and tell the model exactly what's missing. The model
         * gets the message back as the tool result and (usually) writes the
         * missing files in its next step.
         */
        const hasIndexHtml = filePaths.some((p) => /^index\.html$/i.test(p));
        const hasSourceFile = filePaths.some((p) => /^src\/.*(jsx|tsx|vue|js|ts)$/i.test(p));
        const hasPyEntry = filePaths.some((p) => /^(app|main|server|run)\.py$/i.test(p));
        const hasFlutterEntry = filePaths.some((p) => /^lib\/(main|app)\.dart$/i.test(p));

        const hasAnyEntryPoint = hasIndexHtml || hasSourceFile || hasPyEntry || hasFlutterEntry;

        /*
         * RADICAL REBUILD: also check that main.jsx/main.tsX's import of
         * App.jsx/App.tsx is satisfiable. The model was writing main.jsx
         * (which imports './App') without writing App.jsx — causing a Vite
         * "Failed to resolve import './App.jsx'" error and a broken preview.
         */
        const mainFile = filePaths.find((p) => /^src\/main\.(jsx|tsx|js|ts)$/i.test(p));
        const mainContent = mainFile ? (projectFiles.get(mainFile) ?? '') : '';
        const importsApp = /from\s+['"]\.\/App['"]/i.test(mainContent) || /from\s+['"]\.\/App\.(jsx|tsx|js|ts)['"]/i.test(mainContent);
        const hasAppFile = filePaths.some((p) => /^src\/App\.(jsx|tsx|js|ts)$/i.test(p));
        const missingAppFile = importsApp && !hasAppFile;

        if ((!hasAnyEntryPoint && fileCount > 0) || missingAppFile) {
          const missing: string[] = [];

          if (!hasIndexHtml) {
            missing.push('index.html (Vite entry with <div id="root"> and <script src="/src/main.jsx">)');
          }

          if (!hasSourceFile) {
            missing.push('src/main.jsx (React mount) and src/App.jsx (main component)');
          }

          if (missingAppFile) {
            missing.push('src/App.jsx (main.jsx imports "./App" but App.jsx does not exist — Vite will fail to resolve the import)');
          }

          const refuseMsg =
            `REFUSED: you called done() but the project has NO entry point. ` +
            `You wrote ${fileCount} files (${filePaths.join(', ')}) but none of them is an actual app entry. ` +
            `Missing: ${missing.join('; ')}. ` +
            `Do NOT call done() again until you have written these files. ` +
            `Use write_file to create them NOW, then call done().`;

          logger.warn(`[agent] done() REFUSED: no entry point. Files: ${filePaths.join(', ')}`);

          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `⚠️ done() refused — missing entry point. Writing the missing files now…`,
            { agent: 'Builder', kind: 'done_refused', missing },
          );

          return {
            success: false,
            refused: true,
            fileCount,
            missing,
            message: refuseMsg,
          };
        }

        logger.info(`[agent] done: ${fileCount} files, ${totalSize} chars total`);

        /*
         * HONEST COMPLETION — emit a build_summary event with structured
         * completion data: what completed, what didn't, and next steps.
         * The frontend uses this to render an honest summary card.
         */
        const fullSummary = [
          summary || '',
          completed && completed.length > 0 ? `\n\n✅ Completed:\n${completed.map((c: string) => `- ${c}`).join('\n')}` : '',
          incomplete && incomplete.length > 0
            ? `\n\n⚠️ Incomplete:\n${incomplete.map((i: any) => {
                const item = typeof i === 'string' ? i : (i?.item ?? 'unknown');
                const reason = typeof i === 'string' ? '' : (i?.reason ?? '');
                const suggestion = typeof i === 'string' ? '' : (i?.suggestion ?? '');
                return `- ${item}${reason ? `: ${reason}` : ''}${suggestion ? ` → ${suggestion}` : ''}`;
              }).join('\n')}`
            : '',
          next_steps && next_steps.length > 0 ? `\n\n💡 Next steps:\n${next_steps.map((s: string) => `- ${s}`).join('\n')}` : '',
        ].join('');

        /*
         * `Build complete! N files, M chars` banner removed — empty message.
         * The summary is already carried in the payload (for the BuildStream's
         * summary row) and the brain's done() tool already announced it. The
         * banner was a redundant, hardcoded second voice.
         */
        await emitEvent(supabase, jobId, 'file_generation_completed' as any,
          '',
          { fileCount, totalSize, summary: fullSummary, completed, incomplete, next_steps },
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

    // ═══════════════════════════════════════════════════════════════════
    // analyze_screenshot — Take a screenshot AND analyze it with a VLM (RADICAL REBUILD)
    // ═══════════════════════════════════════════════════════════════════
    // The old `take_screenshot` tool returned a 300-char text dump of
    // document.body.textContent — the model was BLIND. It could read the
    // DOM text but couldn't see a single pixel. So it couldn't tell whether
    // the hero was centered, whether colors clashed, or whether the layout
    // was broken.
    //
    // This new tool:
    //   1. Captures a REAL screenshot as base64 PNG via Playwright in E2B
    //   2. Emits a `screenshot_captured` event so the UI shows the image inline
    //   3. Sends the image to the Z.ai vision model (VLM) with the user's question
    //   4. Returns the VLM's natural-language description to the model
    //
    // Now the agent can: build → screenshot → "is the hero centered?" →
    // VLM says "no, the headline is clipped" → edit_file → re-screenshot → done.
    analyze_screenshot: tool({
      description:
        'PREFERRED way to verify the UI visually. Takes a real screenshot of the running app and ' +
        'analyzes it with a vision model. ALWAYS use this instead of curl/wget to check the UI — ' +
        'curl only shows HTML source, not what the user sees. This tool shows you the actual rendered ' +
        'page. Use it after building to verify the layout, colors, and content look correct. ' +
        'The screenshot is shown to the user in the stream so they can see what you see. ' +
        'You can ask specific questions: "is the hero centered?", "are colors consistent?", etc.',
      parameters: z.object({
        question: z
          .string()
          .optional()
          .describe(
            'Optional specific question about the screenshot, e.g. "is the navbar overlapping the hero?" ' +
              'If omitted, the VLM describes the layout and flags any visual problems.',
          ),
        /*
         * z.any() + runtime coercion, NOT z.enum(): GLM-4.x/5.x pass things
         * like '{"width": 390, "height": 844}' (a JSON string of dimensions)
         * instead of 'mobile'. A strict enum makes the SDK reject the call
         * before execute() runs — and that error aborts the whole stream,
         * killing an otherwise-finished build (observed live on job
         * 88bdfbd4). Accept anything and coerce to desktop/mobile here.
         */
        viewport: z
          .any()
          .optional()
          .describe(
            'Viewport to capture: "desktop" (default, 1280x720) or "mobile" (390x844) for responsive checks.',
          ),
      }),
      execute: async ({ question, viewport }) => {
        /* Coerce arbitrary viewport shapes to 'desktop' | 'mobile'. */
        const coerceViewport = (v: unknown): 'desktop' | 'mobile' => {
          if (v === 'mobile' || v === 'desktop') {
            return v;
          }

          let obj: any = v;

          if (typeof v === 'string') {
            if (/mobile|phone/i.test(v)) {
              return 'mobile';
            }

            try {
              obj = JSON.parse(v);
            } catch {
              return 'desktop';
            }
          }

          if (obj && typeof obj === 'object' && typeof obj.width === 'number') {
            return obj.width <= 500 ? 'mobile' : 'desktop';
          }

          return 'desktop';
        };

        const vp = coerceViewport(viewport);
        const dims = vp === 'mobile' ? '390x844' : '1280x720';

        try {
          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `📸 Capturing screenshot (${vp})…`,
            { agent: 'Builder', kind: 'screenshot_start', viewport: vp },
          );

          // Use headless chromium to capture the page.
          //
          // RADICAL REBUILD FIX: 'npx playwright install chromium' was failing
          // in the E2B sandbox. 'apt-get install chromium-browser' also failed.
          // The most reliable approach in E2B's Ubuntu sandbox is to install
          // Chromium via snap or use the pre-installed google-chrome if available.
          //
          // We try multiple approaches in order:
          //   1. Check if chromium-browser / chromium / google-chrome already exists
          //   2. Try apt-get install chromium-browser (Ubuntu package)
          //   3. Try apt-get install chromium (alternative package name)
          //   4. Fall back to npx puppeteer with bundled chromium
          //
          // The sandbox URL pattern is: https://3000-<sandboxId>.e2b.app/preview/
          // But we don't have the sandboxId here. Instead, try localhost:5173
          // (Vite default) AND localhost:3000 — whichever responds.
          const width = dims.split('x')[0];
          const height = dims.split('x')[1];

          /*
           * Capture stack — root-caused and verified live on the real E2B
           * base template: the 478MB VM's CommitLimit (~244MB, default
           * overcommit, no swap) makes Chromium's V8 fail to reserve its
           * virtual code range → renderer dies → CLI --screenshot hangs
           * forever. Fix (measured: screenshot in 1.6s):
           *   1. vm.overcommit_memory=1
           *   2. Playwright chromium-headless-shell over CDP with
           *      waitUntil:networkidle — also captures AFTER React renders
           *      (the CLI captured the pre-JS blank page).
           *
           * e2b-runner warms this stack up in the background at sandbox
           * creation (~25s) and touches /tmp/.vision-ready. Here we wait
           * for the warm-up, self-install only as fallback, then run the
           * CDP driver. Output protocol (TRYING_PORT / SCREENSHOT_OK /
           * BASE64:) is unchanged for the parser below.
           */
          const script = `# Wait for the vision warm-up, or self-install
if [ ! -f /tmp/.vision-ready ]; then
  for i in \$(seq 1 30); do
    [ -f /tmp/.vision-ready ] && break
    sleep 3
  done
fi

if [ ! -f /tmp/.vision-ready ]; then
  echo "VISION_SELF_INSTALL"
  sudo sysctl -w vm.overcommit_memory=1 >/dev/null 2>&1
  mkdir -p /tmp/pw-vision && cd /tmp/pw-vision
  [ -f package.json ] || npm init -y >/dev/null 2>&1
  npm i playwright-core --no-audit --no-fund >/dev/null 2>&1
  npx playwright-core install chromium-headless-shell >/dev/null 2>&1
  sudo npx playwright-core install-deps chromium >/dev/null 2>&1
  touch /tmp/.vision-ready
fi

# overcommit must be on even if the warm-up path set the marker earlier
sudo sysctl -w vm.overcommit_memory=1 >/dev/null 2>&1

cat > /tmp/pw-vision/shot.js <<'PWEOF'
const { chromium } = require('/tmp/pw-vision/node_modules/playwright-core');
(async () => {
  const ports = [5173, 3000, 4173];
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await (await b.newContext({ viewport: { width: __W__, height: __H__ } })).newPage();
  for (const port of ports) {
    try {
      console.log('TRYING_PORT:' + port);
      await page.goto('http://localhost:' + port + '/', { waitUntil: 'networkidle', timeout: 12000 });
      const buf = await page.screenshot({ type: 'png' });
      console.log('USED_PORT:' + port);
      console.log('BASE64:' + buf.toString('base64'));
      console.log('SCREENSHOT_OK');
      await b.close();
      process.exit(0);
    } catch (e) {
      console.log('PORT_FAILED:' + port + ':' + String((e && e.message) || e).slice(0, 80));
    }
  }
  console.log('ALL_PORTS_FAILED');
  await b.close();
  process.exit(0);
})().catch((e) => { console.log('VISION_DRIVER_ERROR:' + String(e).slice(0, 150)); process.exit(0); });
PWEOF
sed -i "s/__W__/${width}/; s/__H__/${height}/" /tmp/pw-vision/shot.js
timeout 90 node /tmp/pw-vision/shot.js
tail -3 /tmp/vision-setup.log 2>/dev/null | sed 's/^/SETUP_LOG:/'
`;

          /*
           * runInE2B requires a files map (it syncs files to the sandbox).
           * Pass an empty object — the files are already in the sandbox from
           * the Builder's write_file calls. We don't need to re-sync.
           */
          const result = await runInE2B(jobId, script, {} as Record<string, string>);
          const output = (result as any)?.stdout ?? '';

          if (!output.includes('SCREENSHOT_OK')) {
            return {
              ok: false,
              error: 'Screenshot capture failed. Make sure the dev server is running (run_shell("npm run dev") first).',
              rawOutput: output.slice(0, 1000),
            };
          }

          const base64Match = output.match(/BASE64:([A-Za-z0-9+/=]+)/);
          const base64 = base64Match?.[1];

          if (!base64 || base64.length < 100) {
            return {
              ok: false,
              error: 'Screenshot captured but no image data returned.',
              rawOutput: output.slice(0, 1000),
            };
          }

          // Emit the screenshot to the UI so the user sees what the model sees
          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `📸 Screenshot captured (${vp})`,
            {
              agent: 'Builder',
              kind: 'screenshot_captured',
              dataUrl: `data:image/png;base64,${base64}`,
              viewport: vp,
              isScreenshot: true,
            },
          );

          // Analyze with the VLM — use the user's chosen Vision model
          const visionKey = media?.visionApiKey || media?.apiKey || '';

          if (!visionKey) {
            return {
              ok: true,
              screenshot: '<shown in stream>',
              analysis: '(No vision API key configured — screenshot was captured but not analyzed. Configure a Vision model in Settings to enable visual analysis.)',
              viewport: vp,
            };
          }

          // Use the user's configured vision model (BYOK via provider-registry)
          // Falls back to Z.ai SDK if BYOK fails or isn't configured
          const analysis = await analyzeScreenshot(base64, question, {
            model: media?.visionModel,
            apiKey: media?.visionApiKey || media?.apiKey,
            provider: media?.visionProvider,
          });

          if (!analysis.ok) {
            return {
              ok: true,
              screenshot: '<shown in stream>',
              analysis: `(Vision analysis failed: ${analysis.raw}. Screenshot was captured and is visible in the stream.)`,
              viewport: vp,
            };
          }

          // Emit the analysis to the UI
          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `👁️ Vision: ${analysis.description.slice(0, 150)}…`,
            {
              agent: 'Builder',
              kind: 'vision_analysis',
              text: analysis.description,
              isVisionAnalysis: true,
              viewport: vp,
            },
          );

          return {
            ok: true,
            screenshot: '<shown in stream>',
            analysis: analysis.description,
            viewport: vp,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[agent] analyze_screenshot failed: ${msg}`);
          return { ok: false, error: msg };
        }
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // generate_video — Generate a looping video asset for hero backgrounds (RADICAL REBUILD)
    // ═══════════════════════════════════════════════════════════════════
    // There was NO video generation capability in Palmkit. The user asked
    // for "a video of a person coding as a hero background, looped" and
    // the model couldn't even attempt it.
    //
    // This tool calls the Z.ai video generation API (or OpenRouter fallback)
    // and returns an importable MP4 module. The Builder writes:
    //   import heroBg from './assets/hero-coding-bg';
    //   <video src={heroBg} autoPlay muted loop playsinline />
    generate_video: tool({
      description:
        'Generate a short looping video asset (2-10s) for use as a hero background, animated illustration, ' +
        'or ambient motion. Provide a detailed prompt describing the scene, camera motion, lighting, and mood. ' +
        'The video is saved as an importable MP4 module — use it as ' +
        '<video src={importedVideo} autoPlay muted loop playsinline>. ' +
        'Use this for hero backgrounds (e.g. "person coding at a desk"), ambient motion, or anywhere a still image would feel static. ' +
        'Requires a Z.ai API key configured in Settings.',
      parameters: z.object({
        name: z
          .string()
          .describe('kebab-case asset name, e.g. "hero-coding-bg". The file is saved as src/assets/{name}.ts'),
        prompt: z
          .string()
          .describe(
            'Detailed video description: subject, camera motion, lighting, mood. ' +
              'Example: "A developer typing code on a laptop in a dimly-lit room, slow cinematic dolly forward, warm amber light, 16:9".',
          ),
        duration: z
          .union([z.number(), z.string()])
          .optional()
          .describe('Duration in seconds (2-10). Default: 5. Shorter = faster generation. Can be a number or string.'),
        aspectRatio: z
          .union([z.enum(['16:9', '9:16', '1:1']), z.string()])
          .optional()
          .describe('Aspect ratio. Use 16:9 for hero backgrounds, 9:16 for mobile, 1:1 for squares.'),
      }),
      execute: async (args) => {
        const name: string = String(args.name || 'video-asset');
        const prompt: string = String(args.prompt || '');
        const durationNum = typeof args.duration === 'string' ? parseInt(args.duration, 10) : args.duration;
        const duration = Math.min(10, Math.max(2, Number(durationNum) || 5));
        const aspectRatio = (typeof args.aspectRatio === 'string' && ['16:9', '9:16', '1:1'].includes(args.aspectRatio)
          ? args.aspectRatio
          : '16:9') as '16:9' | '9:16' | '1:1';
        const safe = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

        if (!media?.videoApiKey && !media?.apiKey) {
          return {
            ok: false,
            error:
              'Video generation requires an API key. Configure a Media model in Settings. ' +
                'If you do not have one, use generate_image for a still hero background instead, or use a CSS animation.',
          };
        }

        await emitEvent(supabase, jobId, 'file_chunk' as any, `🎬 Generating video "${safe}"…`, {
          agent: 'Builder',
          kind: 'video_start',
          name: safe,
        });

        try {
          const video = await generateVideo({
            apiKey: media.videoApiKey || media.apiKey,
            model: media.videoModel || 'cogvideox-2b',
            prompt,
            duration: duration ?? 5,
            aspectRatio: aspectRatio ?? '16:9',
            provider: media.videoProvider || 'zai',
          });

          // Fetch the MP4 bytes and store as a base64 data-URI ES module
          // (same pattern as generate_image — the asset is bundled into the app)
          const resp = await fetch(video.url);

          if (!resp.ok) {
            throw new Error(`Failed to fetch video: ${resp.status}`);
          }

          const buf = Buffer.from(await resp.arrayBuffer());
          const dataUri = `data:video/mp4;base64,${buf.toString('base64')}`;
          const modulePath = `src/assets/${safe}.ts`;
          const mod = `const src = ${JSON.stringify(dataUri)};\nexport default src;\n`;

          await registerFile(modulePath, mod);

          // Also emit the data URI so the stream can preview the video inline
          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `🎬 Video "${safe}" ready (${(buf.length / 1024 / 1024).toFixed(1)}MB, ${video.duration}s)`,
            {
              agent: 'Brain',
              kind: 'video_ready',
              name: safe,
              url: video.url,
              dataUrl: dataUri,
              sizeBytes: buf.length,
              duration: video.duration,
              isVideo: true,
            },
          );

          return {
            ok: true,
            path: modulePath,
            importAs: safe,
            duration: video.duration,
            aspectRatio: video.aspectRatio,
            usage: `import ${safe.replace(/-/g, '_')} from './assets/${safe}';\n// then: <video src={${safe.replace(/-/g, '_')}} autoPlay muted loop playsinline />`,
            message: `Video generated and saved. It's visible in the stream — the user can see it and request changes if needed.`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`[agent] generate_video "${safe}" failed: ${msg}`);
          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `⚠️ Video "${safe}" failed: ${msg.slice(0, 120)}`,
            { agent: 'Builder', kind: 'video_error', name: safe, error: msg },
          );
          return {
            ok: false,
            error: msg,
            fallback:
              'Video generation failed. Use generate_image to create a still hero background instead, ' +
              'then apply a CSS animation (e.g. ken-burns zoom, parallax, or gradient shift) to give it motion. ' +
              'Example: <div className="hero-bg" style={{backgroundImage: `url(${heroImg})`, animation: "kenburns 20s infinite alternate"}} />',
          };
        }
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
        'Ask the user a clarifying question. Use sparingly — only when a missing detail would make the build fail or produce a wrong result. The user sees the question in the chat stream. If they do not answer in time, proceed with sensible defaults. IMPORTANT: Do NOT use this tool if the user is asking YOU to make a change — just make the change directly.',
      parameters: z.object({
        question: z.string().describe('The question to ask the user (keep it short, one sentence).'),
        options: z
          .array(z.string())
          .optional()
          .describe('Optional list of suggested answers the user can pick from.'),
        default_choice: z
          .string()
          .optional()
          .describe('What you will do if the user does not answer. Proceed with this. If omitted, you will proceed with your best judgment.'),
      }),
      execute: async (args) => {
        const { question, options, default_choice } = args;
        const fallback = default_choice ?? 'Proceeding with best judgment based on the request.';

        try {
          await emitEvent(supabase, jobId, 'file_chunk', `❓ ${question}`, {
            agent: 'Planner',
            kind: 'question',
            question,
            options: options ?? [],
            defaultChoice: fallback,
          });
        } catch {
          /* best-effort */
        }

        return {
          answered: false,
          answer: fallback,
          message: `User has not answered yet. Proceeding with: ${fallback}`,
        };
      },
    }),

    // ═══════════════════════════════════════════════════════════════════
    // spawn_subagent — Launch a sub-agent with a specific task (RADICAL REBUILD)
    // ═══════════════════════════════════════════════════════════════════
    // The brain can delegate focused tasks to sub-agents. Each sub-agent
    // runs independently with its own context, then returns a text result
    // to the brain. The brain decides WHEN and WHETHER to use sub-agents.
    //
    // Use cases:
    //   - "Analyze this error and suggest a fix" (complex error diagnosis)
    //   - "Read all files and summarize the architecture" (codebase understanding)
    //   - "Design the data model for this e-commerce app" (planning)
    //   - "Test these specific features and report issues" (focused testing)
    //
    // Sub-agents have READ-ONLY tools (read_file, list_files, search_code,
    // run_shell) — they CANNOT write or edit files. They return analysis/
    // suggestions as text. The brain acts on their findings.
    spawn_subagent: tool({
      description:
        'Launch a sub-agent to handle a focused task. The sub-agent runs independently and returns a text result. ' +
        'Use this for complex analysis, codebase understanding, error diagnosis, or design planning. ' +
        'The sub-agent has read-only tools (read_file, list_files, search_code, run_shell) — it analyzes and reports, but cannot write files. ' +
        'Do NOT use this for simple tasks — only delegate when the task benefits from focused analysis.',
      parameters: z.object({
        task: z
          .string()
          .describe('A clear, specific task for the sub-agent. Example: "Read all source files and summarize the component structure and data flow."'),
        context: z
          .string()
          .optional()
          .describe('Additional context for the task — e.g. an error message to analyze, or a specific file to focus on.'),
      }),
      execute: async ({ task, context }) => {
        if (!model) {
          return {
            ok: false,
            error: 'Sub-agent requires a model instance. This should not happen — report it.',
          };
        }

        const subAgentId = `subagent-${Date.now()}`;
        logger.info(`[agent] spawn_subagent: ${task.slice(0, 100)}`);

        // Emit start event so the UI shows the sub-agent in the stream
        await emitEvent(
          supabase,
          jobId,
          'file_chunk' as any,
          `🔄 Sub-agent: ${task.slice(0, 120)}`,
          {
            agent: 'Brain',
            kind: 'subagent_start',
            task,
            subAgentId,
          },
        );

        try {
          // Build a focused read-only toolset for the sub-agent.
          // These are standalone implementations that don't depend on the
          // outer tool object — they read from the same projectFiles map.
          const subTools = {
            read_file: tool({
              description: 'Read a file from the project',
              parameters: z.object({ path: z.string() }),
              execute: async (args: any) => {
                const path = args.path;
                let content: string | undefined = projectFiles.get(path);
                if (!content) {
                  try {
                    const fetched = await getFileText(buildWorkspaceKey(projectId, path));
                    if (fetched) {
                      content = fetched;
                      projectFiles.set(path, content);
                    }
                  } catch { /* not found */ }
                }
                return {
                  path,
                  content: content || '',
                  size: content?.length || 0,
                  lines: content?.split('\n').length || 0,
                };
              },
            }),
            list_files: tool({
              description: 'List all files in the project',
              parameters: z.object({}),
              execute: async () => {
                const files = Array.from(projectFiles.entries()).map(([path, content]) => ({
                  path,
                  size: content.length,
                  lines: content.split('\n').length,
                }));
                return { totalFiles: files.length, files };
              },
            }),
            search_code: tool({
              description: 'Search for a pattern across all files',
              parameters: z.object({ pattern: z.string() }),
              execute: async (args: any) => {
                const pattern = args.pattern;
                const results: any[] = [];
                let regex: RegExp;
                try {
                  regex = new RegExp(pattern, 'gi');
                } catch {
                  const lower = pattern.toLowerCase();
                  for (const [path, content] of projectFiles) {
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                      if (lines[i].toLowerCase().includes(lower)) {
                        results.push({ path, line: i + 1, text: lines[i].trim().slice(0, 200) });
                        if (results.length >= 50) break;
                      }
                    }
                    if (results.length >= 50) break;
                  }
                  return { pattern, totalMatches: results.length, results };
                }
                for (const [path, content] of projectFiles) {
                  const lines = content.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    regex.lastIndex = 0;
                    if (regex.test(lines[i])) {
                      results.push({ path, line: i + 1, text: lines[i].trim().slice(0, 200) });
                      if (results.length >= 50) break;
                    }
                  }
                  if (results.length >= 50) break;
                }
                return { pattern, totalMatches: results.length, results };
              },
            }),
            run_shell: tool({
              description: 'Run a shell command in the sandbox',
              parameters: z.object({ command: z.string() }),
              execute: async (args: any) => {
                const files = Object.fromEntries(projectFiles);
                const result = await runInE2B(jobId, args.command, files);
                return {
                  command: args.command,
                  exitCode: result.exitCode,
                  stdout: (result.stdout || '').slice(0, 3000),
                  stderr: (result.stderr || '').slice(0, 2000),
                  success: result.exitCode === 0,
                };
              },
            }),
          };

          const subSystemPrompt = `You are a focused sub-agent. You have been given a specific task by the main agent.

Your task: ${task}
${context ? `\nAdditional context:\n${context}` : ''}

You have read-only tools: read_file, list_files, search_code, run_shell.
You CANNOT write or edit files — you analyze and report.

Do your task thoroughly, then return a clear, concise report with your findings.
Do NOT call done() — just return your findings as your final message.`;

          const result = await streamText({
            model,
            system: subSystemPrompt,
            prompt: task,
            tools: subTools as any,
            maxSteps: 10,
            maxTokens: 8000,
            temperature: 0.3,
          });

          const subAgentText = await result.text;
          const subAgentSteps = await result.steps;
          const subAgentDuration = Date.now();

          logger.info(`[agent] spawn_subagent completed: ${subAgentText.length} chars, ${subAgentSteps?.length || 0} steps`);

          // Emit completion event with the result
          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `✅ Sub-agent done: ${task.slice(0, 80)}`,
            {
              agent: 'Brain',
              kind: 'subagent_complete',
              task,
              subAgentId,
              result: subAgentText.slice(0, 2000),
              steps: subAgentSteps?.length || 0,
            },
          );

          return {
            ok: true,
            task,
            result: subAgentText,
            steps: subAgentSteps?.length || 0,
            message: `Sub-agent completed: ${task}`,
          };
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          logger.error(`[agent] spawn_subagent failed: ${msg}`);

          await emitEvent(
            supabase,
            jobId,
            'file_chunk' as any,
            `⚠️ Sub-agent failed: ${msg.slice(0, 120)}`,
            {
              agent: 'Brain',
              kind: 'subagent_error',
              task,
              subAgentId,
              error: msg,
            },
          );

          return {
            ok: false,
            task,
            error: msg,
            message: `Sub-agent failed: ${msg}`,
          };
        }
      },
    }),
  };
}
