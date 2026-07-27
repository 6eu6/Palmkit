/**
 * Sub-Agent Fork Process — runs as a SEPARATE Bun process via child_process.fork.
 *
 * Unlike Worker Threads (which have node_modules resolution issues on Oracle VM),
 * fork creates a completely independent Bun process with full access to all
 * dependencies, env vars, and the file system.
 *
 * This is TRUE process isolation — like Z.ai Code's Task tool.
 */
import { streamText } from 'ai';
import { putFile, getFileText, buildWorkspaceKey } from './r2-client';
import { createClient } from '@supabase/supabase-js';
import { tool } from 'ai';
import { z } from 'zod';
import { logger } from './logger';

export interface SubAgentForkMessage {
  type: 'run';
  jobId: string;
  projectId: string;
  task: string;
  context?: string;
  provider: string;
  model: string;
  apiKey: string;
  reasoningEffort: string;
  supabaseUrl: string;
  supabaseKey: string;
}

export interface SubAgentForkResult {
  type: 'done' | 'error';
  ok: boolean;
  filesWritten: string[];
  filesVerified: string[];
  filesFailed: string[];
  result?: string;
  error?: string;
  timedOut: boolean;
}

const SUB_AGENT_TIMEOUT_MS = 300_000;

function validateFileContent(path: string, content: string): string | null {
  if (!content || content.trim().length === 0) return `${path}: empty`;
  if (/\.(jsx?|tsx?|mjs|cjs)$/i.test(path)) {
    const opens = (content.match(/{/g) || []).length;
    const closes = (content.match(/}/g) || []).length;
    if (opens !== closes) return `${path}: brace mismatch (${opens}/${closes})`;
  }
  return null;
}

