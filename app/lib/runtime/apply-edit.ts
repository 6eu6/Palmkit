/**
 * Change part of a file without rewriting the whole thing.
 *
 * A `file` action carries the finished file, so the smallest change the model
 * can express is "here is the file again". Measured on this app's own prompt:
 * asked to change one accent colour on a landing page, the model spent 6,472
 * output tokens rewriting a 677-line file in which 68 lines actually differed.
 * Ninety percent of what was paid for re-typed lines that were already right,
 * and the edit cost more than building the page had.
 *
 * That is the same on every model and every provider, because it is the
 * format that forces it — which is why this is worth fixing rather than
 * routing around.
 *
 * It is also a correctness problem, not only a cost one. In that same
 * measurement the file came back 76 lines longer than it went in: asked for a
 * colour, the model rewrote the structure. An edit that can only touch what it
 * names cannot quietly redesign the page around it.
 *
 * The format is the search-and-replace block that coding assistants have
 * converged on, because models reproduce it reliably:
 *
 *   <<<<<<< SEARCH
 *   --accent: #b45309;
 *   =======
 *   --accent: #c2410c;
 *   >>>>>>> REPLACE
 *
 * Several blocks may appear in one action; each is applied in turn.
 */

export interface EditBlock {
  search: string;
  replace: string;
}

export interface EditOutcome {
  ok: boolean;
  content: string;
  applied: number;

  /** Why it failed, in words the model can act on. */
  error?: string;
}

const BLOCK = /<{5,9} SEARCH\s*\n([\s\S]*?)\n?={5,9}\s*\n([\s\S]*?)\n?>{5,9} REPLACE/g;

/**
 * The blocks in an edit action's body.
 *
 * The markers are matched loosely on length because models drift by a
 * character or two on a run of angle brackets, and refusing a good edit over
 * one `<` would send the whole file back through the model instead.
 */
export function parseEditBlocks(body: string): EditBlock[] {
  const blocks: EditBlock[] = [];
  let match: RegExpExecArray | null;

  BLOCK.lastIndex = 0;

  while ((match = BLOCK.exec(body)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }

  return blocks;
}

/**
 * Apply the blocks to a file, or explain why not.
 *
 * Nothing is applied unless every block matches. A file with half an edit in
 * it is worse than a file with none: the model believes the change landed and
 * builds its next turn on a file that does not exist.
 *
 * Each SEARCH must appear exactly once. Twice is not a near miss — it means
 * the model has not said which one it meant, and picking the first is a coin
 * toss that silently edits the wrong line.
 */
export function applyEdit(original: string, body: string): EditOutcome {
  const blocks = parseEditBlocks(body);

  if (blocks.length === 0) {
    return {
      ok: false,
      content: original,
      applied: 0,
      error: 'No SEARCH/REPLACE block found. An edit needs at least one.',
    };
  }

  let content = original;

  for (const [i, block] of blocks.entries()) {
    if (block.search === '') {
      return { ok: false, content: original, applied: 0, error: `Block ${i + 1} has an empty SEARCH.` };
    }

    const first = content.indexOf(block.search);

    if (first === -1) {
      /*
       * A near miss is almost always trailing whitespace or indentation, so
       * say which it is — "not found" alone sends the model back to rewriting
       * the whole file, which is the thing being avoided.
       */
      const loose = content.replace(/[ \t]+$/gm, '').indexOf(block.search.replace(/[ \t]+$/gm, ''));
      const hint =
        loose === -1
          ? 'It must match the file exactly, including indentation.'
          : 'It matches except for whitespace at the end of a line — copy the lines exactly as they are.';

      return {
        ok: false,
        content: original,
        applied: 0,
        error: `Block ${i + 1}: the SEARCH text is not in the file. ${hint}`,
      };
    }

    if (content.indexOf(block.search, first + 1) !== -1) {
      return {
        ok: false,
        content: original,
        applied: 0,
        error: `Block ${i + 1}: the SEARCH text appears more than once. Include enough surrounding lines to make it unique.`,
      };
    }

    content = content.slice(0, first) + block.replace + content.slice(first + block.search.length);
  }

  return { ok: true, content, applied: blocks.length };
}
