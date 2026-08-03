import { describe, expect, it } from 'vitest';
import { StreamingMessageParser, parseQuestions, type ParsedQuestion } from '~/lib/runtime/message-parser';
import { asksTheUser, validateBuildOutput } from '~/lib/runtime/output-validator';

/**
 * The questions block — how the model asks when it genuinely cannot proceed.
 *
 * The point of this feature is restraint: a model that knows enough is
 * expected to build and never emit the block at all. What the code has to
 * guarantee is that when it does ask, the turn is treated as waiting rather
 * than as a build that produced nothing — which is what the validator called
 * it before, so the UI said the build had failed while the user was looking
 * at a question.
 */

function render(input: string): string {
  return new StreamingMessageParser().parse('msg-1', input);
}

/* HTML-escaped, the way an attribute has to be — see createQuestionsElement. */
function dataOf(html: string): ParsedQuestion[] {
  const raw = html.match(/data-questions="([^"]*)"/)?.[1];

  if (!raw) {
    return [];
  }

  return JSON.parse(
    raw
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&'),
  );
}

const BLOCK = `<palmkit-questions>
  <palmkit-question ask="Who books through it?" key="audience">
    <palmkit-option>Customers, from the website</palmkit-option>
    <palmkit-option hint="internal tool">Staff, at the counter</palmkit-option>
  </palmkit-question>
</palmkit-questions>`;

describe('parsing a questions block', () => {
  it('reads the question, its key and its options', () => {
    const [q] = parseQuestions(BLOCK);

    expect(q.ask).toBe('Who books through it?');
    expect(q.key).toBe('audience');
    expect(q.options.map((o) => o.label)).toEqual(['Customers, from the website', 'Staff, at the counter']);
    expect(q.options[1].hint).toBe('internal tool');
    expect(q.multiple).toBe(false);
  });

  it('honours multiple="true"', () => {
    const [q] = parseQuestions('<palmkit-question ask="Which pages?" key="pages" multiple="true"></palmkit-question>');
    expect(q.multiple).toBe(true);
  });

  /* A question with no options is still a question — the free-text box is always there. */
  it('accepts a question that offers no options', () => {
    const [q] = parseQuestions('<palmkit-question ask="What is the API URL?" key="url" />');

    expect(q.ask).toBe('What is the API URL?');
    expect(q.options).toEqual([]);
  });

  it('drops a question that asks nothing', () => {
    expect(parseQuestions('<palmkit-question key="empty"></palmkit-question>')).toEqual([]);
  });

  it('drops an option with no label', () => {
    const [q] = parseQuestions(
      '<palmkit-question ask="Pick" key="k"><palmkit-option></palmkit-option><palmkit-option>Real</palmkit-option></palmkit-question>',
    );
    expect(q.options.map((o) => o.label)).toEqual(['Real']);
  });

  it('gives a question without a key one of its own', () => {
    const [q] = parseQuestions('<palmkit-question ask="Which?"></palmkit-question>');
    expect(q.key).toBe('q1');
  });

  it('reads several questions in one block', () => {
    const qs = parseQuestions(
      '<palmkit-question ask="One?" key="a" /><palmkit-question ask="Two?" key="b" />' +
        '<palmkit-question ask="Three?" key="c" />',
    );
    expect(qs.map((q) => q.key)).toEqual(['a', 'b', 'c']);
  });
});

describe('rendering a questions block', () => {
  it('becomes an element the chat can render', () => {
    const html = render(BLOCK);

    expect(html).toContain('__palmkitQuestions__');
    expect(dataOf(html)[0].ask).toBe('Who books through it?');
  });

  it('keeps the text around it', () => {
    const html = render(`Before.\n${BLOCK}\nAfter.`);

    expect(html).toContain('Before.');
    expect(html).toContain('After.');
  });

  /*
   * A half-streamed block would render one option and then rerender with
   * three, which reads as the model changing its mind mid-sentence.
   */
  it('shows nothing until the block is closed', () => {
    const parser = new StreamingMessageParser();
    const partial = parser.parse('m', '<palmkit-questions><palmkit-question ask="Who?" key="a">');

    expect(partial).not.toContain('__palmkitQuestions__');

    const rest = parser.parse('m', `${BLOCK}`);
    expect(rest).toContain('__palmkitQuestions__');
  });

  it('emits nothing for a block with no usable questions', () => {
    expect(render('<palmkit-questions></palmkit-questions>')).not.toContain('__palmkitQuestions__');
  });

  it('survives a quote inside a question', () => {
    const html = render(
      `<palmkit-questions><palmkit-question ask="Say &quot;go&quot;?" key="a" /></palmkit-questions>`,
    );
    expect(dataOf(html)[0].ask).toContain('go');
  });
});

describe('a turn that asks is not a turn that failed', () => {
  it('recognises the block', () => {
    expect(asksTheUser(`Sure — one thing first.\n${BLOCK}`)).toBe(true);
  });

  it('does not see a question where there is none', () => {
    expect(asksTheUser('<palmkitArtifact id="a" title="A"></palmkitArtifact>')).toBe(false);
    expect(asksTheUser('I have a question about your API.')).toBe(false);
  });

  /*
   * This is the behaviour the flag exists to prevent: on its own, the
   * validator calls a question "garbage", which the UI reports as a failed
   * build. The route skips validation when the turn asked.
   */
  it('would otherwise be reported as a failed build', () => {
    expect(validateBuildOutput(`Sure — one thing first.\n${BLOCK}`).completeness).toBe('garbage');
  });
});
