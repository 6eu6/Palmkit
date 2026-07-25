/**
 * Quick re-test for explicit format requests after prompt fixes
 */

import ZAI from 'z-ai-web-dev-sdk';
import { toolRegistry } from '../../app/lib/.server/tools/registry';
import { discussPrompt } from '../../app/lib/common/prompts/discuss-prompt';

async function main() {
  const zai = await ZAI.create();

  const cases = [
    { name: 'Explicit PDF request', prompt: 'Make me a downloadable PDF about TypeScript best practices.', expected: 'create_pdf' },
    { name: 'Explicit Word request', prompt: 'Create a Word document (.docx) with a project proposal.', expected: 'create_docx' },
    { name: 'Explicit Excel request', prompt: 'Generate an Excel spreadsheet with this data: Jan=100, Feb=200, Mar=150.', expected: 'create_xlsx' },
    { name: 'Explicit "downloadable file"', prompt: 'I need a downloadable PDF version of the meeting summary.', expected: 'create_pdf' },
    { name: 'General report (no format)', prompt: 'Write me a report about climate change impacts.', expected: 'markdown (no tool)' },
    { name: 'Ambiguous "document"', prompt: 'Make me a document about our Q4 results.', expected: 'markdown or clarify' },
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

  console.log('\n=== Re-test after prompt fixes ===\n');

  for (const case_ of cases) {
    process.stdout.write(`  ${case_.name.padEnd(35)} `);

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
        console.log(`→ tool:${toolMatch[1]}`);
      } else {
        // Check if it's markdown or clarification
        const hasQuestion = /\?\s*$/.test(content.trim()) || /would you|do you want|which format/i.test(content);
        if (hasQuestion && content.length < 200) {
          console.log(`→ clarify`);
        } else {
          console.log(`→ markdown`);
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('429')) {
        console.log(`[rate-limited, waiting 10s...]`);
        await new Promise((r) => setTimeout(r, 10000));
        // retry once
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
            console.log(`→ tool:${toolMatch[1]} (after retry)`);
          } else {
            console.log(`→ markdown (after retry)`);
          }
        } catch {
          console.log(`✗ error after retry`);
        }
      } else {
        console.log(`✗ error: ${err?.message?.slice(0, 80)}`);
      }
    }

    await new Promise((r) => setTimeout(r, 6000));
  }

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
