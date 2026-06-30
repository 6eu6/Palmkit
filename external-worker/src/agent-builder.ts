/**
 * Agent Builder — Replaces orchestrator + decomposer + generator
 *
 * This is the SIMPLEST possible agentic build system:
 * 1. Give the LLM the full prompt
 * 2. Give it tools: write_file, read_file, list_files, run_shell, done
 * 3. Let it work freely — no JSON, no XML, no format constraints
 * 4. It writes files, verifies them, fixes issues, and calls done()
 *
 * This is EXACTLY how Super Z works in its CLI:
 * - Super Z gets a prompt
 * - Super Z uses Write, Read, Bash tools
 * - Super Z decides what to do
 * - Super Z works until done
 *
 * The LLM is the agent. We just provide the tools.
 */

import { generateText, type LanguageModelV1 } from 'ai';
import { createAgentTools, resetProjectFiles, getProjectFiles } from './agent-tools';
import { logger } from './logger';
import { emitEvent } from './event-emitter';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FileOperation } from './generator';
import { readWorklog, appendToWorklog, readManifest, writeManifest, generateWorklogEntry } from './workspace-manager';

export interface AgentBuildResult {
  success: boolean;
  files: FileOperation[];
  rawText: string;
  totalDuration: number;
}

/**
 * Run an agentic build using streamText + tools.
 *
 * The LLM receives:
 * - The FULL original prompt (no truncation, ever)
 * - The project's worklog (memory from previous builds) — if it exists
 * - A system prompt explaining the tools
 * - Tools: write_file, read_file, list_files, run_shell, done
 *
 * The LLM decides:
 * - How many files to create
 * - What order to create them
 * - When to verify (read_file after write_file)
 * - When to test (run_shell for npm build)
 * - When it's done (calls done() tool)
 *
 * After the build:
 * - The worklog is updated with a summary of what was built
 * - The manifest is updated with the new file count and timestamps
 *
 * We track progress via emitEvent — the user sees real-time updates.
 */
