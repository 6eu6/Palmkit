/**
 * Sub-Agent Worker Thread — TRUE process isolation via Bun Worker.
 *
 * This file runs in a SEPARATE THREAD (not the main process).
 * It has its own:
 * - Event loop (doesn't block main agent)
 * - API connection (separate rate limit pool)
 * - Memory (no shared state with main agent)
 * - streamText instance (fully isolated)
 *
 * Communication:
 *   Main process → worker.postMessage({task, config})
 *   Worker → main.process.postMessage({result})
 *
 * Files are written to R2 (shared storage) — the main agent can
 * read them immediately via read_file (R2 is the source of truth).
 *
 * DEBUGGING: This file emits 'file_written' and 'subagent_debug' events
 * directly to Supabase so we can monitor what's happening inside the Worker
 * from the palmkit.app UI.
 */
import { streamText } from 'ai';
import { putFile, getFileText, buildWorkspaceKey } from './r2-client';
import { createClient } from '@supabase/supabase-js';
import { tool } from 'ai';
import { z } from 'zod';

// ─── Message types (main ↔ worker) ───
export interface SubAgentMessage {
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

export interface SubAgentResponse {
  type: 'done' | 'error' | 'progress';
  ok: boolean;
  filesWritten: string[];
  filesVerified: string[];
  filesFailed: string[];
  result?: string;
  error?: string;
  timedOut: boolean;
}

const SUB_AGENT_TIMEOUT_MS = 300_000; // 5 min

function validateFileContent(path: string, content: string): string | null {
  if (!content || content.trim().length === 0) return `${path}: empty`;
  if (/\.(jsx?|tsx?|mjs|cjs)$/i.test(path)) {
    const opens = (content.match(/{/g) || []).length;
    const closes = (content.match(/}/g) || []).length;
    if (opens !== closes) return `${path}: brace mismatch (${opens}/${closes})`;
  }
  return null;
}

/**
 * This function runs INSIDE the Worker Thread.
 * It receives the task, creates its own tools, runs streamText,
 * writes files to R2, and posts results back.
 */
export async function runInWorkerThread(msg: SubAgentMessage): Promise<SubAgentResponse> {
  const { jobId, projectId, task, context, provider, model: modelName, apiKey, supabaseUrl, supabaseKey } = msg;

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Debug helper — emit events to Supabase so we can monitor the Worker remotely
  const debug = async (message: string, payload?: any) => {
    try {
      await supabase.from('job_events').insert({
        job_id: jobId,
        type: 'file_chunk',
        seq: Date.now() + Math.random(),
        message: `[sub-agent] ${message.slice(0, 200)}`,
        payload: { source: 'sub-agent', ...payload },
      });
    } catch {}
  };

  await debug(`Worker started: ${task.slice(0, 80)}`, { provider, modelName });

  const filesWritten: string[] = [];
  const filesVerified: string[] = [];
  const filesFailed: string[] = [];

  async function writeProjectFile(path: string, content: string): Promise<boolean> {
    const err = validateFileContent(path, content);
    if (err) { filesFailed.push(path); await debug(`validation failed: ${err}`); return false; }
    try {
      const r2Key = buildWorkspaceKey(projectId, path);
      await putFile(r2Key, content);
      filesWritten.push(path);

      // Live manifest
      const { data: jobData } = await supabase.from('build_jobs').select('user_id').eq('id', jobId).single();
      await supabase.from('project_files_manifest').delete().eq('job_id', jobId).eq('path', path);
      await supabase.from('project_files_manifest').insert({
        job_id: jobId, project_id: null, user_id: jobData?.user_id || null,
        path, version: 1, hash: '', size_bytes: new TextEncoder().encode(content).length,
        mime_type: 'text/plain', storage_provider: 'r2', storage_key: r2Key, integrity: 'complete',
      });

      // Event
      const lines = content.split('\n').length;
      await supabase.from('job_events').insert({
        job_id: jobId, type: 'file_written', seq: Date.now() + Math.random(),
        message: `[sub-agent] ${path} (${lines} lines)`,
        payload: { filePath: path, lines, size: content.length, source: 'sub-agent' },
      });

      // Self-verify
      const readBack = await getFileText(r2Key);
      if (readBack) filesVerified.push(path);
      await debug(`wrote ${path} (${lines} lines)`);
      return true;
    } catch (e: any) {
      filesFailed.push(path);
      await debug(`write failed for ${path}: ${e?.message}`);
      return false;
    }
  }

  // ─── Sub-agent tools ───
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
      description: 'Write MULTIPLE files in ONE call. PREFERRED.',
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
      description: 'List all files in project.',
      parameters: z.object({}),
      execute: async () => {
        const { data } = await supabase.from('project_files_manifest').select('path').eq('job_id', jobId).order('path');
        return { totalFiles: (data || []).length, files: (data || []).map((r: any) => ({ path: r.path })) };
      },
    }),
    grep_files: tool({
      description: 'Search across all files.',
      parameters: z.object({ pattern: z.string() }),
      execute: async (args: any) => {
        const { data } = await supabase.from('project_files_manifest').select('path').eq('job_id', jobId);
        const results: any[] = [];
        let regex: RegExp;
        try { regex = new RegExp(args.pattern, 'gi'); } catch { regex = new RegExp(args.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }
        for (const r of data || []) {
          const content = await getFileText(buildWorkspaceKey(projectId, r.path));
          if (!content) continue;
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) results.push({ path: r.path, line: i + 1, text: lines[i].trim().slice(0, 120) });
            if (results.length >= 30) break;
          }
          if (results.length >= 30) break;
        }
        return { pattern: args.pattern, totalMatches: results.length, results };
      },
    }),
    glob_files: tool({
      description: 'Find files by name pattern.',
      parameters: z.object({ pattern: z.string() }),
      execute: async (args: any) => {
        const { data } = await supabase.from('project_files_manifest').select('path').eq('job_id', jobId);
        const re = args.pattern.replace(/\*\*/g, '\x00').replace(/\*/g, '[^/]*').replace(/\x00/g, '.*').replace(/\?/g, '[^/]');
        const regex = new RegExp(`^${re}$`, 'i');
        const matches = (data || []).map((r: any) => r.path).filter((p: string) => regex.test(p)).sort();
        return { pattern: args.pattern, totalFiles: matches.length, files: matches };
      },
    }),
  };

  const systemPrompt = `You are a FOCUSED sub-agent. Write the requested files efficiently.

TASK: ${task}
${context ? `\nCONTEXT:\n${context}` : ''}

TOOLS: write_files (PREFERRED for 2+), write_file, read_file, list_files.

RULES:
1. Content is ALWAYS a raw string (never JSON).
2. Write COMPLETE files (150-300 lines each).
3. Use write_files for ALL files in ONE call (most efficient).
4. Do NOT read back files after writing — just write and return.
5. Do NOT call done() — just write, return summary.

QUALITY: components 150-300 lines, routes 100-200 lines, models 80-150 lines.
Dark theme. Mobile responsive. Production-grade.

EFFICIENCY: Write ALL files in a SINGLE write_files call when possible.
Minimize reasoning. Act fast. Don't over-explain.`;

  // Create model instance (INDEPENDENT API connection — own rate limit)
  await debug(`Creating model instance: ${provider}/${modelName}`);
  const { getModelInstance } = await import('./provider-registry');
  const model = getModelInstance(provider, modelName, apiKey, { reasoningEffort: msg.reasoningEffort as any || 'off' });
  await debug(`Model instance created. Starting streamText...`);

  const abortController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    try { abortController.abort(); } catch {}
    debug(`Timeout fired — aborting streamText`);
  }, SUB_AGENT_TIMEOUT_MS);

  try {
    const result = await streamText({
      model,
      system: systemPrompt,
      prompt: task,
      tools: subTools as any,
      maxSteps: 12,           // Reduced from 20 — 6 files need ~7-8 steps (1 plan + 6 writes)
      maxTokens: 8000,        // Reduced from 16000 — 6 files × 200 lines = ~6K tokens, 8K is enough
      temperature: 0.3,
      abortSignal: abortController.signal,
      onStepFinish: async ({ toolCalls, toolResults }: any) => {
        // Emit progress event for each tool call — gives remote visibility
        for (const tc of toolCalls || []) {
          const toolName = tc?.toolName || 'unknown';
          const args = tc?.args || {};
          if (toolName === 'write_file' || toolName === 'write_files') {
            await debug(`tool_call: ${toolName} for ${args.path || (Array.isArray(args.files) ? args.files.length + ' files' : 'files')}`);
          } else {
            await debug(`tool_call: ${toolName}`);
          }
        }
      },
    });

    const text = await result.text;
    clearTimeout(timeoutId);
    await debug(`streamText completed. Files: ${filesWritten.length} written, ${filesVerified.length} verified, ${filesFailed.length} failed`);

    return {
      type: 'done',
      ok: filesWritten.length > 0,
      filesWritten, filesVerified, filesFailed,
      result: text || `Wrote ${filesWritten.length} files`,
      timedOut: false,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = timedOut || (err?.message || '').includes('abort');
    await debug(`streamText ${isTimeout ? 'timed out' : 'failed'}: ${err?.message}. Files written: ${filesWritten.length}`);
    return {
      type: isTimeout ? 'done' : 'error',
      ok: filesWritten.length > 0,
      filesWritten, filesVerified, filesFailed,
      error: err?.message,
      result: isTimeout ? `Timed out after ${SUB_AGENT_TIMEOUT_MS/1000}s — ${filesWritten.length} files written` : undefined,
      timedOut: isTimeout,
    };
  }
}
