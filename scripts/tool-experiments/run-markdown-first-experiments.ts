/**
 * Markdown-First Behavior Experiments
 * ====================================
 *
 * Tests whether the LLM respects the new Markdown-first philosophy:
 *   1. Default to markdown (no tool call) for general requests
 *   2. Ask for clarification when format is ambiguous
 *   3. Call the right tool only on EXPLICIT format requests
 *   4. Distinguish between formats (PDF vs DOCX vs XLSX)
 *
 * Test categories:
 *   A. Markdown-default cases (should NOT call any tool)
 *   B. Explicit format requests (should call the right tool)
 *   C. Ambiguous requests (should ask for clarification)
 *   D. Cross-format distinction (PDF vs DOCX vs XLSX)
 *
 * The experiment uses a DIFFERENT methodology than run-experiments.ts:
 *   - We give the model the FULL discussPrompt (system prompt)
 *   - We let it respond naturally (no forced JSON output)
 *   - We analyze the response to detect:
 *     * Did it call a tool? (search for tool name in response)
 *     * Did it ask a question? (search for "?" patterns)
 *     * Did it provide markdown? (search for markdown patterns)
 *
 * Run with: pnpm run test:tools:experiments:markdown-first
 */

import ZAI from 'z-ai-web-dev-sdk';
import { toolRegistry } from '../../app/lib/.server/tools/registry';
import { discussPrompt } from '../../app/lib/common/prompts/discuss-prompt';

interface MarkdownFirstCase {
  name: string;
  prompt: string;
  /**
   * Expected behavior:
   *   - 'markdown' → should respond with markdown, NO tool call
   *   - 'tool:create_pdf' → should call create_pdf tool
   *   - 'tool:create_docx' → should call create_docx tool
   *   - 'tool:create_xlsx' → should call create_xlsx tool
   *   - 'clarify' → should ask for clarification (no tool, has question)
   *   - 'any_tool' → should call ANY tool (for search/research cases)
   */
  expected: 'markdown' | 'tool:create_pdf' | 'tool:create_docx' | 'tool:create_xlsx' | 'tool:web_search' | 'tool:deep_search' | 'clarify' | 'any_tool';
  /** Allow multiple acceptable behaviors */
  acceptable?: Array<'markdown' | 'tool:create_pdf' | 'tool:create_docx' | 'tool:create_xlsx' | 'tool:web_search' | 'tool:deep_search' | 'clarify' | 'any_tool'>;
}

const EXPERIMENT_CASES: MarkdownFirstCase[] = [
  // ═══ A. Markdown-default cases (should NOT auto-call tools) ═══
  {
    name: 'General report request (no format)',
    prompt: 'Write me a report about climate change impacts.',
    expected: 'markdown',
    acceptable: ['markdown', 'clarify'],
  },
  {
    name: 'Summary request (no format)',
    prompt: 'Summarize the key points of microservices architecture.',
    expected: 'markdown',
    acceptable: ['markdown', 'clarify'],
  },
  {
    name: 'Meeting notes (no format)',
    prompt: 'Create meeting notes for a project kickoff.',
    expected: 'markdown',
    acceptable: ['markdown', 'clarify'],
  },
  {
    name: 'Explain a concept',
    prompt: 'Explain how React Server Components work.',
    expected: 'markdown',
  },

  // ═══ B. Explicit format requests (should call the right tool) ═══
  {
    name: 'Explicit PDF request',
    prompt: 'Make me a downloadable PDF about TypeScript best practices.',
    expected: 'tool:create_pdf',
  },
  {
    name: 'Explicit Word request',
    prompt: 'Create a Word document (.docx) with a project proposal.',
    expected: 'tool:create_docx',
  },
  {
    name: 'Explicit Excel request',
    prompt: 'Generate an Excel spreadsheet with this data: Jan=100, Feb=200, Mar=150.',
    expected: 'tool:create_xlsx',
  },
  {
    name: 'Explicit "downloadable file" request',
    prompt: 'I need a downloadable PDF version of the meeting summary.',
    expected: 'tool:create_pdf',
  },

  // ═══ C. Ambiguous requests (should ask for clarification) ═══
  {
    name: 'Ambiguous "document" request',
    prompt: 'Make me a document about our Q4 results.',
    expected: 'clarify',
    acceptable: ['clarify', 'markdown', 'tool:create_pdf', 'tool:create_docx'],
  },
  {
    name: 'Ambiguous "file" request',
    prompt: 'Generate a file with the project plan.',
    expected: 'clarify',
    acceptable: ['clarify', 'markdown'],
  },

  // ═══ D. Research cases (should use search tools) ═══
  {
    name: 'Research request',
    prompt: 'Research the latest trends in AI for 2025.',
    expected: 'tool:deep_search',
    acceptable: ['tool:deep_search' as const, 'tool:web_search' as const, 'any_tool' as const],
  },
  {
    name: 'Quick factual lookup',
    prompt: 'What is the current version of Node.js?',
    expected: 'tool:web_search',
    acceptable: ['tool:web_search', 'markdown'],
  },
];

// ─── Helpers ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; expected: string; actual: string; response: string }> = [];

/**
 * Build the system prompt that combines discussPrompt + tool descriptions.
 * This mirrors what api.chat.ts sends to the model in Work mode.
 */
function buildSystemPrompt(): string {
  const tools = toolRegistry.listToolsForMode('work');
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description.slice(0, 200)}${t.description.length > 200 ? '...' : ''}`)
    .join('\n');

  return `${discussPrompt()}

