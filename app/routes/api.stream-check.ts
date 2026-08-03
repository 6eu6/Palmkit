/**
 * Does a long streamed response survive this deployment?
 *
 * Long build turns come back truncated in production and never locally: the
 * same request three times gave one finished and two that stopped mid-file,
 * HTTP 200, no error part, no finish event. Everything in the chat route was
 * a suspect — the model, the tools, the segment loop, the watchdog — and
 * narrowing it down by changing the chat route means guessing.
 *
 * This streams bytes and nothing else. No model, no tools, no database. If a
 * response from here also stops early then the request never had a chance and
 * the cause is the runtime, not what the chat route does with it.
 *
 *   /api/stream-check?chunks=400&delay=50   → 400 chunks over 20 seconds
 *   /api/stream-check?proxy=1                → pipe an upstream stream through
 *
 * The proxy mode exists because generating locally is not what the chat route
 * does — that route holds an open connection to the model provider and pipes
 * its stream out.
 *
 * An earlier note here recorded 600 and 1,500 chunks arriving complete and
 * concluded the transport was fine. Those numbers were taken while every
 * deploy was failing at the install step, so this route was not deployed and
 * they did not come from it. Deployed, and measured against the same client
 * the chat probe uses:
 *
 *    400 chunks over 27s    21,098 bytes   complete
 *   1500 chunks over 30s    79,899 bytes   complete
 *   3000 chunks over 30s   160,899 bytes   complete
 *
 * The first of those is the size and the duration of the build turns that die
 * — 18,437 bytes at 26.6 seconds — so the transport really is not the problem,
 * on evidence this time.
 *
 * The last line is `END <n>`, so a truncated response is one that does not
 * have it. Signed-in only: it costs nothing to serve but there is no reason
 * to leave a traffic generator open to the world.
 */
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { DataStreamString } from '@ai-sdk/ui-utils';
import { createDataStream, formatDataStreamPart } from 'ai';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { readAllProviderKeys } from '~/lib/.server/llm/user-keys';

const MAX_CHUNKS = 5000;
const MAX_DELAY_MS = 1000;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user } = await getAuthedUser(request, context);

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);

  /*
   * `??` and not `||`: `Number('0') || 50` is 50, so every "no delay" run was
   * quietly throttled to 20 chunks a second and the fastest case — the one
   * that resembles a token stream — was never actually measured.
   */
  const asNumber = (name: string, fallback: number) => {
    const raw = url.searchParams.get(name);
    const value = raw === null ? NaN : Number(raw);

    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  const chunks = Math.min(asNumber('chunks', 200), MAX_CHUNKS);
  const delay = Math.min(asNumber('delay', 50), MAX_DELAY_MS);

  /*
   * Relay a long upstream stream instead of making one up. Same shape as the
   * chat route: an open subrequest whose body is piped into the response.
   */
  if (url.searchParams.get('proxy')) {
    const upstream = await fetch(new URL(`/api/stream-check?chunks=${chunks}&delay=${delay}`, request.url), {
      headers: { cookie: request.headers.get('cookie') ?? '' },
    });

    return new Response(upstream.body, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  /*
   * The chat route's own shape, with no model behind it.
   *
   * A plain byte stream from here survives 400 chunks over 27 seconds — the
   * same size and duration as the build turns that die — so the transport is
   * not what stops them. What the chat route does differently is everything
   * around the model: `createDataStream`, a merged stream, an `execute` that
   * sits on a promise the provider is supposed to settle, and the whole thing
   * registered with `waitUntil`.
   *
   * This is that structure with a synthetic stream in the model's place and an
   * await that never settles, which is exactly the state the checkpoints show
   * the real route in when it stops. If this also ends around 26 seconds then
   * the cause is the structure and the provider is innocent; if it runs to the
   * end, the provider connection is what dies.
   */
  /*
   * An external streaming subrequest, relayed. Nothing else.
   *
   * Everything else is cleared on evidence. A byte stream survives. A relayed
   * same-origin subrequest survives. The chat route's whole structure —
   * createDataStream, a merged stream, an execute awaiting a promise that
   * never settles, under waitUntil — ran for over two hours and delivered
   * every part. The provider finishes: asked directly, OpenRouter returns
   * finish_reason=stop and [DONE] at 26.3 seconds. Tools and multi-step are
   * out too; one step behaves the same.
   *
   * What is left is the one thing none of those probes has: a connection this
   * Worker holds open to another host while tokens come down it. This opens
   * exactly that and pipes it straight out, with no AI SDK in between — so if
   * it dies part-way, the cause is the connection and not anything this app
   * does with it.
   */
  if (url.searchParams.get('mode') === 'upstream') {
    const { supabase } = await getAuthedUser(request, context);
    const apiKeys = supabase
      ? await readAllProviderKeys(supabase, user.id, getEnv(context).API_KEY_ENCRYPTION_KEY)
      : {};
    const key = apiKeys.OpenRouter;

    if (!key) {
      return new Response('No OpenRouter key stored for this user', { status: 412 });
    }

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: url.searchParams.get('model') ?? 'openai/gpt-5.6-luna',
        stream: true,
        messages: [
          {
            role: 'user',
            content:
              'Build a landing page for a coffee roastery. Plain HTML and CSS in one file called ' +
              'index.html. A hero, three product cards, a contact section. Output the complete file.',
          },
        ],
      }),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (url.searchParams.get('mode') === 'datastream') {
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });

    context.cloudflare?.ctx?.waitUntil?.(done);

    const dataStream = createDataStream({
      async execute(writer) {
        let seq = 0;
        const tick = setInterval(() => writer.writeData({ type: 'checkpoint', seq: seq++ } as never), 2000);

        writer.merge(
          new ReadableStream<DataStreamString>({
            async start(controller) {
              for (let i = 0; i < chunks; i++) {
                controller.enqueue(formatDataStreamPart('text', `${i}:${'x'.repeat(48)}`));

                if (delay > 0) {
                  await new Promise((resolve) => setTimeout(resolve, delay));
                }
              }
              controller.close();
            },
          }),
        );

        /* Never settles — the state the real route is in when it stops. */
        try {
          await new Promise<void>(() => undefined);
        } finally {
          clearInterval(tick);
        }
      },
      onError: (error: any) => `Custom error: ${error?.message ?? error}`,
    });

    const encoder = new TextEncoder();

    return new Response(
      dataStream.pipeThrough(
        new TransformStream<string | Uint8Array, Uint8Array>({
          transform: (chunk, controller) =>
            controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk),
          flush: () => release(),
        }),
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          Connection: 'keep-alive',
          'Cache-Control': 'no-cache',
        },
      },
    );
  }

  /* Roughly the size of a token's worth of streamed text. */
  const filler = 'x'.repeat(48);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      for (let i = 0; i < chunks; i++) {
        controller.enqueue(encoder.encode(`${i}:${filler}\n`));

        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      controller.enqueue(encoder.encode(`END ${chunks}\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
