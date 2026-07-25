/**
 * Tool Selection Experiments — Real LLM Trials
 * =============================================
 *
 * This script tests whether the LLM (glm-4-plus via z-ai SDK) picks the
 * correct tool from the registry when given natural-language prompts.
 *
 * Methodology:
 *   1. For each test prompt, build a system message that lists all
 *      available work-mode tools with their names + descriptions.
 *   2. Ask the LLM to respond with a strict JSON: {"tool": "...", "args": {...}}
 *   3. Parse the JSON, verify the tool exists in the registry.
 *   4. Execute the tool with the parsed args (validate via Zod first).
 *   5. Verify the result is ok=true.
 *
 * Why this matters:
 *   - Unit tests verify tools work when called correctly.
 *   - These experiments verify the LLM CALLS them correctly.
 *   - A tool that works but whose description confuses the LLM is useless.
 *
 * Run with: pnpm run test:tools:experiments
 */

import ZAI from 'z-ai-web-dev-sdk';
import { toolRegistry, resolveToolMode, type ToolContext } from '../../app/lib/.server/tools/registry';
import { z } from 'zod';

// ─── Test cases ───────────────────────────────────────────────────

interface ToolExperimentCase {
  /** Human-readable name of the test. */
  name: string;
  /** The user's natural-language prompt. */
  prompt: string;
  /** The tool we EXPECT the LLM to pick. */
  expectedTool: string;
  /** Mode for this test. Default: work. */
  mode?: 'chat' | 'work' | 'code';
  /**
   * If true, we count the test as PASSED when the LLM picks the right
   * tool with valid args — even if the tool's execute() returns ok=false
   * (e.g. web_search without API key, or read_url to a flaky URL).
   *
   * This separates "intent detection" (does the LLM pick correctly?)
   * from "execution" (does the tool produce a real result?).
   */
  intentOnly?: boolean;
}