## Available Tools (Work Mode)

You have access to the following tools. Call a tool by responding with a JSON object:
\`\`\`json
{"tool": "<tool_name>", "args": {...}, "reasoning": "..."}
\`\`\`

${toolList}

## Important: Tool Calling Format

When you decide to use a tool, respond with ONLY the JSON object above (no other text).
When you decide NOT to use a tool (e.g. markdown response), respond normally with markdown.`;
}

/**
 * Analyze the LLM response to detect what it did:
 *   - Called a tool? (which one?)
 *   - Asked a question? (clarification)
 *   - Provided markdown? (default behavior)
 */
function analyzeResponse(content: string): {
  behavior: 'markdown' | 'tool:create_pdf' | 'tool:create_docx' | 'tool:create_xlsx' | 'tool:web_search' | 'tool:deep_search' | 'clarify' | 'any_tool' | 'unknown';
  toolCalled?: string;
  hasQuestion: boolean;
  hasMarkdown: boolean;
} {
  const lower = content.toLowerCase();

  // Check if it called a tool (JSON with "tool" field)
  const toolMatch = content.match(/"tool"\s*:\s*"([^"]+)"/);
  if (toolMatch) {
    const toolName = toolMatch[1];
    return {
      behavior: `tool:${toolName}` as any,
      toolCalled: toolName,
      hasQuestion: false,
      hasMarkdown: false,
    };
  }

  // Check for clarification (question to user)
  const hasQuestion = /\?\s*$/.test(content.trim()) || /\b(would you|do you want|which|what format|prefer)\b.*\?/i.test(content);

  // Check for markdown indicators
  const hasMarkdown = /^#{1,6}\s/m.test(content) || /\*\*[^*]+\*\*/m.test(content) || /^\s*[-*]\s/m.test(content) || /\|.*\|.*\|/m.test(content);

  if (hasQuestion && !hasMarkdown) {
    return { behavior: 'clarify', hasQuestion: true, hasMarkdown: false };
  }

  if (hasMarkdown) {
    return { behavior: 'markdown', hasQuestion: hasQuestion, hasMarkdown: true };
  }

  // Has question + markdown → could be either, lean to markdown
  if (hasQuestion) {
    return { behavior: 'clarify', hasQuestion: true, hasMarkdown: false };
  }

  return { behavior: 'markdown', hasQuestion: false, hasMarkdown: hasMarkdown };
}

async function runExperiment(
  zai: any,
  case_: MarkdownFirstCase,
): Promise<{ ok: boolean; actual: string; response: string; reasoning: string }> {
  const systemPrompt = buildSystemPrompt();

  try {
    const response = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: case_.prompt },
      ],
      stream: false,
      thinking: { type: 'disabled' },
    });

    const content = response.choices?.[0]?.message?.content ?? '';

    if (!content) {
      return { ok: false, actual: 'unknown', response: '', reasoning: 'Empty response' };
    }

    const analysis = analyzeResponse(content);

    // Check if behavior matches expected or acceptable
    const acceptable = case_.acceptable ?? [case_.expected];

    if (acceptable.includes(analysis.behavior as any)) {
      return {
        ok: true,
        actual: analysis.behavior,
        response: content.slice(0, 300),
        reasoning: `Matched: ${analysis.behavior}`,
      };
    }

    return {
      ok: false,
      actual: analysis.behavior,
      response: content.slice(0, 300),
      reasoning: `Expected ${case_.expected} (acceptable: ${acceptable.join(', ')}), got ${analysis.behavior}`,
    };
  } catch (err: any) {
    // Rate limit retry
    if (err?.message?.includes('429')) {
      await new Promise((r) => setTimeout(r, 10000));
      return runExperiment(zai, case_);
    }
    return { ok: false, actual: 'error', response: err?.message ?? 'error', reasoning: 'Exception' };
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('\n=========================================');
  console.log('  Markdown-First Behavior Experiments');
  console.log('  Model: glm-4-plus (via z-ai SDK)');
  console.log('=========================================\n');

  const zai = await ZAI.create();
  console.log(`Running ${EXPERIMENT_CASES.length} experiments...\n`);

  const INTER_DELAY = 5000;

  for (let idx = 0; idx < EXPERIMENT_CASES.length; idx++) {
    const case_ = EXPERIMENT_CASES[idx];

    if (idx > 0) {
      await new Promise((r) => setTimeout(r, INTER_DELAY));
    }

    process.stdout.write(`  [${(idx + 1).toString().padStart(2, ' ')}/${EXPERIMENT_CASES.length}] ${case_.name.padEnd(40)} `);

    const result = await runExperiment(zai, case_);

    if (result.ok) {
      console.log(`\u2713 ${result.actual}`);
      passed++;
    } else {
      console.log(`\u2717 got: ${result.actual}`);
      console.log(`      ${result.reasoning}`);
      console.log(`      Response: ${result.response.slice(0, 200)}...`);
      failed++;
      failures.push({
        name: case_.name,
        expected: case_.expected,
        actual: result.actual,
        response: result.response,
      });
    }
  }

  console.log('\n=========================================');
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`  Total:  ${EXPERIMENT_CASES.length}`);
  console.log('=========================================\n');

  if (failures.length > 0) {
    console.log('Failure breakdown:');
    for (const f of failures) {
      console.log(`  - ${f.name}: expected ${f.expected}, got ${f.actual}`);
    }
  }
}

main().catch((err) => {
  console.error('Crashed:', err);
  process.exit(1);
});
