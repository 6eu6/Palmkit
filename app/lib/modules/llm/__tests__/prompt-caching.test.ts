import { describe, expect, it, vi } from 'vitest';
import { cachingFetch, withPromptCaching } from '~/lib/modules/llm/prompt-caching';

/**
 * The same system prompt, sent again and again, is most of what a turn costs.
 *
 * Measured against OpenRouter with this app's own prompt: on gpt-5.6-luna the
 * second segment reports 97% of the prefix cached and costs $0.00028 against
 * $0.00103 for the first. On claude-sonnet-4.5 nothing is ever cached and
 * every segment costs $0.02735 — twenty-seven times as much for identical
 * text — because Anthropic caches only what a request explicitly marks.
 */
const LONG = 'You are Palmkit, a build assistant. '.repeat(200);

const body = (model: string, system = LONG) => ({
  model,
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: 'Build a landing page.' },
  ],
});

describe('marking the cacheable prefix', () => {
  it('marks the system prompt for a provider that needs telling', () => {
    const out = withPromptCaching(body('anthropic/claude-sonnet-4.5')) as any;

    expect(out.messages[0].content).toEqual([
      { type: 'text', text: LONG, cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('marks Google too', () => {
    const out = withPromptCaching(body('google/gemini-3-pro')) as any;
    expect(Array.isArray(out.messages[0].content)).toBe(true);
  });

  /*
   * These two cache on their own, and marking them would only risk changing a
   * request that already works.
   */
  it('leaves alone the providers that cache by themselves', () => {
    for (const model of ['openai/gpt-5.6-luna', 'z-ai/glm-4.7', 'meta-llama/llama-4']) {
      const input = body(model);
      expect(withPromptCaching(input), model).toBe(input);
    }
  });

  /*
   * Anthropic charges a premium on the call that writes the cache and only
   * refunds it on a hit, so marking a short prompt loses money.
   */
  it('does not mark a prompt too short to pay for itself', () => {
    const input = body('anthropic/claude-sonnet-4.5', 'Be helpful.');
    expect(withPromptCaching(input)).toBe(input);
  });

  it('leaves the conversation after the system message uncached', () => {
    const out = withPromptCaching(body('anthropic/claude-sonnet-4.5')) as any;

    expect(out.messages).toHaveLength(2);
    expect(out.messages[1]).toEqual({ role: 'user', content: 'Build a landing page.' });
  });

  it('does not mutate the body it was given', () => {
    const input = body('anthropic/claude-sonnet-4.5');
    withPromptCaching(input);
    expect(typeof input.messages[0].content).toBe('string');
  });

  it('passes through anything it does not recognise', () => {
    for (const input of [
      {},
      { model: 'anthropic/claude-sonnet-4.5' },
      { model: 'anthropic/claude-sonnet-4.5', messages: [{ role: 'user', content: 'hi' }] },
      { model: 'anthropic/claude-sonnet-4.5', messages: 'not an array' as never },
    ]) {
      expect(withPromptCaching(input)).toBe(input);
    }
  });

  /* A system message already in parts form has been marked, or means to be. */
  it('leaves an already-structured system message alone', () => {
    const input = {
      model: 'anthropic/claude-sonnet-4.5',
      messages: [{ role: 'system', content: [{ type: 'text', text: LONG }] }],
    };
    expect(withPromptCaching(input)).toBe(input);
  });
});

describe('the fetch that adds it', () => {
  it('rewrites the body on the way past', async () => {
    const inner = vi.fn(async () => new Response('{}'));
    await cachingFetch(inner as never)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body('anthropic/claude-sonnet-4.5')),
    });

    const sent = JSON.parse((inner.mock.calls[0] as any)[1].body);
    expect(sent.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('leaves a request it has no business touching exactly as it was', async () => {
    const inner = vi.fn(async () => new Response('{}'));
    const original = JSON.stringify(body('openai/gpt-5.6-luna'));

    await cachingFetch(inner as never)('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: original,
    });

    expect((inner.mock.calls[0] as any)[1].body).toBe(original);
  });

  it('does not choke on a request with no body, or one that is not JSON', async () => {
    const inner = vi.fn(async () => new Response('{}'));
    const f = cachingFetch(inner as never);

    await f('https://openrouter.ai/api/v1/models');
    await f('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: 'not json' });
    await f('https://openrouter.ai/api/v1/x', { method: 'POST', body: new Uint8Array([1]) as never });

    expect(inner).toHaveBeenCalledTimes(3);
  });
});
