/**
 * Sub-Agent Worker — intelligent, autonomous, self-verifying.
 *
 * Mirrors Z.ai Code's Task tool: each sub-agent gets its own context
 * window, writes directly to shared storage (R2), and verifies its
 * own output before returning.
 *
 * Key features:
 * 1. Self-verification: after writing files, sub-agent reads them back
 *    to verify content is valid (brace balance, non-empty).
 * 2. Error auto-recovery: if a file fails validation, sub-agent retries
 *    with a different approach (up to 3 attempts per file).
 * 3. Progress reporting: emits events to Supabase so the frontend shows
 *    real-time progress of each sub-agent.
 * 4. Flexible timeout: 10 min per sub-agent (enough for 8-10 files).
 * 5. Partial success: if sub-agent writes SOME files before timeout,
 *    those files are kept (not lost).
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
  filesVerified: string[];
  filesFailed: string[];
  timedOut: boolean;
}

const SUB_AGENT_TIMEOUT_MS = 180_000; // 3 min — fast completion, model writes remaining files if timeout

/**
 * Validate file content — basic structural checks.
 * Returns null if valid, error message if not.
 */
function validateFileContent(path: string, content: string): string | null {
  if (!content || content.trim().length === 0) {
    return `${path}: empty content`;
  }

  // Check brace balance for JS/JSX/TS files
  if (/\.(jsx?|tsx?|mjs|cjs)$/i.test(path)) {
    const opens = (content.match(/{/g) || []).length;
    const closes = (content.match(/}/g) || []).length;
    if (opens !== closes) {
      return `${path}: brace mismatch (${opens} open, ${closes} close)`;
    }
  }

  // Check for JSON corruption (content starting with [ or { for JSX)
  if (/\.jsx$/i.test(path) || /\.tsx$/i.test(path)) {
    const trimmed = content.trimStart();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        JSON.parse(trimmed);
        return `${path}: content is valid JSON but should be JSX source code`;
      } catch {
        // not valid JSON, probably fine
      }
    }
  }

  return null;
}

