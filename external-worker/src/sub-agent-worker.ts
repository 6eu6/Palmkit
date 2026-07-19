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

  // Local seq counter — must stay within integer range (< 2^31)
  // Date.now() overflows PostgreSQL integer (max 2^31-1), causing silent INSERT failures
  // Use a counter starting at 100000 to avoid collision with parent's seq (0, 1, 2, ...)
  let localSeq = 100000;
  const nextSeq = () => ++localSeq;

  // Debug helper — emit events to Supabase so we can monitor the Worker remotely
  const debug = async (message: string, payload?: any) => {
    try {
      const { error } = await supabase.from('job_events').insert({
        job_id: jobId,
        type: 'file_chunk',
        seq: nextSeq(),
        message: `[sub-agent] ${message.slice(0, 200)}`,
        payload: { source: 'sub-agent', agent: 'Brain', ...payload },
      });
      if (error) {
        console.error(`[sub-agent] debug insert failed: ${error.message} (seq=${localSeq})`);
      }
    } catch (e: any) {
      console.error(`[sub-agent] debug exception: ${e?.message}`);
    }
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

      // Event — use nextSeq() counter, add agent: 'Brain' so frontend displays it
      const lines = content.split('\n').length;
      const { error: evErr } = await supabase.from('job_events').insert({
        job_id: jobId, type: 'file_written', seq: nextSeq(),
        message: `[sub-agent] ${path} (${lines} lines)`,
        payload: { filePath: path, lines, size: content.length, source: 'sub-agent', agent: 'Brain' },
      });
      if (evErr) {
        console.error(`[sub-agent] file_written insert failed for ${path}: ${evErr.message}`);
      }

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
      description: 'Write a single file. Parameters: path (string, the file path like "src/App.jsx"), content (string, the full file content). Content MUST be a raw string, NOT JSON.',
      parameters: z.object({
        path: z.string().describe('File path, e.g. "src/App.jsx" or "package.json"'),
        content: z.string().describe('Full file content as a raw string')
      }),
      execute: async (args: any) => {
        // Robust arg extraction — model may send args in different shapes
        const filePath = args?.path || args?.filePath || args?.file || args?.name;
        let content = args?.content || args?.text || args?.code || args?.body || '';

        if (!filePath) {
          await debug(`write_file: missing path, args keys: ${Object.keys(args || {}).join(',')}`);
          return { success: false, error: 'Missing path parameter' };
        }

        if (typeof content !== 'string') {
          content = JSON.stringify(content, null, 2);
        }

        if (!content || content.trim().length === 0) {
          await debug(`write_file: empty content for ${filePath}`);
          return { success: false, error: 'Empty content', path: filePath };
        }

        const ok = await writeProjectFile(filePath, content);
        return { success: ok, path: filePath, lines: content.split('\n').length };
      },
    }),
    write_files: tool({
      description: 'Write MULTIPLE files in ONE call. PREFERRED for 2+ files. Parameter: files (array of {path, content} objects).',
      parameters: z.object({
        files: z.array(z.object({
          path: z.string().describe('File path, e.g. "src/App.jsx"'),
          content: z.string().describe('Full file content as a raw string')
        })).describe('Array of files to write')
      }),
      execute: async (args: any) => {
        // Robust extraction — handle different shapes the model might send
        let fileList = args?.files;
        if (!Array.isArray(fileList)) {
          // Maybe model sent a single object or different structure
          if (fileList && typeof fileList === 'object') {
            fileList = [fileList];
          } else {
            await debug(`write_files: invalid files param, type: ${typeof fileList}`);
            return { success: false, error: 'files must be an array', written: 0, total: 0 };
          }
        }

        let written = 0;
        let failed = 0;
        for (const f of fileList) {
          const filePath = f?.path || f?.filePath || f?.file || f?.name;
          let content = f?.content || f?.text || f?.code || f?.body || '';

          if (!filePath) {
            await debug(`write_files: missing path in file object, keys: ${Object.keys(f || {}).join(',')}`);
            failed++;
            continue;
          }

          if (typeof content !== 'string') {
            content = JSON.stringify(content, null, 2);
          }

          if (!content || content.trim().length === 0) {
            await debug(`write_files: empty content for ${filePath}`);
            failed++;
            continue;
          }

          if (await writeProjectFile(filePath, content)) {
            written++;
          } else {
            failed++;
          }
        }
        await debug(`write_files: ${written} written, ${failed} failed out of ${fileList.length}`);
        return { success: true, written, failed, total: fileList.length };
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

  const systemPrompt = `You are a FILE WRITER sub-agent. Your ONLY job is to write files.

TASK: ${task}
${context ? `\nCONTEXT:\n${context}` : ''}

CRITICAL INSTRUCTIONS:
1. IMMEDIATELY call write_files with ALL requested files. Do NOT plan, do NOT explain, do NOT reason.
2. Content is ALWAYS a raw string (never JSON, never array).
3. Each file must be COMPLETE (150-300 lines), working, no placeholders.
4. After write_files returns, you are DONE. Do not read back, do not verify, do not call done().
5. If write_files fails, call it again with corrected content.

EXAMPLE flow:
  User: "Write 3 files: A.jsx, B.jsx, C.jsx"
  You: [call write_files with all 3 files]
  You: [return summary "Wrote 3 files"]

DO NOT:
- Plan or explain what you'll do
- Read existing files first
- Call list_files or read_file unnecessarily
- Reason about architecture
- Call done() — there is no done() tool

ACT FAST. WRITE FILES. RETURN.`;

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
      maxSteps: 15,           // Enough for 7 files: 1 plan + 7 writes + buffer
      maxTokens: 16000,       // 7 files × 200 lines = ~14K tokens, 16K gives headroom
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

    // Wait for streamText to produce files
    // 4 min gives model enough time for complex backend reasoning + writing
    const maxWaitMs = 240_000; // 4 min
    const pollIntervalMs = 2_000;
    const startTime = Date.now();
    let lastFileCount = 0;
    let stableCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      if (filesWritten.length > 0) {
        if (filesWritten.length === lastFileCount) {
          stableCount++;
          if (stableCount >= 10) { // 20s of stability (10 × 2s)
            await debug(`File count stable at ${filesWritten.length} for 20s, assuming done`);
            break;
          }
        } else {
          stableCount = 0;
          lastFileCount = filesWritten.length;
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    await debug(`Polling ended. Files written: ${filesWritten.length}, elapsed: ${Math.round((Date.now() - startTime) / 1000)}s`);

    // Now safe to get text (streamText should be done or nearly done)
    let text = '';
    try {
      text = await Promise.race([
        result.text,
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 10_000)) // 10s max for text
      ]);
    } catch {
      text = '';
    }
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
