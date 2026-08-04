/**
 * A chat turn through the worker's own dispatch, end to end.
 *
 * The earlier live test called the model and the writer directly, which proved
 * the pieces and skipped the part that decides whether any of it runs: the
 * queue. This inserts a `kind='chat'` row and then calls `processNextJob`, the
 * same function the poll loop calls, so the claim, the branch, the key lookup,
 * the shared system prompt and the batched writer all have to work together or
 * nothing arrives.
 *
 * Then it reads the result the way the browser will — rows ordered by seq —
 * and checks the turn ended in a way a client can act on.
 *
 *   npx tsx external-worker/scripts/test-chat-job-e2e.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { processNextJob } from '../src/job-processor';
import { forgetJobSeq } from '../src/event-emitter';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

/* The worker reads these from its own environment. */
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'API_KEY_ENCRYPTION_KEY']) {
  process.env[k] ??= env[k];
}

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

const netFetch = await proxyFetch();

/*
 * The worker's own modules build their client from the environment, and this
 * sandbox needs a proxy-aware fetch that they know nothing about. Patching the
 * global is what makes their internal client reach the network here; it changes
 * nothing about how the worker runs on its own machine.
 */
if (netFetch) {
  globalThis.fetch = netFetch;
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: netFetch },
});

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  cond ? pass++ : fail++;
};

/* ── the migration has to be applied, and says so plainly if not ── */
const { error: columnError } = await supabase.from('build_jobs').select('kind, request').limit(1);

if (columnError) {
  console.error(`\nMigration 0024 is not applied — ${columnError.message}`);
  console.error('Paste supabase/migrations/0024_turns_are_jobs.sql into the SQL editor first.\n');
  process.exit(1);
}

console.log('migration 0024: applied\n');

/*
 * `processNextJob` claims whatever is pending, so it must not run while real
 * work is queued — it would take someone's build and run it under this test.
 */
const { count: queued } = await supabase
  .from('build_jobs')
  .select('id', { count: 'exact', head: true })
  .eq('status', 'pending');

if ((queued ?? 0) > 0) {
  console.error(`${queued} job(s) already pending — not running, this would claim them.`);
  process.exit(1);
}

const { data: users } = await supabase.auth.admin.listUsers();
const userId = users.users[0]?.id;

const { data: job, error: insertError } = await supabase
  .from('build_jobs')
  .insert({
    user_id: userId,
    status: 'pending',
    kind: 'chat',
    request: {
      prompt:
        'Build a landing page for a coffee roastery. Plain HTML and CSS in one file called index.html. ' +
        'A hero, three product cards, a contact section. Output the complete file.',
      provider: 'OpenRouter',
      model: 'openai/gpt-5.6-luna',
      chatId: 'e2e-test',
    },
  })
  .select('id')
  .single();

if (insertError || !job) {
  console.error('could not enqueue:', insertError?.message);
  process.exit(1);
}

const jobId = (job as any).id as string;
console.log(`enqueued chat turn ${jobId}\n`);

const started = Date.now();

try {
  /* The same call the poll loop makes. Nothing here knows it is a test. */
  await processNextJob(supabase);

  const seconds = Math.round((Date.now() - started) / 1000);

  const { data: rows } = await supabase
    .from('job_events')
    .select('seq, type, payload, message')
    .eq('job_id', jobId)
    .order('seq', { ascending: true });

  const events = rows ?? [];
  const deltas = events.filter((e: any) => e.type === 'text_delta');
  const reply = deltas.map((e: any) => e.payload.text).join('');
  const done = events.find((e: any) => e.type === 'turn_completed');
  const failed = events.find((e: any) => e.type === 'job_failed');

  const { data: finalJob } = await supabase
    .from('build_jobs')
    .select('status, progress, has_completion_marker, error_summary')
    .eq('id', jobId)
    .single();

  console.log(
    `  ${seconds}s  ${reply.length} chars  ${deltas.length} rows  status=${(finalJob as any)?.status}` +
      (failed ? `  FAILED: ${failed.message}` : ''),
  );

  ok(!failed, 'the turn did not fail');
  ok(reply.length > 3000, `the reply came through the queue (${reply.length} chars)`);
  ok(/<\/html>/i.test(reply), 'index.html is closed, not cut off mid-tag');
  ok((done?.payload as any)?.finishReason === 'stop', `finished on its own terms (${(done?.payload as any)?.finishReason})`);
  ok((done?.payload as any)?.chars === reply.length, 'the finish event agrees with the text');
  ok((finalJob as any)?.status === 'ready_for_preview', `the job is marked done (${(finalJob as any)?.status})`);
  ok((finalJob as any)?.progress === 100, 'progress reached 100');
  ok((finalJob as any)?.has_completion_marker === true, 'marked complete rather than cut short');

  const seqs = events.map((e: any) => e.seq as number);
  ok(
    seqs.every((s, i) => i === 0 || s > seqs[i - 1]),
    'events are strictly ordered, so a client can render by seq',
  );

  /* What a client that reconnects would do: ask for everything after seq 4. */
  const { data: resumed } = await supabase
    .from('job_events')
    .select('payload')
    .eq('job_id', jobId)
    .eq('type', 'text_delta')
    .gt('seq', 4)
    .order('seq', { ascending: true });

  const tail = (resumed ?? []).map((e: any) => e.payload.text).join('');
  ok(reply.endsWith(tail) && tail.length > 0, 'a reconnecting client can fetch just the part it missed');
} finally {
  await supabase.from('job_events').delete().eq('job_id', jobId);
  await supabase.from('build_jobs').delete().eq('id', jobId);
  forgetJobSeq(jobId);
  console.log(`\ncleaned up ${jobId}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