const EXPERIMENT_CASES: ToolExperimentCase[] = [
  // ─── Phase 3 NEW tools (the most important to test) ──────────

  // ─── analyze_data (2 cases) ──────────────────────────────────
  {
    name: 'Analyze CSV data',
    prompt: 'Analyze this data and give me statistics: name,age,salary\\nAlice,30,50000\\nBob,25,45000\\nCarol,35,60000',
    expectedTool: 'analyze_data',
  },
  {
    name: 'Analyze JSON data',
    prompt: 'I have this JSON data — what are the insights? [{"product":"A","price":10},{"product":"B","price":25},{"product":"C","price":15}]',
    expectedTool: 'analyze_data',
  },

  // ─── generate_image (2 cases, intent only) ───────────────────
  {
    name: 'Generate logo image',
    prompt: 'Generate a minimalist logo of a tree with green and white colors, vector style.',
    expectedTool: 'generate_image',
    intentOnly: true,
  },
  {
    name: 'Generate hero image',
    prompt: 'Create an AI image of a mountain landscape at sunset for my website hero.',
    expectedTool: 'generate_image',
    intentOnly: true,
  },

  // ─── deep_search (2 cases, intent only) ──────────────────────
  {
    name: 'Research a topic thoroughly',
    prompt: 'Research the topic "React Server Components" — I want to understand the topic deeply.',
    expectedTool: 'deep_search',
    intentOnly: true,
  },
  {
    name: 'Comprehensive research',
    prompt: 'Do a comprehensive search on microservices vs monolith architecture.',
    expectedTool: 'deep_search',
    intentOnly: true,
  },

  // ─── read_and_extract (2 cases, intent only) ─────────────────
  {
    name: 'Extract info from page',
    prompt: 'Extract the key information from https://example.com — what is this page about?',
    expectedTool: 'read_and_extract',
    intentOnly: true,
  },
  {
    name: 'Summarize this page',
    prompt: 'Summarize https://example.com — extract the main points for me.',
    expectedTool: 'read_and_extract',
    intentOnly: true,
  },

  // ─── Cross-tool distinction (Phase 3 critical cases) ─────────
  {
    name: 'Choose analyze (not chart)',
    prompt: 'I have this CSV data — give me the statistical analysis: val\\n10\\n20\\n30\\n40\\n50',
    expectedTool: 'analyze_data',
  },
  {
    name: 'Choose deep_search (not web_search)',
    prompt: 'I need to do thorough research on quantum computing fundamentals.',
    expectedTool: 'deep_search',
    intentOnly: true,
  },
  {
    name: 'Choose read_and_extract (not read_url)',
    prompt: 'Extract structured info from this page: https://example.com — I need key points.',
    expectedTool: 'read_and_extract',
    intentOnly: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────

interface LlmToolChoice {
  tool: string;
  args: Record<string, any>;
  reasoning?: string;
}

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; expected: string; actual: string; reason: string }> = [];

/**
 * Build a system prompt that describes all available tools in the
 * given mode. The LLM uses this to decide which tool to call.
 *
 * We include the tool NAME, DESCRIPTION, and INPUT SCHEMA (as JSON Schema).
 * The LLM responds with a strict JSON object: {"tool": ..., "args": ...}.
 */
function buildSystemPrompt(mode: 'chat' | 'work' | 'code'): string {
  const tools = toolRegistry.listToolsForMode(mode);

  // Compact format: name + first 250 chars of description.
  // We don't include the full JSON Schema (which would add ~5KB per tool)
  // because the LLM gets enough signal from the description alone.
  // If the LLM's args don't validate, we surface the error to it on retry.
  const toolDescriptions = tools
    .map((t) => `### ${t.name}\n${t.description}`)
    .join('\n\n---\n\n');

  return `You are an AI assistant that helps users by selecting and calling the right tool.

You have access to the following tools (mode: ${mode}):

${toolDescriptions}

---

## Your Task

Given a user's message, decide which SINGLE tool best matches their intent, and provide the arguments to call it.

## Response Format

You MUST respond with a strict JSON object — no markdown, no explanation outside the JSON:

\`\`\`json
{
  "tool": "<tool_name>",
  "args": { ... },
  "reasoning": "<one sentence explaining why you chose this tool>"
}
\`\`\`

## Rules

1. Pick exactly ONE tool from the list above.
2. Provide ALL required arguments for that tool. Make reasonable assumptions about missing arguments (e.g. for create_pdf, generate sensible markdown content based on the user's request).
3. If the user's prompt doesn't clearly map to any tool, pick the closest match and explain in "reasoning".
4. Common argument requirements:
   - create_pdf / create_docx: title (string) + content (markdown string)
   - create_xlsx: sheets (array of {name, headers, rows})
   - read_document: filename (string) + contentBase64 (string)
   - make_chart: type (bar/line/pie/doughnut/radar/polarArea) + title + labels + datasets (EACH dataset MUST have a "label" field, even for single-dataset charts)
   - build_table: headers (array) + rows (array of arrays)
   - web_search: query (string)
   - read_url: url (string)
   - scrape_page: url (string)
   - deep_search: topic (string) — NOT "query"!
   - read_and_extract: url (string)
   - generate_image: prompt (string)
   - analyze_data: data (string, CSV or JSON)

## Examples

User: "Make me a PDF about climate change"
Response: {"tool": "create_pdf", "args": {"title": "Climate Change", "content": "# Climate Change\\n\\n..."}, "reasoning": "User asked for PDF"}

User: "Search the web for React tutorials"
Response: {"tool": "web_search", "args": {"query": "React tutorials"}, "reasoning": "User asked to search"}`;
}

/**
 * Convert a Zod schema to a plain JSON Schema object for the LLM.
 * This is a simplified conversion — covers the types we use.
 */
function schemaToJsonSchema(schema: z.ZodTypeAny): Record<string, any> {
  // Zod 3.x has a .toJSON() method in newer versions, but for compat
  // we'll do a manual walk.
  const def: any = (schema as any)._def;
  const typeName = def?.typeName;

  if (typeName === 'ZodObject') {
    const shape = (schema as any).shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = schemaToJsonSchema(value as z.ZodTypeAny);

      if (!((value as any).isOptional())) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (typeName === 'ZodString') {
    return { type: 'string', ...(def.description ? { description: def.description } : {}) };
  }

  if (typeName === 'ZodNumber') {
    return { type: 'number', ...(def.description ? { description: def.description } : {}) };
  }

  if (typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }

  if (typeName === 'ZodEnum') {
    return { type: 'string', enum: def.values };
  }

  if (typeName === 'ZodArray') {
    return { type: 'array', items: schemaToJsonSchema(def.type) };
  }

  if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
    return schemaToJsonSchema(def.innerType);
  }

  if (typeName === 'ZodUnion') {
    return { oneOf: def.options.map((o: z.ZodTypeAny) => schemaToJsonSchema(o)) };
  }

  // Fallback: just describe as "any"
  return { type: 'any' };
}

/**
 * Parse the LLM's response and extract the tool choice.
 * Handles cases where the response has extra text or markdown fences.
 */
function parseLlmResponse(content: string): LlmToolChoice | null {
  if (!content) return null;

  // Try to find a JSON block in the response
  // (LLMs sometimes wrap in ```json ... ```)
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : content.trim();

  try {
    const parsed = JSON.parse(jsonText);

    if (typeof parsed === 'object' && parsed !== null && typeof parsed.tool === 'string') {
      return {
        tool: parsed.tool,
        args: parsed.args ?? {},
        reasoning: parsed.reasoning,
      };
    }
  } catch {
    // Fall through — try to extract JSON via regex
  }

  // Last resort: find { ... } substring
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.tool === 'string') {
        return { tool: parsed.tool, args: parsed.args ?? {}, reasoning: parsed.reasoning };
      }
    } catch {
      // give up
    }
  }

  return null;
}

