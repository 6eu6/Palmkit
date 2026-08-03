import { describe, expect, it } from 'vitest';
import { attachContext } from '~/lib/.server/llm/stream-text';

/**
 * Where per-request context sits, and what it costs to put it in the wrong
 * place.
 *
 * A provider caches the longest identical prefix it has seen. The memory
 * block, the chat summary and the file context used to be appended to the
 * system prompt — before the conversation — so a memory block that had
 * learned one new fact invalidated the cache for the system prompt and the
 * whole history behind it. Measured on OpenRouter with this app's own prompt
 * and four turns of history, each request carrying a memory block it had
 * never seen:
 *
 *   in the system prompt      0% cached   $0.00116
 *   after the conversation   74% cached   $0.00039
 */
const conversation = [
  { role: 'user' as const, content: 'Build a landing page.' },
  { role: 'assistant' as const, content: 'Here it is.' },
  { role: 'user' as const, content: 'Add pricing.' },
];

describe('attaching per-request context', () => {
  it('puts it on the last user message', () => {
    const out = attachContext(conversation, ['MEMORY: prefers dark mode']);

    expect(out[2].content).toContain('Add pricing.');
    expect(out[2].content).toContain('MEMORY: prefers dark mode');
  });

  it('leaves everything before it byte-identical', () => {
    const out = attachContext(conversation, ['MEMORY: x']);

    expect(out[0]).toBe(conversation[0]);
    expect(out[1]).toBe(conversation[1]);
  });

  it('does nothing when there is nothing to attach', () => {
    expect(attachContext(conversation, [])).toBe(conversation);
  });

  it('keeps the blocks in order and separated', () => {
    const out = attachContext(conversation, ['FIRST', 'SECOND']);
    const text = out[2].content as string;

    expect(text.indexOf('FIRST')).toBeLessThan(text.indexOf('SECOND'));
    expect(text).toContain('FIRST\n\nSECOND');
  });

  /*
   * A message can carry an attached image or a pasted file as parts. Replacing
   * that array with a string would silently drop whatever the user attached.
   */
  it('keeps an attachment intact and adds the context beside it', () => {
    const withImage = [
      { role: 'user' as const, content: [{ type: 'image', image: 'data:image/png;base64,AAA' }] as never },
    ];
    const out = attachContext(withImage, ['MEMORY: x']);
    const parts = out[0].content as unknown as { type: string; text?: string }[];

    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('image');
    expect(parts[1].text).toContain('MEMORY: x');
  });

  it('does not mutate the messages it was given', () => {
    const original = 'Add pricing.';
    attachContext(conversation, ['MEMORY: x']);
    expect(conversation[2].content).toBe(original);
  });

  it('attaches nothing when there is no user message to attach to', () => {
    const noUser = [{ role: 'assistant' as const, content: 'hello' }];
    expect(attachContext(noUser, ['MEMORY: x'])).toBe(noUser);
  });

  /* The last user message, not the first — that is the one being answered. */
  it('chooses the most recent user message', () => {
    const out = attachContext(conversation, ['MEMORY: x']);

    expect(out[0].content).not.toContain('MEMORY');
    expect(out[2].content).toContain('MEMORY');
  });
});
