/**
 * Palmkit External Build Worker — Phase 2 Skeleton
 *
 * This is the DURABLE worker that runs OUTSIDE Cloudflare Pages Functions.
 * It polls Supabase for pending build_jobs, executes them step-by-step,
 * and streams progress back via Supabase (polled by the frontend) or SSE.
 *
 * WHY THIS EXISTS (see ROADMAP.md Phase 2):
 *   Cloudflare Pages Functions have a 10ms CPU limit on Free / 30s on paid.
 *   Long generations (ecommerce, dashboards) exceed this → stream cuts off
 *   → broken previews. Phase 1 added a Safety Gate to prevent broken
 *   previews, but the ROOT CAUSE (single long-lived CF request) remains.
 *
 *   This worker solves it: generation runs HERE (Render/Railway/Oracle),
 *   with NO timeout. The CF Pages Function becomes a thin API that just
 *   enqueues jobs and serves status.
 *
 * ARCHITECTURE:
 *
 *   Browser → CF Pages /api/jobs (enqueue) → Supabase build_jobs (status=pending)
 *                                                  ↓ poll (every 2s)
 *                                          [THIS WORKER]
 *                                                  ↓
 *   Worker picks job → plan → generate files → validate → repair → ready
 *                                                  ↓
 *   Writes file content to R2, manifest to Supabase, status updates to Supabase
 *                                                  ↓
 *   Browser polls /api/jobs/:id → sees progress → sees ready_for_preview
 *
 * DEPLOYMENT:
 *   - Render: `bun start` (web service)
 *   - Railway: `bun start`
 *   - Oracle Cloud: `bun start` behind nginx
 *   - Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY,
 *          R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *          R2_BUCKET (default: palmkit-files)
 *
 * This file is a SKELETON — the actual generation loop will be migrated
 * from app/routes/api.chat.ts in subsequent commits.
 */

import { Hono } from 'hono';
import { createServer } from 'http';
import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { processNextJob } from './job-processor';
import { logger } from './logger';

const PORT = Number(process.env.WORKER_PORT ?? 8787);

/*
 * Supabase client using the SERVICE ROLE key.
 *
 * IMPORTANT: this key bypasses RLS. It MUST only be used server-side in this
 * worker. NEVER expose it to the browser or to Cloudflare Pages Functions.
 * The browser talks to /api/jobs (CF) which uses the anon key + RLS.
 */
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  logger.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var. Worker cannot start.');
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/*
 * Hono app — exposes a health check + manual job trigger (for testing).
 * The main loop runs via setInterval below, NOT via HTTP.
 */
const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'palmkit-external-worker',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }),
);

app.get('/jobs/stats', async (c) => {
  const { count: pending } = await supabase
    .from('build_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'generating');
  return c.json({ pendingJobs: pending ?? 0 });
});

/*
 * Admin: self-update endpoint. Requires the ADMIN_TOKEN env var.
 * POST /admin/update  →  git pull + bun install → process.exit(0) (systemd restarts)
 */
app.post('/admin/update', async (c) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return c.json({ error: 'ADMIN_TOKEN not configured' }, 403);

  const auth = c.req.header('x-admin-token');
  if (auth !== adminToken) return c.json({ error: 'Unauthorized' }, 401);

  logger.info('[admin] Self-update triggered via HTTP');
  try {
    const gitOut = execSync('git -C /opt/palmkit-worker pull origin main 2>&1', { timeout: 60_000 }).toString();
    logger.info('[admin] git pull:', gitOut.trim());
    const bunOut = execSync('bun install --frozen-lockfile --cwd /opt/palmkit-worker 2>&1', { timeout: 120_000 }).toString();
    logger.info('[admin] bun install done:', bunOut.slice(-200));
    // Respond before exiting so the caller gets confirmation
    c.executionCtx?.waitUntil?.(Promise.resolve());
    setTimeout(() => { logger.info('[admin] Exiting for systemd restart'); process.exit(0); }, 500);
    return c.json({ ok: true, git: gitOut.trim().slice(-300) });
  } catch (err: any) {
    logger.error('[admin] Self-update failed:', err.message);
    return c.json({ error: err.message }, 500);
  }
});

