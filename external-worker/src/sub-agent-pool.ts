/**
 * Sub-Agent Pool — non-blocking, in-process concurrent sub-agents.
 *
 * WHY THIS REPLACES worker_threads (sub-agent-thread.ts / sub-agent-worker.ts):
 *
 * 1. A sub-agent is 99% network I/O (an LLM stream). One Bun event loop can
 *    run many concurrent streams — a separate thread adds nothing except a
 *    second module graph, which is exactly what silently failed on the
 *    Oracle box (worker started, streamText never produced output, every
 *    spawn burned its full 300s timeout with 0 files).
 *
 * 2. worker_threads did NOT give a separate provider rate limit. Rate limits
 *    are per API key, not per thread or connection. Parallelism helps
 *    wall-clock time only — so it belongs in the same process where it is
 *    observable and debuggable.
 *
 * 3. The old tool AWAITED the worker before returning, so the main agent's
 *    stream was blocked for the whole sub-agent lifetime (5 min per spawn on
 *    timeout — observed live: 6 spawns × 300s = a wasted half hour). Here,
 *    spawn() registers the run and returns immediately; the main agent keeps
 *    writing files and calls wait_subagents (or done(), which drains the
 *    pool) to join.
 *
 * Files written by sub-agents go through the SAME write pipeline as the main
 * agent (the spawner passes its performWrite in), so the in-memory file map,
 * R2, the live manifest, and file_written events all stay consistent — no
 * separate write path to drift.
 */

import { streamText, tool } from 'ai';
import { z } from 'zod';
import { logger } from './logger';
import { getModelInstance } from './provider-registry';

/** Model/provider config a sub-agent runs with (inherited from the job). */
export interface SubAgentModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  reasoningEffort?: 'off' | 'medium' | 'max';
}

/**
 * I/O bridge into the spawning job's tool pipeline. write goes through the
 * main agent's performWrite (all guards + live manifest + events included).
 */
export interface SubAgentIO {
  writeFile: (path: string, content: unknown) => Promise<{ success: boolean; message?: string }>;
  readFile: (path: string) => Promise<string | null>;
  listFiles: () => Promise<string[]>;
  emit: (message: string, payload?: Record<string, unknown>) => Promise<void>;
}

export interface SubAgentResult {
  id: string;
  task: string;
  ok: boolean;
  filesWritten: string[];
  filesFailed: string[];
  summary: string;
  error?: string;
  timedOut: boolean;
  durationMs: number;
}

interface PoolEntry {
  id: string;
  task: string;
  startedAt: number;
  promise: Promise<SubAgentResult>;
  settled: boolean;
  result?: SubAgentResult;
}

/** Per-sub-agent wall clock. Partial files persist — they are written live. */
const SUB_AGENT_TIMEOUT_MS = 240_000;

/** Concurrent LLM streams per job on top of the main agent's own stream. */
const MAX_CONCURRENT = 3;

const SUB_AGENT_SYSTEM = (task: string, context: string | undefined, fileList: string[]) => `You are a focused sub-agent inside a build job. You do ONE thing: complete the task below by WRITING FILES, then stop.

TASK: ${task}
${context ? `\nCONTEXT:\n${context}\n` : ''}
EXISTING PROJECT FILES (do not rewrite ones outside your task):
${fileList.length ? fileList.map((f) => `- ${f}`).join('\n') : '(none yet)'}

RULES:
1. File content is ALWAYS a raw string — never a JSON envelope, never an array.
2. Write COMPLETE, production-grade files. No placeholders.
3. write_files (batch) is PREFERRED for 2+ files.
4. Do not narrate at length. Write the files, then reply with ONE short summary line.
5. You cannot run shell commands or spawn agents — writing files is your whole job.`;

export class SubAgentPool {
  private entries = new Map<string, PoolEntry>();
  private running = 0;
  private queue: Array<() => void> = [];
  private seq = 0;

  constructor(
    private jobId: string,
    private modelConfig: SubAgentModelConfig,
    private io: SubAgentIO,
  ) {}

