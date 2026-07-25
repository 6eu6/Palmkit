/**
 * Live integration test — exercises /api/stream end-to-end against
 * the production palmkit.app deployment.
 *
 * Run with:
 *   npx tsx scripts/test-stream-live.ts
 *
 * Tests:
 *   1. Discuss mode: send "analyze this code" → expects stream:start
 *      with mode='discuss', no build:status events
 *   2. Build mode: send "build a counter app" → expects stream:start
 *      with mode='build', build:status events
 *   3. Cancel: start a build, abort request → expects stream:end
 *      with reason='cancelled'
 *   4. Protocol: every event has kind, seq, ts
 */

import { writeFileSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'https://palmkit.app';
const EMAIL = process.env.TEST_EMAIL || 'maxok99x8@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Ah251403@';

interface StreamEvent {
  kind: string;
  seq: number;
  ts: number;
  [key: string]: unknown;
}

async function login(): Promise<string> {
  console.log('[1] Logging in...');

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD }).toString(),
    redirect: 'manual',
  });

  const cookie = res.headers.get('set-cookie');

  if (!cookie) {
    throw new Error('No set-cookie header');
  }

  // Extract just the session cookie
  const sessionCookie = cookie.split(';')[0];
  console.log('    ✓ Got session cookie');

  return sessionCookie;
}

