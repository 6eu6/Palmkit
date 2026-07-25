/**
 * Quick single-experiment test to verify the z-ai SDK works
 * with our FULL system prompt (all tool descriptions).
 */

import ZAI from 'z-ai-web-dev-sdk';
import { toolRegistry } from '../../app/lib/.server/tools/registry';

function buildSystemPrompt(): string {
  const tools = toolRegistry.listToolsForMode('work');
  return `You are a tool router. Available tools:\n\n${
    tools.map((t) => `- ${t.name}: ${t.description.slice(0, 200)}...`).join('\n')
  }\n\nRespond with strict JSON: {"tool": "name", "args": {}, "reasoning": "..."}`;
}

async function main() {
  console.log('Initializing Z-AI SDK...');
  const zai = await ZAI.create();

  const systemPrompt = buildSystemPrompt();
  console.log(`System prompt size: ${systemPrompt.length} chars`);
  console.log('Sending test prompt...');

  const start = Date.now();
  const response = await zai.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Make me a PDF report about climate change.' },
    ],
    stream: false,
    thinking: { type: 'disabled' },
  });
  const elapsed = Date.now() - start;

  console.log(`Response (${elapsed}ms):`);
  console.log(JSON.stringify(response.choices?.[0]?.message?.content, null, 2));
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});