  /** Number of sub-agents not yet settled (running or queued). */
  pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (!e.settled) n++;
    return n;
  }

  /** One-line status for tool results / prompts. */
  status(): string {
    const all = [...this.entries.values()];
    const running = all.filter((e) => !e.settled).length;
    const doneOk = all.filter((e) => e.settled && e.result?.ok).length;
    const doneFail = all.filter((e) => e.settled && e.result && !e.result.ok).length;
    return `${running} running, ${doneOk} completed, ${doneFail} failed`;
  }

  /**
   * Start a sub-agent (or queue it if MAX_CONCURRENT are already running).
   * Returns the id IMMEDIATELY — the caller does not wait for the run.
   */
  spawn(task: string, context?: string): { id: string; queued: boolean } {
    const id = `sa-${++this.seq}`;
    const queued = this.running >= MAX_CONCURRENT;

    const gate: Promise<void> = queued
      ? new Promise<void>((res) => this.queue.push(res))
      : Promise.resolve();

    this.running++;

    const startedAt = Date.now();
    const promise = gate
      .then(() => this.run(id, task, context))
      .catch(
        (err: any): SubAgentResult => ({
          id,
          task,
          ok: false,
          filesWritten: [],
          filesFailed: [],
          summary: '',
          error: err?.message ?? String(err),
          timedOut: false,
          durationMs: Date.now() - startedAt,
        }),
      )
      .then((result) => {
        const entry = this.entries.get(id);
        if (entry) {
          entry.settled = true;
          entry.result = result;
        }
        this.running--;
        const next = this.queue.shift();
        if (next) next();
        return result;
      });

    this.entries.set(id, { id, task, startedAt, promise, settled: false });
    return { id, queued };
  }

  /**
   * Await every pending sub-agent (bounded by their own per-run timeouts).
   * Safe to call with none pending — resolves immediately with all results.
   */
  async waitAll(): Promise<SubAgentResult[]> {
    // Snapshot — spawns that happen while waiting are picked up by the next waitAll.
    const snapshot = [...this.entries.values()];
    await Promise.allSettled(snapshot.map((e) => e.promise));
    return snapshot.map((e) => e.result!).filter(Boolean);
  }

  /** Results of already-settled runs without waiting. */
  settledResults(): SubAgentResult[] {
    return [...this.entries.values()]
      .filter((e) => e.settled && e.result)
      .map((e) => e.result!);
  }

  private async run(id: string, task: string, context: string | undefined): Promise<SubAgentResult> {
    const startedAt = Date.now();
    const filesWritten: string[] = [];
    const filesFailed: string[] = [];

    const model = getModelInstance(this.modelConfig.provider, this.modelConfig.model, this.modelConfig.apiKey, {
      reasoningEffort: this.modelConfig.reasoningEffort ?? 'off',
    });

    const writeOne = async (path: string, content: unknown) => {
      const res = await this.io.writeFile(path, content);
      if (res.success) {
        filesWritten.push(path);
      } else {
        filesFailed.push(path);
      }
      return res;
    };

    const tools = {
      write_file: tool({
        description: 'Write ONE file. Content MUST be the raw file text as a string.',
        parameters: z.object({ path: z.string(), content: z.any() }),
        execute: async (args: any) => writeOne(args.path, args.content),
      }),
      write_files: tool({
        description: 'Write MULTIPLE files in one call. PREFERRED for 2+ files. files = [{path, content}, ...]',
        parameters: z.object({ files: z.any() }),
        execute: async (args: any) => {
          const list = Array.isArray(args.files) ? args.files : [args.files];
          const results = [];
          for (const f of list) {
            if (!f || typeof f.path !== 'string') continue;
            results.push(await writeOne(f.path, f.content));
          }
          return { written: results.filter((r) => r.success).length, total: list.length, results };
        },
      }),
      read_file: tool({
        description: 'Read a project file.',
        parameters: z.object({ path: z.string() }),
        execute: async (args: any) => {
          const content = await this.io.readFile(args.path);
          return content === null ? { exists: false, path: args.path } : { exists: true, path: args.path, content };
        },
      }),
      list_files: tool({
        description: 'List all project files.',
        parameters: z.object({}),
        execute: async () => ({ files: await this.io.listFiles() }),
      }),
    };

    const abort = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        abort.abort();
      } catch {
        /* best-effort */
      }
    }, SUB_AGENT_TIMEOUT_MS);

    try {
      const fileList = await this.io.listFiles().catch(() => [] as string[]);

      const stream = streamText({
        model,
        system: SUB_AGENT_SYSTEM(task, context, fileList),
        prompt: 'Complete the task now. Write the files, then reply with one summary line.',
        tools: tools as any,
        maxSteps: 16,
        maxTokens: 16_000,
        temperature: 0.3,
        abortSignal: abort.signal,
      });

      /*
       * Belt AND suspenders: abortSignal is forwarded to fetch, but Bun has
       * shown abort gaps mid-stream — so the timeout also short-circuits the
       * await. Files written before the cut persist (live write pipeline).
       */
      const text = await Promise.race([
        stream.text,
        new Promise<string>((res) =>
          setTimeout(() => res(''), SUB_AGENT_TIMEOUT_MS + 5_000),
        ),
      ]);

      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const ok = filesWritten.length > 0;

      logger.info(
        `[subagent ${id}] ${timedOut ? 'TIMEOUT' : 'done'} in ${Math.round(durationMs / 1000)}s — ${filesWritten.length} written, ${filesFailed.length} failed`,
      );

      return {
        id,
        task,
        ok,
        filesWritten,
        filesFailed,
        summary: (text || '').trim().slice(0, 500) || `${filesWritten.length} files written`,
        timedOut,
        durationMs,
        error: timedOut && !ok ? `timed out after ${Math.round(SUB_AGENT_TIMEOUT_MS / 1000)}s with 0 files` : undefined,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const aborted = timedOut || /abort/i.test(err?.message ?? '');

      return {
        id,
        task,
        ok: filesWritten.length > 0,
        filesWritten,
        filesFailed,
        summary: `${filesWritten.length} files written before ${aborted ? 'timeout' : 'error'}`,
        error: err?.message ?? String(err),
        timedOut: aborted,
        durationMs,
      };
    }
  }
}

/* ── Per-job registry ─────────────────────────────────────────────────── */

const pools = new Map<string, SubAgentPool>();

export function getSubAgentPool(
  jobId: string,
  modelConfig: SubAgentModelConfig,
  io: SubAgentIO,
): SubAgentPool {
  let pool = pools.get(jobId);
  if (!pool) {
    pool = new SubAgentPool(jobId, modelConfig, io);
    pools.set(jobId, pool);
  }
  return pool;
}

/** The pool for a job if one was ever created this run (else undefined). */
export function peekSubAgentPool(jobId: string): SubAgentPool | undefined {
  return pools.get(jobId);
}

export function disposeSubAgentPool(jobId: string): void {
  pools.delete(jobId);
}