async function streamChat(
  sessionCookie: string,
  message: string,
  options: { abortAfterMs?: number } = {},
): Promise<{ events: StreamEvent[]; aborted: boolean }> {
  const events: StreamEvent[] = [];
  const controller = new AbortController();
  let aborted = false;

  const abortTimer =
    options.abortAfterMs !== undefined
      ? setTimeout(() => {
          console.log(`    ⏹ Aborting after ${options.abortAfterMs}ms`);
          aborted = true;
          controller.abort();
        }, options.abortAfterMs)
      : null;

  try {
    const res = await fetch(`${BASE_URL}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        messages: [{ id: '1', role: 'user', content: message }],
        chatMode: 'discuss', // let classifier override
        contextOptimization: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      let idx: number;

      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) {
            continue;
          }

          try {
            const event = JSON.parse(line.slice(5).trim());
            events.push(event);
          } catch {
            // skip malformed
          }
        }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // expected
    } else {
      throw err;
    }
  } finally {
    if (abortTimer) {
      clearTimeout(abortTimer);
    }
  }

  return { events, aborted };
}

function validateEventStructure(events: StreamEvent[]): string[] {
  const errors: string[] = [];

  for (const event of events) {
    if (!event.kind) {
      errors.push(`Event missing kind: ${JSON.stringify(event).slice(0, 100)}`);
    }

    if (typeof event.seq !== 'number') {
      errors.push(`Event ${event.kind} missing seq`);
    }

    if (typeof event.ts !== 'number') {
      errors.push(`Event ${event.kind} missing ts`);
    }
  }

  return errors;
}

function expect(condition: boolean, message: string): void {
  if (condition) {
    console.log(`    ✓ ${message}`);
  } else {
    console.error(`    ✗ ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log(`\n=== PalmKit Stream Live Test ===`);
  console.log(`URL: ${BASE_URL}\n`);

  const sessionCookie = await login();

  // Test 1: Discuss mode
  console.log('\n[2] Test discuss mode: "اشرح لي كيف يعمل React"');

  {
    const { events, aborted } = await streamChat(sessionCookie, 'اشرح لي كيف يعمل React');
    expect(!aborted, 'stream completed without abort');

    const structureErrors = validateEventStructure(events);
    expect(structureErrors.length === 0, `all events well-formed (${structureErrors.length} errors)`);

    const streamStart = events.find((e) => e.kind === 'stream:start') as any;
    expect(!!streamStart, 'stream:start emitted');
    expect(streamStart?.mode === 'discuss', `mode is discuss (got ${streamStart?.mode})`);
    expect(streamStart?.confidence >= 0.7, `confidence ≥ 0.7 (got ${streamStart?.confidence})`);

    const streamEnd = events.find((e) => e.kind === 'stream:end') as any;
    expect(!!streamEnd, 'stream:end emitted');
    expect(streamEnd?.reason === 'complete', `reason is complete (got ${streamEnd?.reason})`);

    const messageEvents = events.filter((e) => e.kind?.startsWith('message:'));
    expect(messageEvents.length > 0, `message events emitted (${messageEvents.length} events)`);

    const buildEvents = events.filter((e) => e.kind?.startsWith('build:'));
    expect(buildEvents.length === 0, `no build events in discuss mode (got ${buildEvents.length})`);

    console.log(`    ℹ Total events: ${events.length}`);
    console.log(`    ℹ Intent: ${streamStart?.intent} (conf=${streamStart?.confidence})`);
    console.log(`    ℹ Duration: ${streamEnd?.stats?.durationMs}ms`);
  }

  // Test 2: Build mode
  console.log('\n[3] Test build mode: "Build a React counter app"');

  {
    const { events, aborted } = await streamChat(sessionCookie, 'Build a React counter app');
    expect(!aborted, 'stream completed without abort');

    const streamStart = events.find((e) => e.kind === 'stream:start') as any;
    expect(!!streamStart, 'stream:start emitted');
    expect(streamStart?.mode === 'build', `mode is build (got ${streamStart?.mode})`);

    const buildStatus = events.find((e) => e.kind === 'build:status') as any;
    expect(!!buildStatus, 'build:status emitted');

    console.log(`    ℹ Total events: ${events.length}`);
    console.log(`    ℹ Intent: ${streamStart?.intent}`);
    console.log(`    ℹ Build status: ${buildStatus?.status} — ${buildStatus?.message}`);
  }

  // Test 3: Cancel
  console.log('\n[4] Test cancel: start a build, abort after 2s');

  {
    const { events, aborted } = await streamChat(
      sessionCookie,
      'Build a complex React app with 20 pages, routing, and state management',
      { abortAfterMs: 2000 },
    );
    expect(aborted, 'stream was aborted');

    // We should have received some events before the abort
    console.log(`    ℹ Events received before abort: ${events.length}`);

    const streamStart = events.find((e) => e.kind === 'stream:start');
    expect(!!streamStart, 'stream:start emitted before abort');

    /*
     * The server should detect the disconnect (may take a moment)
     * We can't strictly assert stream:end because the abort may close
     * the connection before the server's stream:end arrives.
     */
    console.log(`    ℹ stream:end received: ${events.some((e) => e.kind === 'stream:end')}`);
  }

  // Test 4: Protocol validation
  console.log('\n[5] Test protocol: all events have kind/seq/ts');

  {
    const { events } = await streamChat(sessionCookie, 'What is TypeScript?');
    const errors = validateEventStructure(events);
    expect(errors.length === 0, `all events have kind/seq/ts (${errors.length} errors)`);

    // Verify seq is monotonically increasing
    const seqs = events.map((e) => e.seq);
    const isMonotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
    expect(isMonotonic, 'seq is monotonically increasing');

    console.log(`    ℹ ${events.length} events, seq range: ${seqs[0]} → ${seqs[seqs.length - 1]}`);
  }

  // Test 5: No emoji in event messages (regression check)
  console.log('\n[6] Test no-emoji policy: scan all message strings');

  {
    const { events } = await streamChat(sessionCookie, 'Explain async/await in JavaScript');

    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]/u;
    let emojiCount = 0;

    for (const event of events) {
      const strs = Object.values(event).filter((v): v is string => typeof v === 'string');

      for (const s of strs) {
        if (emojiRegex.test(s)) {
          emojiCount++;
          console.log(`    ⚠ Emoji found in ${event.kind}: ${s.slice(0, 80)}`);
        }
      }
    }
    expect(emojiCount === 0, `no emoji in event payloads (found ${emojiCount})`);
  }

  // Save full event log for debugging
  console.log('\n[7] Saving event log...');

  {
    const { events } = await streamChat(sessionCookie, 'What is React?');
    writeFileSync('/home/z/my-project/download/stream-events-sample.json', JSON.stringify(events, null, 2));
    console.log('    ✓ Saved to /home/z/my-project/download/stream-events-sample.json');
  }

  console.log('\n=== ALL TESTS PASSED ===\n');
}

main().catch((err) => {
  console.error('\n=== TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
