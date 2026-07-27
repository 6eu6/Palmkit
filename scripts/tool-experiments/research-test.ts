/**
 * Quick test for research cases (deep_search, web_search)
 */

import ZAI from 'z-ai-web-dev-sdk';
import { toolRegistry } from '../../app/lib/.server/tools/registry';
import { discussPrompt } from '../../app/lib/common/prompts/discuss-prompt';

async function main() {
  const zai = await ZAI.create();

  const cases = [
    { name: 'Research request', prompt: 'Research the latest trends in AI for 2025.', expected: 'deep_search or web_search' },
    { name: 'Quick factual lookup', prompt: 'What is the current version of Node.js?', expected: 'web_search or markdown' },
  ];

  const tools = toolRegistry.listToolsForMode('work');
  const toolList = tools.map((t) => `- ${t.name}: ${t.description.slice(0, 150)}...`).join('\n');

  const systemPrompt = `${discussPrompt()}

## Available Tools (Work Mode)

You have access to the following tools. Call a tool by responding with a JSON object:
\`\`\`json
{"tool": "<tool_name>", "args": {...}, "reasoning": "..."}
\`\`\`

${toolList}

## Important: Tool Calling Format

When you decide to use a tool, respond with ONLY the JSON object above (no other text).
When you decide NOT to use a tool, respond normally with markdown.`;

  for (const case_ of cases) {
    process.stdout.write(`  ${case_.name.padEnd(40)} `);

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
      const toolMatch = content.match(/"tool"\s*:\s*"([^"]+)"/);

      if (toolMatch) {
        console.log(`✓ tool:${toolMatch[1]}`);
      } else {
        console.log(`✓ markdown (no tool)`);
      }
    } catch (err: any) {
      if (err?.message?.includes('429')) {
        console.log(`[rate-limited, retrying...]`);
        await new Promise((r) => setTimeout(r, 10000));
        continue;
      }
      console.log(`✗ error: ${err?.message}`);
    }

    await new Promise((r) => setTimeout(r, 5000));
  }
}

main().catch(console.error);
