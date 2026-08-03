// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Message } from 'ai';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';

/*
 * The Remix Vite plugin refuses to load a component unless React Refresh has
 * registered itself on `window` first, and in a test nothing has. Stubbing
 * the two hooks it looks for lets the real component tree load, so this
 * exercises the shipped Markdown pipeline rather than a copy of it.
 */
type Markdowned = typeof import('~/components/chat/Markdown');

let Markdown: Markdowned['Markdown'];

beforeAll(async () => {
  (globalThis as any).$RefreshReg$ = () => undefined;
  (globalThis as any).$RefreshSig$ = () => (type: unknown) => type;
  (window as any).$RefreshReg$ = (globalThis as any).$RefreshReg$;
  (window as any).$RefreshSig$ = (globalThis as any).$RefreshSig$;
  (window as any).__vite_plugin_react_preamble_installed__ = true;

  ({ Markdown } = await import('~/components/chat/Markdown'));
});

/**
 * The whole path a question takes, from what the model wrote to what the user
 * clicks — through the real parser and the real Markdown pipeline, sanitizer
 * included.
 *
 * Worth testing here rather than only in a browser: the sanitizer will drop
 * an attribute it was not told about, and it does so silently. The card would
 * then render with no questions in it and the only symptom would be an empty
 * box in a live chat.
 */
const BLOCK = `Happy to build it — one thing first.

<palmkit-questions>
  <palmkit-question ask="Who books through it?" key="audience">
    <palmkit-option>Customers, from the website</palmkit-option>
    <palmkit-option hint="internal tool">Staff, at the counter</palmkit-option>
  </palmkit-question>
</palmkit-questions>`;

/* Nothing auto-cleans the document here, and a second render would find two of every button. */
afterEach(cleanup);

function renderTurn(source: string, append?: (m: Message) => void) {
  const html = new StreamingMessageParser().parse('msg-1', source);

  return render(
    <Markdown html append={append} model="openai/gpt-5.6-luna" provider={{ name: 'OpenRouter' } as never}>
      {html}
    </Markdown>,
  );
}

describe('the question card, end to end', () => {
  it('renders the question and its options as buttons', () => {
    renderTurn(BLOCK);

    expect(screen.getByText('Who books through it?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Customers, from the website' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Staff, at the counter' })).toBeTruthy();
  });

  it('keeps the sentence the model wrote around it', () => {
    renderTurn(BLOCK);
    expect(screen.getByText(/one thing first/)).toBeTruthy();
  });

  /* The sanitizer drops unknown attributes silently; this is what catches it. */
  it('survives the markdown sanitizer with its questions intact', () => {
    const { container } = renderTurn(BLOCK);

    expect(container.querySelector('input[type="text"]')).toBeTruthy();
    expect(container.textContent).not.toContain('palmkit-question');
  });

  it('offers a free-text box alongside the options', () => {
    const { container } = renderTurn(BLOCK);

    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.placeholder).toMatch(/own words/i);
  });

  it('will not send until something has been answered', () => {
    renderTurn(BLOCK);

    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Staff, at the counter' }));
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the answer back as an ordinary user message', () => {
    const append = vi.fn();
    renderTurn(BLOCK, append);

    fireEvent.click(screen.getByRole('button', { name: 'Staff, at the counter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(append).toHaveBeenCalledTimes(1);

    const text = (append.mock.calls[0][0] as any).content[0].text as string;
    expect(text).toContain('Who books through it? Staff, at the counter');
    expect(text).toContain('[Model: openai/gpt-5.6-luna]');
  });

  it('carries typed text as well as the chips', () => {
    const append = vi.fn();
    const { container } = renderTurn(BLOCK, append);

    fireEvent.click(screen.getByRole('button', { name: 'Customers, from the website' }));
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'for a barber shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const text = (append.mock.calls[0][0] as any).content[0].text as string;
    expect(text).toContain('Customers, from the website, for a barber shop');
  });

  it('lets the user hand the decision back', () => {
    const append = vi.fn();
    renderTurn(BLOCK, append);

    fireEvent.click(screen.getByRole('button', { name: 'Decide for me' }));

    const text = (append.mock.calls[0][0] as any).content[0].text as string;
    expect(text).toMatch(/decide for me/i);
  });

  it('confirms once, and does not offer to answer twice', () => {
    renderTurn(BLOCK, vi.fn());

    fireEvent.click(screen.getByRole('button', { name: 'Staff, at the counter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.getByText(/Answered/)).toBeTruthy();
  });

  /* One selection at a time unless the model says otherwise. */
  it('replaces the choice on a single-answer question', () => {
    const append = vi.fn();
    renderTurn(BLOCK, append);

    fireEvent.click(screen.getByRole('button', { name: 'Staff, at the counter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Customers, from the website' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const text = (append.mock.calls[0][0] as any).content[0].text as string;
    expect(text).toContain('Customers, from the website');
    expect(text).not.toContain('Staff, at the counter');
  });

  it('keeps every choice on a multiple-answer question', () => {
    const append = vi.fn();
    renderTurn(
      `<palmkit-questions><palmkit-question ask="Which pages?" key="p" multiple="true">` +
        `<palmkit-option>Home</palmkit-option><palmkit-option>Pricing</palmkit-option>` +
        `</palmkit-question></palmkit-questions>`,
      append,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pricing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect((append.mock.calls[0][0] as any).content[0].text).toContain('Home, Pricing');
  });

  it('renders a question that offers no options at all', () => {
    const { container } = renderTurn(
      '<palmkit-questions><palmkit-question ask="What is the API URL?" key="u" /></palmkit-questions>',
    );

    expect(screen.getByText('What is the API URL?')).toBeTruthy();
    expect((container.querySelector('input[type="text"]') as HTMLInputElement).placeholder).toMatch(/your answer/i);
  });
});
