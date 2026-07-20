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

// In-memory file store for the current job
// Files are also written to R2 (workspace) for persistence
const projectFiles = new Map<string, string>();

export function resetProjectFiles(): void {
  projectFiles.clear();
}

export function getProjectFiles(): Record<string, string> {
  return Object.fromEntries(projectFiles);
}

export function getProjectFile(path: string): string | undefined {
  return projectFiles.get(path);
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
) {
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

        // Emit progress event
        const lines = fileContent.split('\n').length;
        await emitEvent(supabase, jobId, 'file_written' as any, `📝 ${path} (${lines} lines, ${fileContent.length} chars)`, {
          path,
          lines,
          size: fileContent.length,
        });

        logger.info(`[agent] write_file: ${path} (${fileContent.length} chars, ${lines} lines)`);

        return {
          success: true,
          path,
          size: fileContent.length,
          lines,
          message: `File ${path} written successfully (${fileContent.length} chars, ${lines} lines). Use read_file to verify if needed.`,
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
    // edit_file — Edit a specific part of a file (like Super Z's Edit)
    // ═══════════════════════════════════════════════════════════════════
    edit_file: tool({
      description:
        'Edit a specific part of a file by replacing old text with new text. ' +
        'Use this for targeted changes instead of rewriting the whole file with write_file. ' +
        'The oldText must match EXACTLY (including whitespace and indentation).',
      parameters: z.object({
        path: z.string().describe('The file path to edit'),
        oldText: z.string().describe('The exact text to find and replace (must match exactly)'),
        newText: z.string().describe('The new text to replace it with'),
      }),
      execute: async ({ path, oldText, newText }) => {
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
        const files = getProjectFiles();

        if (Object.keys(files).length === 0) {
          return { exitCode: 0, stdout: 'No files to test.', stderr: '', success: true, passed: 0, failed: 0 };
        }

        const result = await runInE2B('npm test 2>&1 || vitest run 2>&1 || jest 2>&1 || echo "No tests found"', files);

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
        const files = getProjectFiles();

        if (Object.keys(files).length === 0) {
          return { error: 'No files written yet. Build the project first.' };
        }

        // Run a screenshot command in E2B
        // Install playwright in the sandbox and take a screenshot
        const result = await runInE2B(
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
        'Run a shell command in an isolated sandbox to verify the build. Common uses: "npm install", "npm run build", ' +
        '"ls -la", "cat package.json". Returns stdout, stderr, and exit code. ' +
        'Use this to catch build errors before finishing. The sandbox has all your project files.',
      parameters: z.object({
        command: z
          .string()
          .describe('The shell command to run, e.g. "npm run build" or "ls -la"'),
      }),
      execute: async ({ command }) => {
        // Run in E2B sandbox — isolated, secure, with project files
        const files = getProjectFiles();

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

        const result = await runInE2B(command, files);

        logger.info(`[agent] run_shell (E2B): "${command}" → exit ${result.exitCode}`);

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
  };
}
