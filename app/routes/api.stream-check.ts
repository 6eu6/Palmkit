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
 * its stream out. Measured, and it makes no difference:
 *
 *    600 chunks over 32s   generated ✓   relayed ✓
 *   1500 chunks over 75s   generated ✓   relayed ✓
 *
 * So the transport is not the problem in either direction, and neither was
 * encoding the chunks nor registering the work with waitUntil. Whatever stops
 * a build part-way is in what the chat route does with the stream, or in the
 * provider connection specifically — not in a Worker's ability to hold one
 * open and push bytes down it.
 *
 * The last line is `END <n>`, so a truncated response is one that does not
 * have it. Signed-in only: it costs nothing to serve but there is no reason
 * to leave a traffic generator open to the world.
 */
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';

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