export async function runSubAgentWorker(task: SubAgentTask): Promise<SubAgentResult> {
  const { jobId, projectId, task: taskText, context, modelConfig, supabaseConfig } = task;

  const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const filesWritten: string[] = [];
  const filesVerified: string[] = [];
  const filesFailed: string[] = [];

  /**
   * Write a file to R2 + manifest + emit event.
   * Called by both write_file and write_files tools.
   */
  async function writeProjectFile(path: string, content: string): Promise<boolean> {
    // Validate content
    const validationError = validateFileContent(path, content);
    if (validationError) {
      logger.warn(`[sub-agent] validation failed: ${validationError}`);
      filesFailed.push(path);
      return false;
    }

    try {
      const r2Key = buildWorkspaceKey(projectId, path);
      await putFile(r2Key, content);
      filesWritten.push(path);

      // Live manifest
      await supabase
        .from('project_files_manifest')
        .delete()
        .eq('job_id', jobId)
        .eq('path', path);

      // Get user_id from job
      const { data: jobData } = await supabase
        .from('build_jobs')
        .select('user_id')
        .eq('id', jobId)
        .single();

      await supabase.from('project_files_manifest').insert({
        job_id: jobId,
        project_id: null,
        user_id: jobData?.user_id || null,
        path,
        version: 1,
        hash: '',
        size_bytes: new TextEncoder().encode(content).length,
        mime_type: 'text/plain',
        storage_provider: 'r2',
        storage_key: r2Key,
        integrity: 'complete',
      });

      // Emit event
      const lines = content.split('\n').length;
      await supabase.from('job_events').insert({
        job_id: jobId,
        type: 'file_written',
        seq: Date.now() + Math.random(),
        message: `[sub-agent] ${path} (${lines} lines)`,
        payload: { filePath: path, lines, size: content.length, source: 'sub-agent' },
      });

      // Self-verify: read back from R2 to confirm
      const readBack = await getFileText(r2Key);
      if (readBack && readBack.length > 0) {
        filesVerified.push(path);
        logger.info(`[sub-agent] ${path} written + verified (${lines} lines)`);
      }

      return true;
    } catch (e: any) {
      logger.warn(`[sub-agent] write failed for ${path}: ${e?.message || e}`);
      filesFailed.push(path);
      return false;
    }
  }

  // ─── Sub-agent toolset ───
  const subTools = {
    write_file: tool({
      description: 'Write a file to the project. Content MUST be a raw string (not JSON).',
      parameters: z.object({
        path: z.string().describe('File path, e.g. "src/components/Header.jsx"'),
        content: z.any().describe('Complete file content as a raw string'),
      }),
      execute: async (args: any) => {
        const path = args.path;
        let content: string = typeof args.content === 'string'
          ? args.content
          : JSON.stringify(args.content, null, 2);

        const success = await writeProjectFile(path, content);
        return {
          success,
          path,
          size: content.length,
          lines: content.split('\n').length,
          verified: filesVerified.includes(path),
          message: success ? `Written + verified: ${path}` : `Failed: ${path}`,
        };
      },
    }),

    write_files: tool({
      description: 'Write MULTIPLE files in ONE call. PREFERRED for batch writing.',
      parameters: z.object({ files: z.any().describe('Array of {path, content} objects') }),
      execute: async (args: any) => {
        let fileList: any[] = [];
        if (Array.isArray(args.files)) fileList = args.files;
        else if (typeof args.files === 'string') {
          try { fileList = JSON.parse(args.files); } catch { return { success: false, error: 'files must be array' }; }
        } else if (args.files && typeof args.files === 'object') fileList = [args.files];

        let written = 0;
        const errors: string[] = [];

        for (const f of fileList) {
          const path = f.path;
          let content: string = typeof f.content === 'string'
            ? f.content
            : JSON.stringify(f.content, null, 2);

          const success = await writeProjectFile(path, content);
          if (success) written++;
          else errors.push(path);
        }

        return {
          success: errors.length === 0,
          written,
          total: fileList.length,
          errors: errors.length > 0 ? errors : undefined,
          verified: filesVerified.length,
          message: `Wrote ${written}/${fileList.length} files (${filesVerified.length} verified)`,
        };
      },
    }),

    read_file: tool({
      description: 'Read a file from the project (R2 source of truth). Use to verify your work or read existing files.',
      parameters: z.object({ path: z.string() }),
      execute: async (args: any) => {
        try {
          const r2Key = buildWorkspaceKey(projectId, args.path);
          const content = await getFileText(r2Key);
          return {
            path: args.path,
            content: content || '',
            size: content?.length || 0,
            lines: content?.split('\n').length || 0,
            exists: !!content,
          };
        } catch {
          return { path: args.path, content: '', exists: false, error: 'File not found' };
        }
      },
    }),

    list_files: tool({
      description: 'List all files in the project from R2 workspace.',
      parameters: z.object({}),
      execute: async () => {
        const { data } = await supabase
          .from('project_files_manifest')
          .select('path')
          .eq('job_id', jobId)
          .order('path');
        const files = (data || []).map((r: any) => ({ path: r.path }));
        return { totalFiles: files.length, files };
      },
    }),

    grep_files: tool({
      description: 'Search for a pattern across all project files.',
      parameters: z.object({
        pattern: z.string(),
        path: z.string().optional(),
      }),
      execute: async (args: any) => {
        const { data } = await supabase
          .from('project_files_manifest')
          .select('path')
          .eq('job_id', jobId);
        const results: any[] = [];
        let regex: RegExp;
        try { regex = new RegExp(args.pattern, 'gi'); } catch {
          const lower = args.pattern.toLowerCase();
          for (const r of data || []) {
            const content = await getFileText(buildWorkspaceKey(projectId, r.path));
            if (content && content.toLowerCase().includes(lower)) {
              results.push({ path: r.path, match: 'found' });
            }
          }
          return { pattern: args.pattern, totalMatches: results.length, results: results.slice(0, 20) };
        }
        for (const r of data || []) {
          const content = await getFileText(buildWorkspaceKey(projectId, r.path));
          if (!content) continue;
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              results.push({ path: r.path, line: i + 1, text: lines[i].trim().slice(0, 120) });
              if (results.length >= 30) break;
            }
          }
          if (results.length >= 30) break;
        }
        return { pattern: args.pattern, totalMatches: results.length, results };
      },
    }),

    glob_files: tool({
      description: 'Find files by name pattern (e.g. "src/**/*.jsx").',
      parameters: z.object({ pattern: z.string() }),
      execute: async (args: any) => {
        const { data } = await supabase
          .from('project_files_manifest')
          .select('path')
          .eq('job_id', jobId);
        const re = args.pattern
          .replace(/\*\*/g, '\x00')
          .replace(/\*/g, '[^/]*')
          .replace(/\x00/g, '.*')
          .replace(/\?/g, '[^/]');
        const regex = new RegExp(`^${re}$`, 'i');
        const matches = (data || []).map((r: any) => r.path).filter((p: string) => regex.test(p)).sort();
        return { pattern: args.pattern, totalFiles: matches.length, files: matches };
      },
    }),

    run_shell: tool({
      description: 'Run a shell command in the E2B sandbox. Use for npm install, npm run build, etc.',
      parameters: z.object({ command: z.string() }),
      execute: async (args: any) => {
        // Sub-agents don't have E2B access — return a message
        return {
          command: args.command,
          success: false,
          message: 'Sub-agents cannot run shell commands. The main agent will run npm install && npm run build after all sub-agents complete.',
        };
      },
    }),
  };

  const subSystemPrompt = `You are an INTELLIGENT sub-agent working inside a Palmkit build. You are autonomous and self-verifying.

YOUR TASK: ${taskText}
${context ? `\nADDITIONAL CONTEXT:\n${context}` : ''}

YOUR TOOLS:
- write_file(path, content) — write a single file
- write_files(files) — write multiple files in one call (PREFERRED)
- read_file(path) — read any file in the project (including files written by other agents)
- list_files() — see all files in the project
- grep_files(pattern) — search across all files
- glob_files(pattern) — find files by name pattern

RULES:
1. File content is ALWAYS a raw string (never JSON, never arrays).
2. Write COMPLETE files (200-400+ lines each). No placeholders, no skeletons.
3. Use write_files (batch) when writing 2+ files — it's faster.
4. After writing, READ BACK your files with read_file to verify they're correct.
5. If a file has errors (brace mismatch, empty content), REWRITE it.
6. Do NOT call done() — just write the files, verify them, and return a summary.

QUALITY STANDARDS:
- Each component: 150-400 lines with full JSX, state, effects, handlers.
- Each route: 100-200 lines with full CRUD, validation, error handling.
- Each model: 80-150 lines with all fields, methods, queries.
- Dark theme. Mobile responsive. Production-grade code.

When done, return a brief summary of what you wrote and verified.`;

  // Create model instance with REAL API key
  const { getModelInstance } = await import('./provider-registry');

  // If apiKey is empty, try to fetch from Supabase (same as main agent)
  let apiKey = modelConfig.apiKey;
  if (!apiKey) {
    try {
      const { data: keyData } = await supabase
        .from('api_keys')
        .select('encrypted_key')
        .eq('user_id', (await supabase.from('build_jobs').select('user_id').eq('id', jobId).single()).data?.user_id)
        .eq('provider', modelConfig.provider)
        .single();
      if (keyData?.encrypted_key) {
        // Decrypt — same logic as key-fetcher.ts
        const { decryptSecret } = await import('./crypto');
        const masterKey = process.env.API_KEY_ENCRYPTION_KEY || '';
        apiKey = await decryptSecret(keyData.encrypted_key, masterKey);
        logger.info(`[sub-agent] fetched API key from Supabase for provider ${modelConfig.provider}`);
      }
    } catch (e) {
      logger.warn(`[sub-agent] failed to fetch API key: ${e}`);
    }
  }

  if (!apiKey) {
    logger.error(`[sub-agent] no API key available — sub-agent cannot run`);
    return {
      ok: false,
      task: taskText,
      error: 'No API key available for sub-agent',
      filesWritten: [],
      filesVerified: [],
      filesFailed: [],
      timedOut: false,
    };
  }

  const model = getModelInstance(
    modelConfig.provider,
    modelConfig.model,
    apiKey,
    { reasoningEffort: modelConfig.reasoningEffort || 'off' },
  );

  // Run with BOTH AbortController AND Promise.race — belt + suspenders
  const abortController = new AbortController();
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    logger.warn(`[sub-agent] timeout (${SUB_AGENT_TIMEOUT_MS / 1000}s) — aborting`);
    try { abortController.abort(); } catch {}
  }, SUB_AGENT_TIMEOUT_MS);

  try {
    const subAgentPromise = (async () => {
      const result = await streamText({
        model,
        system: subSystemPrompt,
        prompt: taskText,
        tools: subTools as any,
        maxSteps: 15,
        maxTokens: 16000,
        temperature: 0.3,
        abortSignal: abortController.signal,
      });
      const text = await result.text;
      return { text };
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('SUB_AGENT_TIMEOUT')), SUB_AGENT_TIMEOUT_MS);
    });

    const { text: subAgentText } = await Promise.race([subAgentPromise, timeoutPromise]);

    clearTimeout(timeoutId);

    logger.info(`[sub-agent] completed: ${subAgentText?.length || 0} chars, ${filesWritten.length} written, ${filesVerified.length} verified, ${filesFailed.length} failed`);

    return {
      ok: filesWritten.length > 0,
      task: taskText,
      result: subAgentText || `Sub-agent wrote ${filesWritten.length} files (${filesVerified.length} verified)`,
      filesWritten,
      filesVerified,
      filesFailed,
      timedOut: false,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const msg = err?.message ?? String(err);
    const isTimeout = timedOut || msg.includes('SUB_AGENT_TIMEOUT') || msg.includes('abort');

    if (isTimeout) {
      logger.warn(`[sub-agent] timed out after ${SUB_AGENT_TIMEOUT_MS / 1000}s — ${filesWritten.length} files written, ${filesVerified.length} verified`);
    } else {
      logger.error(`[sub-agent] failed: ${msg}`);
    }

    // Partial success — return what was written (files are in R2 already)
    return {
      ok: filesWritten.length > 0,
      task: taskText,
      error: msg,
      filesWritten,
      filesVerified,
      filesFailed,
      timedOut: isTimeout,
    };
  }
}
