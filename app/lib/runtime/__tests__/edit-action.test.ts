import { describe, expect, it } from 'vitest';
import { StreamingMessageParser } from '~/lib/runtime/message-parser';
import type { PalmkitAction } from '~/types/actions';

/**
 * The edit action, from the stream to something that can be applied.
 *
 * Parsed like any other action, but with one difference that matters: a file
 * action without a path can fall back to showing its content under a made-up
 * name, and an edit action cannot. An edit that does not know which file it
 * changes carries nothing at all.
 */
function parse(input: string) {
  const closed: PalmkitAction[] = [];

  const parser = new StreamingMessageParser({
    callbacks: { onActionClose: (d) => closed.push(d.action) },
  });

  parser.parse('msg-1', input);

  return closed;
}

const wrap = (inner: string) => `<palmkitArtifact id="a" title="A">${inner}</palmkitArtifact>`;

const EDIT = wrap(
  `<palmkitAction type="edit" filePath="index.html">` +
    `<<<<<<< SEARCH\n  --accent: #b45309;\n=======\n  --accent: #c2410c;\n>>>>>>> REPLACE` +
    `</palmkitAction>`,
);

describe('parsing an edit action', () => {
  it('carries the path and the blocks', () => {
    const [action] = parse(EDIT);

    expect(action.type).toBe('edit');
    expect((action as { filePath: string }).filePath).toBe('index.html');
    expect(action.content).toContain('SEARCH');
    expect(action.content).toContain('--accent: #c2410c;');
  });

  it('refuses an edit that does not say which file', () => {
    expect(() => parse(wrap('<palmkitAction type="edit">x</palmkitAction>'))).toThrow(/filePath/i);
  });

  it('does not disturb the actions beside it', () => {
    const actions = parse(
      wrap(
        '<palmkitAction type="file" filePath="a.css">body{}</palmkitAction>' +
          '<palmkitAction type="edit" filePath="index.html">' +
          '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE</palmkitAction>' +
          '<palmkitAction type="shell">npm run build</palmkitAction>',
      ),
    );

    expect(actions.map((a) => a.type)).toEqual(['file', 'edit', 'shell']);
  });

  /*
   * A file action strips markdown fences from its content, because models
   * wrap code in them. An edit must not: its content is markers and code
   * together, and touching it would break the match it depends on.
   */
  it('keeps the block exactly as written', () => {
    const [action] = parse(EDIT);

    expect(action.content).toBe('<<<<<<< SEARCH\n  --accent: #b45309;\n=======\n  --accent: #c2410c;\n>>>>>>> REPLACE');
  });

  it('handles several blocks in one action', () => {
    const [action] = parse(
      wrap(
        '<palmkitAction type="edit" filePath="index.html">' +
          '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' +
          '<<<<<<< SEARCH\nc\n=======\nd\n>>>>>>> REPLACE' +
          '</palmkitAction>',
      ),
    );

    expect((action.content.match(/SEARCH/g) ?? []).length).toBe(2);
  });
});
