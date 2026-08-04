/**
 * A real build turn, through the new path, three times.
 *
 * The writer test proved the carriage: text goes in, rows come out, nothing is
 * lost or reordered. It said nothing about a real turn, because it never
 * called a model — and a real turn is what Cloudflare could not finish. That
 * route dies at Error 1102 partway through, with HTTP 200 and no finish event,
 * on essentially every build.
 *
 * So this runs the same prompt that truncates there, with the same model,
 * through the AI SDK exactly as the worker will, writing into job_events. Then
 * it reads the rows back the way a browser would and asks whether the file the
 * model wrote is actually there and actually closed.
 *
 * Three runs, because a failure that happens most of the time still lets a
 * single run pass, and one success proves nothing about a route that used to
 * fail nine times in ten.
 *
 *   npx tsx external-worker/scripts/test-chat-turn-live.ts
 */

import { createClient } from '@supabase/supabase-js';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';
import { readFileSync } from 'node:fs';
import { createChatStreamWriter } from '../src/chat-stream';
import { forgetJobSeq } from '../src/event-emitter';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

/* This sandbox reaches the internet through a TLS-terminating proxy. */
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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: netFetch },
});

/** The user's own OpenRouter key, decrypted here and never printed. */
async function openRouterKey(): Promise<string> {
  const { data } = await supabase.from('user_api_keys').select('provider, encrypted_key');
  const row = (data ?? []).find((r: any) => r.provider === 'OpenRouter');

  if (!row) {
    throw new Error('no OpenRouter key stored');
  }

  const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
  const [iv, ct] = (row as any).encrypted_key.split(':');
  const key = await crypto.subtle.importKey('raw', b64(env.API_KEY_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(iv) }, key, b64(ct));

  return new TextDecoder().decode(plain);
}

const PROMPT =
  'Build a landing page for a coffee roastery. Plain HTML and CSS in one file called index.html. ' +
  'A hero, three product cards, a contact section. Output the complete file.';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  cond ? pass++ : fail++;
};

const openrouter = createOpenRouter({ apiKey: await openRouterKey(), fetch: netFetch });

const { data: users } = await supabase.auth.admin.listUsers();
const userId = users.users[0]?.id;

if (!userId) {
  console.error('no users in this project');
  process.exit(1);
}

const results: { chars: number; rows: number; seconds: number; finish: string; complete: boolean }[] = [];

for (let run = 1; run <= 3; run++) {
  console.log(`\n${'─'.repeat(62)}\nrun ${run}`);

  const { data: job } = await supabase
    .from('build_jobs')
    .insert({ user_id: userId, status: 'generating', current_step: 'chat-turn-live' })
    .select('id')
    .single();

  const jobId = (job as any).id as string;
  const started = Date.now();
  const writer = createChatStreamWriter(supabase, jobId);

  let finishReason = 'unknown';
  let streamError: string | undefined;

  try {
    const result = streamText({
      model: openrouter('openai/gpt-5.6-luna'),
      messages: [{ role: 'user', content: PROMPT }],
    });

    for await (const delta of result.textStream) {
      writer.push(delta);
    }

    finishReason = await result.finishReason;
  } catch (error: any) {
    streamError = error?.message ?? String(error);
    finishReason = 'error';
  }

  await writer.finish(finishReason);

  const seconds = Math.round((Date.now() - started) / 1000);

  /* Read it back exactly as a browser would: rows, ordered by seq. */
  const { data: rows } = await supabase
    .from('job_events')
    .select('seq, type, payload')
    .eq('job_id', jobId)
    .order('seq', { ascending: true });

  const events = rows ?? [];
  const deltas = events.filter((e: any) => e.type === 'text_delta');
  const assembled = deltas.map((e: any) => e.payload.text).join('');
  const done = events.find((e: any) => e.type === 'turn_completed');

  const complete = /<\/html>/i.test(assembled);

  console.log(
    `  ${seconds}s  ${assembled.length} chars  ${deltas.length} rows  finish=${finishReason}` +
      (streamError ? `  ERROR ${streamError}` : ''),
  );

  ok(assembled.length > 3000, `the model's reply is there (${assembled.length} chars)`);
  ok(finishReason === 'stop', `the turn finished on its own terms (${finishReason})`);
  ok(complete, 'index.html is closed, not cut off mid-tag');
  ok(assembled === writer.text(), 'what the rows say matches what was written');
  ok(!!done, 'the turn is marked finished, so a client knows to stop waiting');
  ok(
    (done?.payload as any)?.chars === assembled.length,
    'the finish event agrees with the text about how long it is',
  );

  results.push({ chars: assembled.length, rows: deltas.length, seconds, finish: finishReason, complete });

  await supabase.from('build_jobs').delete().eq('id', jobId);
  forgetJobSeq(jobId);
}

console.log(`\n${'═'.repeat(62)}`);
console.log('run   seconds   chars   rows   finish   complete');

for (const [i, r] of results.entries()) {
  console.log(
    `  ${i + 1}   ${String(r.seconds).padStart(7)}   ${String(r.chars).padStart(5)}   ${String(r.rows).padStart(4)}   ${r.finish.padEnd(6)}   ${r.complete ? 'yes' : 'NO'}`,
  );
}

console.log(`\ncomplete turns: ${results.filter((r) => r.complete).length}/${results.length}`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