export async function runInForkedProcess(msg: SubAgentForkMessage): Promise<SubAgentForkResult> {
  const { jobId, projectId, task, context, provider, model: modelName, apiKey, supabaseUrl, supabaseKey } = msg;

  logger.info(`[sub-agent-fork] starting: ${task.slice(0, 80)}`);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const filesWritten: string[] = [];
  const filesVerified: string[] = [];
  const filesFailed: string[] = [];

  async function writeProjectFile(path: string, content: string): Promise<boolean> {
    const err = validateFileContent(path, content);
    if (err) { filesFailed.push(path); return false; }
    try {
      const r2Key = buildWorkspaceKey(projectId, path);
      await putFile(r2Key, content);
      filesWritten.push(path);

      const { data: jobData } = await supabase.from('build_jobs').select('user_id').eq('id', jobId).single();
      await supabase.from('project_files_manifest').delete().eq('job_id', jobId).eq('path', path);
      await supabase.from('project_files_manifest').insert({
        job_id: jobId, project_id: null, user_id: jobData?.user_id || null,
        path, version: 1, hash: '', size_bytes: new TextEncoder().encode(content).length,
        mime_type: 'text/plain', storage_provider: 'r2', storage_key: r2Key, integrity: 'complete',
      });

      const lines = content.split('\n').length;
      await supabase.from('job_events').insert({
        job_id: jobId, type: 'file_written', seq: Date.now() + Math.random(),
        message: `[sub-agent] ${path} (${lines} lines)`,
        payload: { filePath: path, lines, size: content.length, source: 'sub-agent' },
      });

      const readBack = await getFileText(r2Key);
      if (readBack) filesVerified.push(path);
      logger.info(`[sub-agent-fork] wrote ${path} (${lines} lines)`);
      return true;
    } catch (e: any) {
      filesFailed.push(path);
      logger.warn(`[sub-agent-fork] write failed for ${path}: ${e?.message}`);
      return false;
    }
  }

  const subTools = {
    write_file: tool({
      description: 'Write a file. Content MUST be a raw string.',
      parameters: z.object({ path: z.string(), content: z.any() }),
      execute: async (args: any) => {
        const content = typeof args.content === 'string' ? args.content : JSON.stringify(args.content, null, 2);
        const ok = await writeProjectFile(args.path, content);
        return { success: ok, path: args.path, lines: content.split('\n').length };
      },
    }),
    write_files: tool({
      description: 'Write MULTIPLE files. PREFERRED for 2+.',
      parameters: z.object({ files: z.any() }),
      execute: async (args: any) => {
        const fileList = Array.isArray(args.files) ? args.files : [args.files];
        let written = 0;
        for (const f of fileList) {
          const content = typeof f.content === 'string' ? f.content : JSON.stringify(f.content, null, 2);
          if (await writeProjectFile(f.path, content)) written++;
        }
        return { success: true, written, total: fileList.length };
      },
    }),
    read_file: tool({
      description: 'Read a file from R2.',
      parameters: z.object({ path: z.string() }),
      execute: async (args: any) => {
        const content = await getFileText(buildWorkspaceKey(projectId, args.path));
        return { path: args.path, content: content || '', exists: !!content };
      },
    }),
    list_files: tool({
      description: 'List all files.',
      parameters: z.object({}),
      execute: async () => {
        const { data } = await supabase.from('project_files_manifest').select('path').eq('job_id', jobId).order('path');
        return { totalFiles: (data||[]).length, files: (data||[]).map((r:any)=>({path:r.path})) };
      },
    }),
  };

  const systemPrompt = `You are an INTELLIGENT sub-agent. Write COMPLETE files (200-400+ lines each).
TASK: ${task}
${context ? `\nCONTEXT:\n${context}` : ''}
Rules: content is raw string, write complete files, use write_files for 2+, verify with read_file.`;

  const { getModelInstance } = await import('./provider-registry');
  const model = getModelInstance(provider, modelName, apiKey, { reasoningEffort: msg.reasoningEffort as any || 'off' });

  const abortController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try { abortController.abort(); } catch {}
  }, SUB_AGENT_TIMEOUT_MS);

  try {
    const result = await streamText({
      model,
      system: systemPrompt,
      prompt: task,
      tools: subTools as any,
      maxSteps: 20,
      maxTokens: 16000,
      temperature: 0.3,
      abortSignal: abortController.signal,
    });

    const text = await result.text;
    clearTimeout(timeoutId);

    logger.info(`[sub-agent-fork] completed: ${filesWritten.length} files, ${filesVerified.length} verified`);

    return {
      type: 'done',
      ok: filesWritten.length > 0,
      filesWritten, filesVerified, filesFailed,
      result: text || `Wrote ${filesWritten.length} files`,
      timedOut: false,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = timedOut || (err?.message||'').includes('abort');
    logger.warn(`[sub-agent-fork] ${isTimeout?'timed out':'failed'}: ${filesWritten.length} files written`);
    return {
      type: isTimeout ? 'done' : 'error',
      ok: filesWritten.length > 0,
      filesWritten, filesVerified, filesFailed,
      error: err?.message,
      result: isTimeout ? `Timed out — ${filesWritten.length} files written` : undefined,
      timedOut: isTimeout,
    };
  }
}

// ─── Entry point: reads task from file argument, writes result to stdout ───
// Usage: bun run sub-agent-fork.ts /tmp/subagent-task-xxx.json
// The task JSON is passed as a file path argument.
// Result is written to stdout as JSON.
if (typeof process !== 'undefined' && process.argv[2]) {
  const taskFile = process.argv[2];
  try {
    const fs = await import('fs');
    const taskData = JSON.parse(fs.readFileSync(taskFile, 'utf-8')) as SubAgentForkMessage;

    if (taskData.type === 'run') {
      const result = await runInForkedProcess(taskData);
      // Write result to stdout as JSON (last line)
      console.log(JSON.stringify(result));
      process.exit(0);
    }
  } catch (err: any) {
    console.log(JSON.stringify({
      type: 'error', ok: false,
      filesWritten: [], filesVerified: [], filesFailed: [],
      error: err?.message || String(err), timedOut: false,
    }));
    process.exit(1);
  }
}
