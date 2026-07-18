/**
 * Sub-Agent Worker — runs in a separate Worker Thread (true isolation).
 *
 * This mirrors how Z.ai Code's Task tool works: each sub-agent gets its
 * own process/thread with a clean context window, independent rate limit,
 * and the ability to write directly to shared storage (R2).
 *
 * The main orchestrator creates this worker via `new Worker(...)`, sends
 * a task, and receives the result — without blocking the main stream.
 *
 * Architecture:
 *   Main orchestrator (streamText) → postMessage({task, config})
 *     → Worker Thread (this file)
 *       → streamText with clean context
 *       → write_file → R2 (shared workspace)
 *       → postMessage({result}) back to main
 *     → Main continues (non-blocking)
 */
import { streamText } from 'ai';
import { putFile, getFileText, buildWorkspaceKey } from './r2-client';
import { createClient } from '@supabase/supabase-js';
import { tool } from 'ai';
import { z } from 'zod';
import { logger } from './logger';

export interface SubAgentTask {
  jobId: string;
  projectId: string;
  task: string;
  context?: string;
  modelConfig: {
    provider: string;
    model: string;
    apiKey: string;
    reasoningEffort?: 'off' | 'medium' | 'max';
  };
  supabaseConfig: {
    url: string;
    serviceKey: string;
  };
  r2Config: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
}

export interface SubAgentResult {
  ok: boolean;
  task: string;
  result?: string;
  error?: string;
  filesWritten: string[];
  timedOut: boolean;
}

const SUB_AGENT_TIMEOUT_MS = 600_000; // 10 min — sub-agents write 5-8 files, need more time

/**
 * Run a sub-agent in a Worker Thread.
 *
 * In Bun, Worker Threads are created via `new Worker(path)`.
 * This function is the entry point — it receives a task, runs streamText
 * with a clean context, writes files to R2, and returns the result.
 */
