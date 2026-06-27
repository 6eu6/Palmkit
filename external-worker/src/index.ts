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
 * Main poll loop.
 *
 * Every 2 seconds, look for a build_job with status='generating' that has no
 * running worker claim on it. If found, claim it (atomic update) and process.
 *
 * The polling interval is intentionally short for responsiveness but could be
 * moved to Supabase Realtime (postgres_changes) for lower latency later.
 */
const POLL_INTERVAL_MS = 2000;
let isProcessing = false;

async function pollLoop() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    await processNextJob(supabase);
  } catch (err) {
    logger.error('Job processing error:', err);
  } finally {
    isProcessing = false;
  }
}

const pollTimer = setInterval(pollLoop, POLL_INTERVAL_MS);

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  clearInterval(pollTimer);
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
    const response = await app.fetch(new Request(url.toString(), { method: req.method, headers: req.headers as HeadersInit }));
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
