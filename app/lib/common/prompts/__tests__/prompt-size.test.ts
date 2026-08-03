import { describe, expect, it } from 'vitest';
import { getFineTunedPrompt } from '~/lib/common/prompts/new-prompt';
import { toolRegistry } from '~/lib/.server/tools/registry';

/**
 * What a turn costs before the model has written a word.
 *
 * Measured on the live app: every segment sends ~8,550 prompt tokens, a
 * two-segment turn sends ~17,500, and the completion is ~3,600. So most of
 * what is paid for is the same instructions, sent again and again.
 *
 * This is not a pass/fail test in the usual sense — it is a budget. If a
 * section grows, this says so, and the number in the assertion is the number
 * that was measured, not a target invented here.
 */

/** Close enough for budgeting: ~3.7 characters per token on English prose. */
const tokens = (s: string) => Math.round(s.length / 3.7);

const PROMPT = getFineTunedPrompt('/home/project', { isConnected: false, hasSelectedProject: false });

describe('what the model is charged to read', () => {
  it('reports where the system prompt goes', () => {
    const sections = [...PROMPT.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)]
      .map((m) => ({ name: m[1], t: tokens(m[0]) }))
      .sort((a, b) => b.t - a.t);

    const counted = sections.reduce((n, s) => n + s.t, 0);

    console.log(`\n  system prompt: ${tokens(PROMPT)} tokens (${PROMPT.length} chars)`);

    for (const s of sections) {
      console.log(`    ${String(s.t).padStart(5)}  ${s.name}`);
    }

    console.log(`    ${String(tokens(PROMPT) - counted).padStart(5)}  (outside any section)`);

    expect(sections.length).toBeGreaterThan(0);
  });

  it('reports what the tool definitions cost', () => {
    for (const mode of ['chat', 'work', 'code'] as const) {
      const defs = Object.entries(toolRegistry.getToolsForMode(mode, { mode } as never));

      /* Descriptions plus the JSON schema of every parameter — all of it is sent. */
      const weigh = ([name, t]: [string, any]) =>
        tokens(name + (t.description ?? '') + JSON.stringify(t.parameters?.jsonSchema ?? t.parameters ?? {}));
      const total = defs.reduce((n, d) => n + weigh(d), 0);

      console.log(`\n  ${mode}: ${defs.length} tools, ~${total} tokens`);

      for (const d of [...defs].sort((a, b) => weigh(b) - weigh(a)).slice(0, 6)) {
        console.log(`    ${String(weigh(d)).padStart(4)}  ${d[0]}`);
      }
    }

    expect(Object.keys(toolRegistry.getToolsForMode('code', { mode: 'code' } as never)).length).toBeGreaterThan(0);
  });

  /*
   * A budget, so that a section doubling in size is a test failure and not a
   * surprise on the invoice.
   */
  it('stays within the budget it was measured at', () => {
    expect(tokens(PROMPT)).toBeLessThan(9000);
  });
});
