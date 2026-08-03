import { describe, expect, it } from 'vitest';
import { NUDGE_MIN_PROMISE_CHARS } from '~/lib/common/llm/constants';
import { validateBuildOutput } from '~/lib/runtime/output-validator';

/**
 * When "this build wrote no files" is worth a second segment, and when it is
 * just an answer.
 *
 * A build turn that produces no artifact gets one nudge asking for the files,
 * and that nudge costs a whole extra round trip — another eight and a half
 * thousand prompt tokens on the measurements from production. It used to fire
 * on any file-less turn. Asked to "reply with exactly: PONG" the model replied
 * PONG, correctly, and was pushed into writing an index.html containing the
 * word PONG.
 *
 * The rule the route applies is reproduced here: a turn is only treated as an
 * abandoned build if it produced nothing AND said enough to have been going
 * somewhere.
 */
const wouldNudge = (text: string) => {
  let producedNothing = false;

  try {
    producedNothing = validateBuildOutput(text).completeness === 'garbage';
  } catch {
    return false;
  }

  return producedNothing && text.trim().length >= NUDGE_MIN_PROMISE_CHARS;
};

const PLAN =
  'I will build a minimal, elegant landing page for the coffee roastery. It will have a hero with a ' +
  'full-bleed photograph, three product cards laid out in a responsive grid, and a contact section with ' +
  'the address and opening hours. Plain HTML and CSS, no build step, everything in one file.';

describe('when a file-less build turn is worth another segment', () => {
  it('nudges a turn that described a build and then wrote nothing', () => {
    expect(wouldNudge(PLAN)).toBe(true);
  });

  /* The case that cost a segment and produced a file nobody wanted. */
  it('leaves a short direct answer alone', () => {
    expect(wouldNudge('PONG')).toBe(false);
    expect(wouldNudge('4')).toBe(false);
    expect(wouldNudge('Yes, that approach works.')).toBe(false);
  });

  it('does not nudge a turn that actually wrote files', () => {
    expect(
      wouldNudge(
        `${PLAN}\n<palmkitArtifact id="a" title="A"><palmkitAction type="file" filePath="index.html">` +
          `<!doctype html></palmkitAction></palmkitArtifact>`,
      ),
    ).toBe(false);
  });

  it('does not nudge an empty turn', () => {
    expect(wouldNudge('')).toBe(false);
    expect(wouldNudge('   \n  ')).toBe(false);
  });

  /*
   * The threshold is about a plan, not about a paragraph — it has to sit well
   * below anything a model writes before building and well above an answer.
   */
  it('sits between an answer and a plan', () => {
    expect(NUDGE_MIN_PROMISE_CHARS).toBeGreaterThan(60);
    expect(NUDGE_MIN_PROMISE_CHARS).toBeLessThan(PLAN.length);
  });
});