/*
 * Main poll loop — concurrent job processing.
 *
 * Each tick checks for a pending job and fires it off without blocking.
 * Up to MAX_CONCURRENT_JOBS can run in parallel — safe because each job
 * is almost entirely I/O-bound (waiting on the LLM API), not CPU-bound.
 *
 * Supabase's claim_next_build_job() RPC uses an atomic UPDATE...RETURNING
 * so multiple worker instances (horizontal scale) never double-claim a job.
 *
 * Scaling options:
 *   - Vertical:   raise MAX_CONCURRENT_JOBS (LLM API rate limits permitting)
 *   - Horizontal: deploy more instances — each polls independently
 *   - Future:     switch to Cloudflare Queues + Durable Objects for zero-timeout
 */
const POLL_INTERVAL_MS = 2000;
const MAX_CONCURRENT_JOBS = 10;
let activeJobs = 0;

async function pollLoop() {
  if (activeJobs >= MAX_CONCURRENT_JOBS) return;

  activeJobs++;

  // Fire-and-forget: don't await so the poll loop stays unblocked.
  processNextJob(supabase)
    .catch((err) => logger.error('Job processing error:', err))
    .finally(() => {
      activeJobs--;
    });
}

const pollTimer = setInterval(pollLoop, POLL_INTERVAL_MS);

/*
 * Stuck-job reaper.
 *
 * A job goes pending → generating when a worker claims it. If that worker then
 * restarts (deploy) or crashes mid-build, the job is orphaned: it stays
 * 'generating' forever and the user sees "generating…" indefinitely — nothing
 * ever re-processes or fails it.
 *
 * This reaper periodically finds jobs stuck in 'generating' with no update for
 * well past the orchestrator's 15-min hard timeout (so it never touches a
 * healthy, actively-running job) and recovers them: re-queue (back to pending)
 * up to a cap, then fail cleanly so the user isn't left hanging.
 */
const STUCK_THRESHOLD_MS = 25 * 60 * 1000; // 25 min — safely past the 15-min hard timeout
const MAX_STUCK_REQUEUE = 2;

async function reapStuckJobs() {
  try {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
    const { data: stuck, error } = await supabase
      .from('build_jobs')
      .select('id, retry_count')
      .eq('status', 'generating')
      .lt('updated_at', cutoff)
      .limit(20);

    if (error || !stuck || stuck.length === 0) {
      return;
    }

    for (const job of stuck) {
      const retries = (job.retry_count as number) ?? 0;

      if (retries < MAX_STUCK_REQUEUE) {
        await supabase
          .from('build_jobs')
          .update({ status: 'pending', current_step: 'queued', progress: 0, retry_count: retries + 1 })
          .eq('id', job.id);
        logger.warn(`[reaper] Re-queued orphaned job ${job.id} (attempt ${retries + 1}/${MAX_STUCK_REQUEUE})`);
      } else {
        await supabase
          .from('build_jobs')
          .update({
            status: 'failed_clean',
            error_summary: 'Build was interrupted (worker restart or timeout) and could not be recovered. Please try again.',
          })
          .eq('id', job.id);
        logger.error(`[reaper] Failed unrecoverable orphaned job ${job.id} after ${retries} requeues`);
      }
    }
  } catch (err) {
    logger.error('[reaper] error:', err);
  }
}

// Run shortly after startup (catch jobs orphaned by the restart we just did),
// then on a slow interval.
setTimeout(reapStuckJobs, 15_000);
const reaperTimer = setInterval(reapStuckJobs, 60_000);

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(pollTimer);
  clearInterval(reaperTimer);
  server.close(() => {
    logger.info('Worker stopped.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const response = await app.fetch(new Request(url.toString(), { method: req.method, headers: req.headers as Record<string, string> }));
    const body = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal worker error' }));
  }
});

server.listen(PORT, () => {
  logger.info(`Palmkit External Build Worker listening on :${PORT}`);
  logger.info(`Polling Supabase for jobs every ${POLL_INTERVAL_MS}ms`);
  logger.info(`R2 bucket: ${process.env.R2_BUCKET ?? 'palmkit-files'}`);
});