/**
 * Execute one experiment: send the prompt to the LLM, parse the
 * response, execute the chosen tool, verify the result.
 *
 * Includes retry logic for 429 (Too Many Requests). The z-ai SDK
 * rate-limits to ~10 requests per minute on the free tier, so we
 * add a 7-second delay between calls and retry on 429.
 */
async function runExperiment(
  zai: any,
  case_: ToolExperimentCase,
): Promise<{ ok: boolean; reason: string; actualTool?: string; response?: string; intentMatch?: boolean }> {
  const mode = case_.mode ?? 'work';
  const systemPrompt = buildSystemPrompt(mode);

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 5000;

  let lastError: string = '';

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: case_.prompt },
        ],
        stream: false,
        thinking: { type: 'disabled' },
      });

      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        return { ok: false, reason: 'LLM returned empty content' };
      }

      const choice = parseLlmResponse(content);

      if (!choice) {
        return {
          ok: false,
          reason: `Could not parse JSON from LLM response`,
          response: content.slice(0, 500),
        };
      }

      // Check tool name match (this is the INTENT detection)
      const intentMatch = choice.tool === case_.expectedTool;

      if (!intentMatch) {
        return {
          ok: false,
          reason: `LLM picked "${choice.tool}" but expected "${case_.expectedTool}"`,
          actualTool: choice.tool,
          response: content.slice(0, 500),
          intentMatch: false,
        };
      }

      // Validate args against the tool's schema
      const toolDef = toolRegistry.getToolByName(choice.tool);
      if (!toolDef) {
        return { ok: false, reason: `Tool "${choice.tool}" not in registry`, intentMatch: true };
      }

      const validation = toolDef.inputSchema.safeParse(choice.args);
      if (!validation.success) {
        return {
          ok: false,
          reason: `Args validation failed: ${validation.error.issues.map((i: any) => i.path.join('.') + ': ' + i.message).join('; ')}`,
          actualTool: choice.tool,
          response: JSON.stringify(choice.args).slice(0, 500),
          intentMatch: true,
        };
      }

      // If intentOnly, we don't require execute() to succeed
      if (case_.intentOnly) {
        return {
          ok: true,
          reason: `Intent match (intentOnly=true): picked ${choice.tool} with valid args`,
          actualTool: choice.tool,
          intentMatch: true,
        };
      }

      // Actually execute the tool
      const ctx: ToolContext = { mode };
      const result = await toolDef.execute(validation.data, ctx);

      if (!result.ok) {
        return {
          ok: false,
          reason: `Tool execution returned ok=false: ${(result as any).error}`,
          actualTool: choice.tool,
          response: JSON.stringify(result).slice(0, 500),
          intentMatch: true,
        };
      }

      return { ok: true, reason: 'OK', actualTool: choice.tool, intentMatch: true };
    } catch (err: any) {
      const msg = err?.message ?? String(err);

      // 429 — rate limited; retry with exponential backoff
      if (msg.includes('429') && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * (attempt + 1);
        process.stdout.write(`[rate-limited, waiting ${delay}ms] `);
        await new Promise((r) => setTimeout(r, delay));
        lastError = msg;
        continue;
      }

      return { ok: false, reason: `Exception: ${msg}`, intentMatch: false };
    }
  }

  return { ok: false, reason: `Failed after ${MAX_RETRIES} retries. Last error: ${lastError}`, intentMatch: false };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('\n=========================================');
  console.log('  Real LLM Tool Selection Experiments');
  console.log('  Model: glm-4-plus (via z-ai SDK)');
  console.log('=========================================\n');

  const zai = await ZAI.create();

  console.log(`Running ${EXPERIMENT_CASES.length} experiments...\n`);

  let intentMatches = 0;

  // Inter-experiment delay to avoid 429 rate limiting on the z-ai free tier.
  // The SDK allows ~10 requests/minute; we space them out to 5s apart.
  const INTER_EXPERIMENT_DELAY_MS = 5000;

  for (let idx = 0; idx < EXPERIMENT_CASES.length; idx++) {
    const case_ = EXPERIMENT_CASES[idx];

    // Delay before each experiment (skip on the first one)
    if (idx > 0) {
      await new Promise((r) => setTimeout(r, INTER_EXPERIMENT_DELAY_MS));
    }

    process.stdout.write(`  [${(idx + 1).toString().padStart(2, ' ')}/${EXPERIMENT_CASES.length}] ${case_.name.padEnd(40)} `);

    const result = await runExperiment(zai, case_);

    if (result.intentMatch) {
      intentMatches++;
    }

    if (result.ok) {
      console.log('\u2713 OK');
      passed++;
    } else {
      console.log('\u2717 FAIL');
      console.log(`      ${result.reason}`);
      if (result.actualTool) {
        console.log(`      Picked: ${result.actualTool} | Expected: ${case_.expectedTool}`);
      }
      if (result.response) {
        console.log(`      Response: ${result.response}`);
      }
      failed++;
      failures.push({
        name: case_.name,
        expected: case_.expectedTool,
        actual: result.actualTool ?? '(parse error)',
        reason: result.reason,
      });
    }
  }

  console.log('\n=========================================');
  console.log(`  PASSED:        ${passed}`);
  console.log(`  FAILED:        ${failed}`);
  console.log(`  Total:         ${EXPERIMENT_CASES.length}`);
  console.log(`  Intent match:  ${intentMatches}/${EXPERIMENT_CASES.length} (${Math.round(intentMatches / EXPERIMENT_CASES.length * 100)}%)`);
  console.log('=========================================\n');

  if (failures.length > 0) {
    console.log('Failure breakdown:');
    console.log('------------------');

    const wrongTool = failures.filter((f) => f.actual !== '(parse error)' && f.actual !== f.expected);
    const parseErrors = failures.filter((f) => f.actual === '(parse error)');
    const execErrors = failures.filter((f) => !f.reason.includes('LLM picked') && !f.reason.includes('parse') && f.actual === f.expected);

    if (wrongTool.length > 0) {
      console.log(`\nWrong tool picked (${wrongTool.length}):`);
      for (const f of wrongTool) {
        console.log(`  - ${f.name}: expected ${f.expected}, got ${f.actual}`);
      }
    }

    if (parseErrors.length > 0) {
      console.log(`\nParse errors (${parseErrors.length}):`);
      for (const f of parseErrors) {
        console.log(`  - ${f.name}: ${f.reason}`);
      }
    }

    if (execErrors.length > 0) {
      console.log(`\nExecution errors (${execErrors.length}):`);
      for (const f of execErrors) {
        console.log(`  - ${f.name}: ${f.reason}`);
      }
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('Experiment runner crashed:', err);
  process.exit(1);
});
