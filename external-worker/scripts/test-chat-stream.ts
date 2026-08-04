/**
 * Does a turn survive the trip through job_events intact?
 *
 * Run against the real database, because the things that can go wrong here are
 * things an in-memory fake would not have: numbering that restarts when a
 * worker does, a flush landing out of order, text lost at the seams between
 * batches. Creates one job, streams a made-up reply through the writer, reads
 * the rows back the way a browser would, and deletes what it made.
 *
 *   bun run scripts/test-chat-stream.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { createChatStreamWriter } from '../src/chat-stream';
import { emitEvent, forgetJobSeq } from '../src/event-emitter';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

/*
 * This sandbox reaches the internet through a proxy that re-terminates TLS, and
 * neither runtime's built-in fetch picks that up on its own. Only used when the
 * environment says so, so the worker itself is unaffected.
 */
async function proxyFetch(): Promise<typeof fetch | undefined> {
  if (!process.env.HTTPS_PROXY) {
    return undefined;
  }

  const { ProxyAgent, fetch: undiciFetch } = await import('undici');
  const dispatcher = new ProxyAgent({
    uri: process.env.HTTPS_PROXY,
    requestTls: { ca: readFileSync('/root/.ccr/ca-bundle.crt') },
  });

  return ((input: any, init: any) => undiciFetch(input, { ...init, dispatcher })) as unknown as typeof fetch;
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: await proxyFetch() },
});

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  cond ? pass++ : fail++;
};

/* A reply of roughly the size that used to be truncated, in token-sized pieces. */
const REPLY = Array.from({ length: 1200 }, (_, i) => (i % 12 === 11 ? `word${i}\n` : `word${i} `)).join('');
const tokens = REPLY.match(/.{1,6}/gs) ?? [];

const { data: user } = await supabase.auth.admin.listUsers();
const userId = user.users[0]?.id;

if (!userId) {
  console.error('no users in this project — cannot create a job row');
  process.exit(1);
}

const { data: job, error: jobError } = await supabase
  .from('build_jobs')
  .insert({ user_id: userId, status: 'generating', current_step: 'chat-stream-test' })
  .select('id')
  .single();

if (jobError || !job) {
  console.error('could not create job:', jobError?.message);
  process.exit(1);
}

const jobId = job.id as string;
console.log(`job ${jobId}, ${tokens.length} tokens, ${REPLY.length} chars\n`);

try {
  /* ── 1. a turn goes through whole ───────────────────────────────── */
  console.log('1. the reply arrives intact and batched');

  const started = Date.now();
  const writer = createChatStreamWriter(supabase, jobId);

  for (const t of tokens) {
    writer.push(t);
    /* A model does not emit instantly; without this every token batches into one row. */
    await new Promise((r) => setTimeout(r, 1));
  }

  await writer.finish('stop');

  const elapsed = Date.now() - started;

  const { data: rows } = await supabase
    .from('job_events')
    .select('seq, type, payload')
    .eq('job_id', jobId)
    .order('seq', { ascending: true });

  const events = rows ?? [];
  const deltas = events.filter((e) => e.type === 'text_delta');
  const assembled = deltas.map((e) => (e.payload as { text: string }).text).join('');

  console.log(`   ${tokens.length} tokens → ${deltas.length} rows in ${elapsed}ms`);

  ok(assembled === REPLY, `every character arrived, in order (${assembled.length}/${REPLY.length})`);
  ok(writer.text() === REPLY, 'the writer kept the same text for the turn record');
  ok(deltas.length < tokens.length / 10, `batched, not a row per token (${deltas.length} rows)`);
  ok(deltas.length > 1, 'still streamed in pieces rather than one lump at the end');

  const seqs = events.map((e) => e.seq as number);
  ok(
    seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
    'sequence numbers strictly increase',
  );
  ok(new Set(seqs).size === seqs.length, 'no duplicate sequence numbers');

  const last = events[events.length - 1];
  ok(last?.type === 'turn_completed', 'turn_completed is last, after every delta');
  ok((last?.payload as { chars: number })?.chars === REPLY.length, 'the finish event reports the true length');

  const biggest = Math.max(...deltas.map((e) => (e.payload as { text: string }).text.length));
  ok(biggest <= 600, `no row carries more than the ceiling (largest ${biggest})`);

  /* ── 2. the worker restarts mid-turn ────────────────────────────── */
  console.log('\n2. numbering survives a worker restart');

  const before = Math.max(...seqs);

  /* Exactly what a restart does: the process forgets, the rows remain. */
  forgetJobSeq(jobId);

  await emitEvent(supabase, jobId, 'text_delta', '', { text: ' resumed' });

  const { data: after } = await supabase
    .from('job_events')
    .select('seq')
    .eq('job_id', jobId)
    .order('seq', { ascending: false })
    .limit(1);

  const resumedSeq = (after?.[0]?.seq ?? -1) as number;

  console.log(`   highest was ${before}, next written was ${resumedSeq}`);
  ok(resumedSeq === before + 1, 'carried on from where it was, instead of restarting at 0');

  const { count } = await supabase
    .from('job_events')
    .select('seq', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .eq('seq', 0);

  ok(count === 1, 'there is still only one event numbered 0');
} finally {
  await supabase.from('build_jobs').delete().eq('id', jobId);
  forgetJobSeq(jobId);
  console.log(`\ncleaned up job ${jobId}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