export async function runAgentBuild(
  prompt: string,
  model: LanguageModelV1,
  jobId: string,
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  maxCompletionTokens?: number,
  appType?: string,
): Promise<AgentBuildResult> {
  const startTime = Date.now();
  resetProjectFiles();

  logger.info(`[agent] Starting agentic build for job ${jobId} (project ${projectId})`);

  // Read the worklog (project memory) — this gives the agent context from
  // previous builds on the same project.
  const worklog = await readWorklog(projectId);
  const hasWorklog = !!worklog;

  if (hasWorklog) {
    logger.info(`[agent] Found worklog for ${projectId} (${worklog!.length} chars) — injecting into context`);
  }

  // Create the tools for this job
  const tools = createAgentTools(jobId, supabase, projectId);

  // System prompt — explains the tools and sets expectations.
  // If a worklog exists, include it so the agent has context.
  const systemPrompt = `You are an expert web developer working in a unified workspace.

YOUR WORKSPACE:
The project has a unified workspace at projects/{projectId}/workspace/.
You can read existing files from previous builds using read_file, and
write new files or update existing ones using write_file.

AVAILABLE TOOLS:
- write_file(path, content): Write a file. Creates or overwrites.
  Use for: source code, config files, data files, downloads, database schemas.
- read_file(path): Read a file from the workspace (memory or R2).
  Can read: source files, user uploads, config files, previous builds.
- list_files(): List all files you've written in this session.
- list_uploads(): List files the user has uploaded (in uploads/ folder).
  Use this first to see if the user provided any files to work with.
- run_shell(command): Run a shell command in an isolated E2B sandbox.
  The sandbox has ALL your project files at /home/user/project.
  Supports: npm install, npm run build, npx prisma generate, npx prisma db push,
  python scripts, ls, cat, grep, find, and any other shell command.
  The sandbox is ephemeral (destroyed after the command) — don't rely on
  state persisting between commands.
- done(summary): Call when ALL files are written and the project is complete.

WORKSPACE STRUCTURE:
- src/              : Source code (components, pages, utils)
- public/           : Static files (index.html, images, favicon)
- uploads/          : Files uploaded by the user (read-only for you)
  → Use list_uploads() to see what's there, then read_file to access them
- downloads/        : Generated outputs for the user to download
  → Write files here that the user should download (ZIP, PDF, CSV, etc.)
- data/             : Database files
  - schema.prisma   : Prisma schema (if the project needs a database)
  - db.sqlite       : SQLite database (created by running prisma db push)
- worklog.md        : Project memory (you read this, the system writes to it)
- manifest.json     : Project metadata (managed by the system)

HOW TO WORK (like a senior developer):
1. Read the worklog (if provided below) to understand project history
2. Call list_uploads() to check if the user provided any files
3. If editing an existing project, use read_file to see current files
4. Plan what files you need to create or modify
5. Write each file with COMPLETE content — no placeholders, no truncation
6. If the project needs a database:
   a. Create data/schema.prisma with your Prisma schema
   b. Add prisma and @prisma/client to package.json dependencies
   c. Add a datasource block pointing to file:./data/db.sqlite
   d. Use run_shell("npx prisma generate && npx prisma db push") to create the DB
7. Use run_shell to verify: "npm install && npm run build" or similar
8. When ALL files are written and verified, call done()

CRITICAL RULES:
- Write COMPLETE file content — no placeholders, no "...", no truncation
- Include ALL specific text, numbers, names, URLs from the user's request
- Create ALL files needed for the project to work
- If the user asks for specific features, include them ALL
- Call done() only when you're confident the project is complete
- Use run_shell to verify builds — don't just assume it works
- For JSON files (package.json), pass the content as a JSON object, not a string

DATABASE SUPPORT:
If the user asks for a project with a database (e.g., "todo app with persistence"):
1. Create data/schema.prisma:
   \`\`\`prisma
   datasource db {
     provider = "sqlite"
     url      = "file:./data/db.sqlite"
   }
   generator client {
     provider = "prisma-client-js"
   }
   model Todo {
     id        Int      @id @default(autoincrement())
     title     String
     completed Boolean  @default(false)
     createdAt DateTime @default(now())
   }
   \`\`\`
2. Add to package.json: "prisma": "^5.0.0" and "@prisma/client": "^5.0.0"
3. Run: run_shell("cd /home/user/project && npm install && npx prisma generate && npx prisma db push")
4. In the app code, import { PrismaClient } from '@prisma/client' and use it

You are free to decide:
- How many files to create
- What order to create them
- Whether to verify after each file
- Whether to run build tests (recommended for complex projects)

Work methodically and include every detail from the user's request.${
    hasWorklog
      ? `

═══════════════════════════════════════════════════════════════════
PROJECT MEMORY (worklog.md)
═══════════════════════════════════════════════════════════════════
This project has been built before. Here is the worklog from previous builds.
Use this to understand the project's history and avoid repeating work.

${worklog}

═══════════════════════════════════════════════════════════════════
END OF PROJECT MEMORY
═══════════════════════════════════════════════════════════════════

If the user's request is an edit or continuation, read the existing files
with read_file before modifying them. If it's a new build, you can ignore
the memory above.`
      : ''
  }`;

  // Keep-alive timer
  const keepAlive = setInterval(async () => {
    try {
      await emitEvent(supabase, jobId, 'file_chunk' as any,
        `⏳ Building... (${Math.round((Date.now() - startTime) / 1000)}s)`);
    } catch { /* best-effort */ }
  }, 5000);

  let fullText = '';
  let finishReason = '';

  try {
    /*
     * Use generateText (not streamText) for the multi-step agent loop.
     * generateText blocks until ALL steps complete — tool calls are
     * automatically executed and results fed back to the model for the
     * next step. This is the correct way to do multi-step tool calling
     * in Vercel AI SDK v4.
     *
     * streamText with maxSteps has issues: the stream may not properly
     * wait for tool results to be fed back, causing the agent to stall
     * after the first tool call.
     */
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: prompt, // FULL prompt, no truncation
      tools,
      maxSteps: 50, // enough for: plan → write files → verify → fix → done
      temperature: 0.7,
      /*
       * Dynamic maxTokens: use the model's actual maxCompletionTokens if
       * available, otherwise default to 16000 (enough for large files).
       * Cap at 16000 to avoid excessive token usage per step.
       */
      maxTokens: Math.min(16000, maxCompletionTokens ?? 16000),
      onStepFinish: async ({ toolCalls, text }) => {
        fullText += text + '\n';

        // Log each tool call for the user via events
        for (const tc of toolCalls) {
          const toolName = tc.toolName;
          const args = tc.args as any;

          let msg = '';
          if (toolName === 'write_file') {
            msg = `📝 Written: ${args.path} (${args.content?.length || 0} chars)`;
          } else if (toolName === 'read_file') {
            msg = `📖 Reading: ${args.path}`;
          } else if (toolName === 'list_files') {
            msg = `📋 Listing files...`;
          } else if (toolName === 'run_shell') {
            msg = `⚡ Running: ${args.command}`;
          } else if (toolName === 'done') {
            msg = `✅ ${args.summary || 'Build complete!'}`;
          }

          if (msg) {
            try {
              await emitEvent(supabase, jobId, 'file_chunk' as any, msg);
            } catch { /* best-effort */ }
          }
        }
      },
    });

    // generateText returns the final result after all steps complete
    fullText += result.text;
    finishReason = result.finishReason || 'stop';

    // Check if the LLM called done() or ran out of steps
    const files = getProjectFiles() as Record<string, string>;
    const fileCount = Object.keys(files).length;
    const success = fileCount > 0;

    logger.info(`[agent] Build finished: ${finishReason}, ${fullText.length} chars text, ${fileCount} files`);

    if (success) {
      const totalSize = Object.values(files).reduce((s: number, c: string) => s + c.length, 0);
      await emitEvent(supabase, jobId, 'file_generation_completed' as any,
        `🚀 Agent build complete: ${fileCount} files, ${totalSize} chars total`,
        { fileCount, finishReason },
      );

      // ─── Write worklog + manifest (the project's memory) ───
      // This is what makes Palmkit a "workspace" instead of just a "file generator".
      // The worklog is read at the start of the NEXT build, giving the agent context.
      try {
        const duration = Date.now() - startTime;
        const summary = fullText.slice(-500).trim() || undefined;

        const worklogEntry = generateWorklogEntry({
          prompt,
          fileCount,
          totalSize,
          summary,
          duration,
        });
        await appendToWorklog(projectId, worklogEntry, supabase, userId);

        // Update the manifest with the new build info
        const manifest = await readManifest(projectId);
        manifest.lastBuildAt = new Date().toISOString();
        manifest.lastBuildSummary = summary?.slice(0, 200) || null;
        manifest.fileCount = fileCount;
        manifest.appType = appType ?? manifest.appType;
        await writeManifest(manifest, supabase, userId);

        logger.info(`[agent] Worklog + manifest updated for ${projectId}`);
      } catch (e) {
        logger.warn(`[agent] Failed to update worklog/manifest: ${e}`);
        // Non-fatal — the build itself succeeded
      }
    } else {
      await emitEvent(supabase, jobId, 'job_failed' as any,
        `Agent build produced no files (finishReason: ${finishReason})`,
      );
    }

    // Convert to FileOperation[] format for the existing pipeline
    const fileOps: FileOperation[] = Object.entries(files).map(([path, content]) => ({
      op: 'write_file' as const,
      path,
      content,
    }));

    return {
      success,
      files: fileOps,
      rawText: `agent-build: ${fileOps.length} files`,
      totalDuration: Date.now() - startTime,
    };
  } catch (err) {
    logger.error(`[agent] Build failed: ${err instanceof Error ? err.message : String(err)}`);

    // Return whatever files were written before the error
    const errFiles = getProjectFiles() as Record<string, string>;
    const errFileOps: FileOperation[] = Object.entries(errFiles).map(([path, content]) => ({
      op: 'write_file' as const,
      path,
      content,
    }));

    return {
      success: errFileOps.length > 0,
      files: errFileOps,
      rawText: `agent-build-error: ${err instanceof Error ? err.message : String(err)}`,
      totalDuration: Date.now() - startTime,
    };
  } finally {
    clearInterval(keepAlive);
  }
}
