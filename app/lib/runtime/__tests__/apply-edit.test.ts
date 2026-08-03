import { describe, expect, it } from 'vitest';
import { applyEdit, parseEditBlocks } from '~/lib/runtime/apply-edit';

/**
 * Changing part of a file instead of rewriting it.
 *
 * Measured on this app's own prompt: asked to change one accent colour on a
 * landing page, the model spent 6,472 output tokens rewriting a 677-line file
 * in which 68 lines actually differed — and the file came back 76 lines
 * longer than it went in, because a model asked for a colour rewrote the
 * structure around it. After caching, output is roughly ninety percent of what
 * a turn costs, so this is both the money and the risk.
 *
 * The rule that matters most here is all-or-nothing. A file with half an edit
 * applied is worse than one with none: the model believes the change landed
 * and builds its next turn on a file that does not exist.
 */
const PAGE = `:root {
  --accent: #b45309;
  --ink: #1c1917;
}

.button {
  background: var(--accent);
  color: white;
}
`;

const block = (search: string, replace: string) => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;

describe('reading edit blocks', () => {
  it('reads one block', () => {
    const [b] = parseEditBlocks(block('  --accent: #b45309;', '  --accent: #c2410c;'));

    expect(b.search).toBe('  --accent: #b45309;');
    expect(b.replace).toBe('  --accent: #c2410c;');
  });

  it('reads several from one action', () => {
    const body = `${block('a', 'b')}\n\n${block('c', 'd')}`;
    expect(parseEditBlocks(body)).toHaveLength(2);
  });

  it('reads a block spanning several lines', () => {
    const [b] = parseEditBlocks(block('.button {\n  background: var(--accent);', '.button {\n  background: red;'));
    expect(b.search).toContain('\n');
  });

  /*
   * Models drift by a bracket or two; refusing a good edit over one `<` would
   * send the whole file back through the model, which is the thing avoided.
   */
  it('tolerates a marker that is a bracket short or long', () => {
    expect(parseEditBlocks('<<<<<<<< SEARCH\na\n========\nb\n>>>>>>>> REPLACE')).toHaveLength(1);
    expect(parseEditBlocks('<<<<< SEARCH\na\n=====\nb\n>>>>> REPLACE')).toHaveLength(1);
  });

  it('finds nothing in a body that has no blocks', () => {
    expect(parseEditBlocks('just some prose')).toEqual([]);
  });
});

