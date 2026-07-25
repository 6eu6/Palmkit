/**
 * Re-run the 2 failed code-mode cases (rate limited)
 */

import ZAI from 'z-ai-web-dev-sdk';
import { toolRegistry } from '../../app/lib/.server/tools/registry';

async function main() {
  const zai = await ZAI.create();

  const cases = [
    { name: 'run_shell (not read_sandbox_file)', prompt: 'Run "ls -la" in the sandbox to see the directory listing.', expected: 'run_shell' },
    { name: 'screenshot (not run_shell)', prompt: 'Capture a visual screenshot of the running app to check its appearance.', expected: 'screenshot' },
  ];

  const tools = toolRegistry.listToolsForMode('code');
  const toolList = tools.map((t) => `### ${t.name}\n${t.description}`).join('\n\n---\n\n');

  const systemPrompt = `You are an AI assistant that helps users by selecting and calling the right tool.

You have access to the following tools (mode: code):

${toolList}

---

## Response Format

Respond with strict JSON:
\`\`\`json
{"tool": "<tool_name>", "args": {...}, "reasoning": "..."}
\`\`\`

## Common argument requirements:
   - read_file: path (string)
   - list_files: optional filter
   - grep: pattern (string)
   - run_shell: command (string)
   - screenshot: optional url
   - read_sandbox_file: path (string)
   - web_search: query (string)
   - read_url: url (string)`;

  console.log('\n=== Code-mode re-test (2 cases) ===\n');

  for (const case_ of cases) {
    process.stdout.write(`  ${case_.name.padEnd(40)} `);

    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
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
          success = true;
        } else {
          console.log(`✗ no tool (markdown)`);
          success = true;
        }
        break;
      } catch (err: any) {
        if (err?.message?.includes('429')) {
          process.stdout.write(`[retry ${attempt + 1}, waiting 15s...] `);
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        console.log(`✗ error: ${err?.message?.slice(0, 60)}`);
        success = true;
        break;
      }
    }

    if (!success) {
      console.log(`✗ failed after 3 retries`);
    }

    await new Promise((r) => setTimeout(r, 8000));
  }

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