export async function runSubAgentWorker(task: SubAgentTask): Promise<SubAgentResult> {
  const { jobId, projectId, task: taskText, context, modelConfig, supabaseConfig, r2Config } = task;

  // Create isolated Supabase client for this worker
  const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const filesWritten: string[] = [];

  // Sub-agent tools — WRITE-CAPABLE, isolated from main agent
  const subTools = {
    write_file: tool({
      description: 'Write a file to the project. Content MUST be a raw string.',
      parameters: z.object({
        path: z.string(),
        content: z.any(),
      }),
      execute: async (args: any) => {
        const path = args.path;
        let fileContent: string = typeof args.content === 'string' ? args.content : JSON.stringify(args.content, null, 2);

        // Write to R2 (shared workspace — main agent can read immediately)
        try {
          const r2Key = buildWorkspaceKey(projectId, path);
          await putFile(r2Key, fileContent);
          filesWritten.push(path);

          // Write manifest row (live manifest — ensures edit path finds files)
          await supabase
            .from('project_files_manifest')
            .delete()
            .eq('job_id', jobId)
            .eq('path', path);

          await supabase.from('project_files_manifest').insert({
            job_id: jobId,
            project_id: null,
            user_id: null,
            path,
            version: 1,
            hash: '',
            size_bytes: new TextEncoder().encode(fileContent).length,
            mime_type: 'text/plain',
            storage_provider: 'r2',
            storage_key: r2Key,
            integrity: 'complete',
          });

          // Emit event so frontend sees the file
          await supabase.from('job_events').insert({
            job_id: jobId,
            type: 'file_written',
            seq: Date.now(),
            message: `[sub-agent] ${path} (${fileContent.split('\n').length} lines)`,
            payload: { filePath: path, lines: fileContent.split('\n').length, size: fileContent.length },
          });
        } catch (e) {
          logger.warn(`[sub-agent-worker] write_file failed for ${path}: ${e}`);
        }

        return { success: true, path, size: fileContent.length };
      },
    }),

    write_files: tool({
      description: 'Write MULTIPLE files in ONE call.',
      parameters: z.object({ files: z.any() }),
      execute: async (args: any) => {
        let fileList: any[] = Array.isArray(args.files) ? args.files : [args.files];
        let written = 0;
        for (const f of fileList) {
          const path = f.path;
          let content = typeof f.content === 'string' ? f.content : JSON.stringify(f.content, null, 2);
          try {
            const r2Key = buildWorkspaceKey(projectId, path);
            await putFile(r2Key, content);
            filesWritten.push(path);
            written++;

            await supabase
              .from('project_files_manifest')
              .delete()
              .eq('job_id', jobId)
              .eq('path', path);

            await supabase.from('project_files_manifest').insert({
              job_id: jobId,
              project_id: null,
              user_id: null,
              path,
              version: 1,
              hash: '',
              size_bytes: new TextEncoder().encode(content).length,
              mime_type: 'text/plain',
              storage_provider: 'r2',
              storage_key: r2Key,
              integrity: 'complete',
            });

            await supabase.from('job_events').insert({
              job_id: jobId,
              type: 'file_written',
              seq: Date.now() + written,
              message: `[sub-agent] ${path} (${content.split('\n').length} lines)`,
              payload: { filePath: path, lines: content.split('\n').length },
            });
          } catch (e) {
            logger.warn(`[sub-agent-worker] write_files failed for ${path}: ${e}`);
          }
        }
        return { success: true, written, total: fileList.length };
      },
    }),

    read_file: tool({
      description: 'Read a file from the project (R2 source of truth).',
      parameters: z.object({ path: z.string() }),
      execute: async (args: any) => {
        try {
          const r2Key = buildWorkspaceKey(projectId, args.path);
          const content = await getFileText(r2Key);
          return { path: args.path, content: content || '', size: content?.length || 0 };
        } catch {
          return { path: args.path, content: '', error: 'File not found' };
        }
      },
    }),

    list_files: tool({
      description: 'List all files in the project from R2.',
      parameters: z.object({}),
      execute: async () => {
        // List from R2 by checking manifest
        const { data } = await supabase
          .from('project_files_manifest')
          .select('path')
          .eq('job_id', jobId)
          .order('path');
        const files = (data || []).map((r: any) => ({ path: r.path }));
        return { totalFiles: files.length, files };
      },
    }),
  };

  const subSystemPrompt = `You are a focused sub-agent working inside a Palmkit build.
Your task: ${taskText}
${context ? `\nAdditional context:\n${context}` : ''}

You have WRITE-CAPABLE tools: write_file, write_files, read_file, list_files.
Files you write go directly into the shared project workspace (R2) — the main agent and other sub-agents can see them immediately.

Rules:
- File content is ALWAYS a raw string (never JSON, never arrays).
- Write COMPLETE files (no placeholders, no "rest stays the same").
- Use write_files (batch) when writing 2+ files.
- Do NOT call done() — just write the files and return a summary.

When done, return a brief summary of what you wrote.`;

  // Create model instance
  const { getModelInstance } = await import('./provider-registry');
  const model = getModelInstance(
    modelConfig.provider,
    modelConfig.model,
    modelConfig.apiKey,
    { reasoningEffort: modelConfig.reasoningEffort || 'off' },
  );

  // Run streamText with Promise.race timeout (AbortController doesn't work in Bun)
  try {
    const subAgentPromise = (async () => {
      const result = await streamText({
        model,
        system: subSystemPrompt,
        prompt: taskText,
        tools: subTools as any,
        maxSteps: 40,
        maxTokens: 16000,
        temperature: 0.3,
      });
      const text = await result.text;
      const steps = await result.steps;
      return { text, steps };
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('SUB_AGENT_TIMEOUT')), SUB_AGENT_TIMEOUT_MS);
    });

    const { text: subAgentText } = await Promise.race([subAgentPromise, timeoutPromise]);

    logger.info(`[sub-agent-worker] completed: ${subAgentText.length} chars, ${filesWritten.length} files written`);

    return {
      ok: true,
      task: taskText,
      result: subAgentText,
      filesWritten,
      timedOut: false,
    };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const isTimeout = msg.includes('SUB_AGENT_TIMEOUT');

    if (isTimeout) {
      logger.warn(`[sub-agent-worker] timed out after ${SUB_AGENT_TIMEOUT_MS / 1000}s — ${filesWritten.length} files written before timeout`);
    } else {
      logger.error(`[sub-agent-worker] failed: ${msg}`);
    }

    return {
      ok: !isTimeout && filesWritten.length > 0, // partial success if files were written
      task: taskText,
      error: msg,
      filesWritten,
      timedOut: isTimeout,
    };
  }
}