describe('applying an edit', () => {
  it('changes only what it names', () => {
    const out = applyEdit(PAGE, block('  --accent: #b45309;', '  --accent: #c2410c;'));

    expect(out.ok).toBe(true);
    expect(out.applied).toBe(1);
    expect(out.content).toContain('--accent: #c2410c;');
    expect(out.content).toContain('--ink: #1c1917;');
    expect(out.content.split('\n')).toHaveLength(PAGE.split('\n').length);
  });

  it('applies several blocks in order', () => {
    const out = applyEdit(PAGE, `${block('#b45309', '#c2410c')}\n${block('color: white;', 'color: #fff;')}`);

    expect(out.applied).toBe(2);
    expect(out.content).toContain('#c2410c');
    expect(out.content).toContain('color: #fff;');
  });

  it('can delete a line by replacing it with nothing', () => {
    const out = applyEdit(PAGE, '<<<<<<< SEARCH\n  --ink: #1c1917;\n=======\n\n>>>>>>> REPLACE');

    expect(out.ok).toBe(true);
    expect(out.content).not.toContain('--ink');
  });

  /*
   * All-or-nothing. The second block here is fine; the first is not, and the
   * file must come back untouched rather than half-edited.
   */
  it('changes nothing at all when any block fails', () => {
    const out = applyEdit(PAGE, `${block('  --nonexistent: 1;', '  --x: 2;')}\n${block('#b45309', '#c2410c')}`);

    expect(out.ok).toBe(false);
    expect(out.content).toBe(PAGE);
    expect(out.applied).toBe(0);
    expect(out.content).toContain('#b45309');
  });

  it('refuses text that appears twice rather than guessing', () => {
    const out = applyEdit('a\nsame\nb\nsame\nc\n', block('same', 'changed'));

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/more than once/);
    expect(out.content).toBe('a\nsame\nb\nsame\nc\n');
  });

  it('accepts repeated text once enough context makes it unique', () => {
    const out = applyEdit('a\nsame\nb\nsame\nc\n', block('a\nsame', 'a\nchanged'));

    expect(out.ok).toBe(true);
    expect(out.content).toBe('a\nchanged\nb\nsame\nc\n');
  });

  it('says so when there is no block at all', () => {
    const out = applyEdit(PAGE, 'I changed the colour for you.');

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/No SEARCH\/REPLACE block/);
    expect(out.content).toBe(PAGE);
  });

  it('refuses an empty SEARCH instead of matching everywhere', () => {
    const out = applyEdit(PAGE, '<<<<<<< SEARCH\n\n=======\nx\n>>>>>>> REPLACE');
    expect(out.ok).toBe(false);
  });

  /* A near miss is nearly always whitespace, and saying which saves a rewrite. */
  it('explains a whitespace-only mismatch as such', () => {
    /* The model copied the line and added a trailing space to it. */
    const out = applyEdit(PAGE, block('  --accent: #b45309;   ', '  --accent: red;'));

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/whitespace/);
  });

  it('explains an ordinary mismatch differently', () => {
    const out = applyEdit(PAGE, block('  --missing: 0;', '  --x: 1;'));

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/exactly, including indentation/);
  });

  it('leaves a file it cannot edit byte-identical', () => {
    for (const body of ['', 'nonsense', block('nope', 'yes')]) {
      expect(applyEdit(PAGE, body).content).toBe(PAGE);
    }
  });
});

/**
 * The blocks three different model families actually produced, verbatim.
 *
 * Asked to change one accent colour on a landing page they had just built,
 * each returned an edit rather than the file. Kept here because the format
 * only earns its keep if models reproduce it — a parser that accepts a shape
 * nobody emits saves nothing, and this is the evidence that they do.
 *
 *   gpt-5.6-luna        6,472 output tokens → 246   2 lines changed of 475
 *   claude-sonnet-4.5                       → 262   1 line changed of 532
 *   glm-4.7                                 → 385   1 line changed of 781
 *
 * In all three the line count came back unchanged. Rewriting the same file
 * had grown it from 601 lines to 677.
 */
describe('the blocks real models write', () => {
  const CSS = `:root {
  --bg: #faf7f2;
  --accent: #8b5a2b;
  --text: #2c1810;
}

.cta {
  background: var(--accent);
}
`;

  it('applies what gpt-5.6-luna produced', () => {
    const out = applyEdit(
      CSS,
      '<<<<<<< SEARCH\n  --accent: #8b5a2b;\n=======\n  --accent: #c2410c;\n>>>>>>> REPLACE',
    );

    expect(out.ok).toBe(true);
    expect(out.content.split('\n')).toHaveLength(CSS.split('\n').length);
    expect(out.content).toContain('--bg: #faf7f2;');
  });

  it('applies a multi-line block of the kind claude produced', () => {
    const out = applyEdit(
      CSS,
      '<<<<<<< SEARCH\n  --accent: #8b5a2b;\n  --text: #2c1810;\n=======\n  --accent: #c2410c;\n  --text: #2c1810;\n>>>>>>> REPLACE',
    );

    expect(out.ok).toBe(true);
    expect(out.content).toContain('--accent: #c2410c;');
    expect(out.content).toContain('--text: #2c1810;');
  });

  /* Whatever the model, the parts it was not asked about have to survive. */
  it('leaves everything it was not asked about alone', () => {
    const out = applyEdit(CSS, '<<<<<<< SEARCH\n  --accent: #8b5a2b;\n=======\n  --accent: red;\n>>>>>>> REPLACE');

    expect(out.content).toContain('--bg: #faf7f2;');
    expect(out.content).toContain('--text: #2c1810;');
    expect(out.content).toContain('.cta {');
    expect(out.content).toContain('background: var(--accent);');
  });
});
