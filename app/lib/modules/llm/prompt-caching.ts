/**
 * Ask the provider to remember the part of the request that never changes.
 *
 * A build turn sends the system prompt — about 7,000 tokens of instructions —
 * and then sends it again for every segment, and again for every later turn in
 * the conversation. Whether that is nearly free or full price depends entirely
 * on whether the provider caches the prefix, and the two families behave
 * differently. Measured against OpenRouter with this app's own prompt:
 *
 *   openai/gpt-5.6-luna        segment 1  $0.00103   0% cached
 *                              segment 2  $0.00028  97% cached
 *                              later turn $0.00025 100% cached
 *   anthropic/claude-sonnet-4.5 every one  $0.02735   0% cached
 *
 * OpenAI and Z-AI cache automatically. Anthropic caches nothing unless the
 * request marks where the stable part ends, so every Claude segment paid full
 * price for the same instructions — twenty-seven times the cost of the same
 * prompt on a model that caches. With the marker, that call drops to about
 * $0.0029.
 *
 * The marker cannot be sent through the AI SDK: the OpenRouter provider
 * pinned here is 0.0.5, which has no notion of cache control. So it is added
 * to the request body on its way out, which is the smallest change that works
 * and does not move a dependency the rest of the app is standing on.
 */

/** Providers that need to be told; the rest cache on their own. */
const NEEDS_EXPLICIT_MARKER = /^(anthropic|google)\//i;

/**
 * The shortest prefix worth caching.
 *
 * Anthropic bills a 25% premium on the call that writes the cache and only
 * refunds it on a hit, so marking a short prompt loses money. This app's is
 * ~7,000 tokens, far above any threshold, but a caller with a tiny custom
 * prompt should not be charged extra for nothing.
 */
const MIN_CACHEABLE_CHARS = 4000;

type Body = {
  model?: string;
  messages?: { role?: string; content?: unknown }[];
  [key: string]: unknown;
};

/**
 * Mark the system message so the provider caches everything up to that point.
 *
 * Returns the body unchanged whenever there is nothing to gain, which is most
 * of the time: a model that caches by itself, a prompt too short to be worth
 * the write premium, or a shape this does not recognise. Never throws — a
 * failure here would cost a whole request to save a fraction of one.
 */
export function withPromptCaching(body: Body): Body {
  try {
    const model = typeof body.model === 'string' ? body.model : '';

    if (!NEEDS_EXPLICIT_MARKER.test(model) || !Array.isArray(body.messages)) {
      return body;
    }

    const index = body.messages.findIndex((m) => m?.role === 'system');

    if (index === -1) {
      return body;
    }

    const system = body.messages[index];
    const text = typeof system.content === 'string' ? system.content : '';

    if (text.length < MIN_CACHEABLE_CHARS) {
      return body;
    }

    const messages = [...body.messages];

    /*
     * The whole system message becomes one cached block. Everything after it
     * — the conversation, the file context, the user's message — stays
     * uncached, which is right: those change on every request, and a cache
     * breakpoint below them would never be hit.
     */
    messages[index] = {
      ...system,
      content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
    };

    return { ...body, messages };
  } catch {
    return body;
  }
}

/**
 * A `fetch` that marks the system prompt on the way past.
 *
 * Wraps whatever fetch the runtime provides, so the provider stays untouched
 * and anything that is not a JSON chat completion goes through unread.
 */
export function cachingFetch(inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    if (!init?.body || typeof init.body !== 'string') {
      return inner(input, init);
    }

    let body: Body;

    try {
      body = JSON.parse(init.body);
    } catch {
      return inner(input, init);
    }

    const marked = withPromptCaching(body);

    if (marked === body) {
      return inner(input, init);
    }

    return inner(input, { ...init, body: JSON.stringify(marked) });
  };
}
