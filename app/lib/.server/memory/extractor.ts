/**
 * Memory Extractor — async extraction service.
 *
 * Runs AFTER the stream completes (fire-and-forget via ctx.waitUntil).
 * Uses a cheap flash model to extract durable facts from the conversation.
 *
 * Architecture (Mem0-style + Claude/Gemini recommendations):
 *   1. Takes current memory + last N turns
 *   2. Sends to flash model with strict extraction prompt
 *   3. Receives ADD/UPDATE/DELETE operations (JSON)
 *   4. Applies operations to user_memory table
 *   5. Also extracts key=value facts for vector storage
 *
 * Key rules (from Claude analysis):
 *   - Rule 1: Record ONLY what the USER stated, never assistant suggestions
 *   - Rule 6: Empty array is the correct most common outcome
 *   - Compression at 40 lines
 */

import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('memory-extractor');

const EXTRACTION_PROMPT = `You maintain a compact memory file about a user of a coding platform.

<current_memory>
{{CURRENT_MEMORY}}
</current_memory>

<conversation>
{{LAST_N_TURNS}}
</conversation>

TASK
Return only the operations needed to bring the memory file up to date.
Do not rewrite the file. Do not restate unchanged facts.

RULES
1. Record only what the USER stated. Never record what the assistant
   suggested, proposed, or explained — even if the user agreed.
2. One fact per line, as a short natural sentence, in the user's own
   language.
3. If a new fact contradicts an existing line, emit UPDATE — never ADD a
   near-duplicate. Preserve history when useful:
   "uses Next.js (previously React + Vite)"
4. Skip anything that expires: current errors, today's task, file contents,
   which branch they are on.
5. Skip health, religion, politics, financial amounts, credentials, IDs.
6. If nothing durable was stated, return an empty array. This is the
   correct and most common outcome — do not invent facts to fill it.

OUTPUT
Valid JSON only. No markdown fences, no preamble.
{"operations": [
  {"op":"ADD","text":"..."},
  {"op":"UPDATE","target":"<exact existing line>","text":"..."},
  {"op":"DELETE","target":"<exact existing line>"}
]}`;

const COMPRESSION_PROMPT = `This memory file exceeds its size limit. Rewrite it under {{MAX}} lines.
Merge related lines. Drop facts that are no longer acted on.
Keep every explicit user preference and every stated constraint verbatim.
Output the file only, no JSON, no explanations.`;

const MAX_LINES = 40;
const MAX_TURNS = 8;

export interface MemoryOperation {
  op: 'ADD' | 'UPDATE' | 'DELETE';
  text?: string;
  target?: string;
}

export interface ExtractionResult {
  operations: MemoryOperation[];
  newMemory: string;
  changed: boolean;
}

/**
 * Extract memory operations from the last N conversation turns.
 *
 * @param currentMemory - The current memory file content (plain text lines)
 * @param messages - The last N messages from the conversation
 * @param apiKeys - API keys for the LLM provider
 * @returns Extraction result with operations and new memory content
 */
export async function extractMemoryOperations(
  currentMemory: string,
  messages: Array<{ role: string; content: string }>,
  apiKeys: Record<string, string>,
): Promise<ExtractionResult> {
  const openrouterKey = apiKeys.OpenRouter || apiKeys.openrouter;

  if (!openrouterKey) {
    logger.warn('No OpenRouter key available for memory extraction');
    return { operations: [], newMemory: currentMemory, changed: false };
  }

  // Build conversation text from last N turns
  const recentMessages = messages.slice(-MAX_TURNS);
  const conversationText = recentMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

  // Build the prompt
  const prompt = EXTRACTION_PROMPT.replace('{{CURRENT_MEMORY}}', currentMemory || '(empty)').replace(
    '{{LAST_N_TURNS}}',
    conversationText,
  );

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://palmkit.app',
        'X-Title': 'PalmKit Memory Extractor',
      },
      body: JSON.stringify({
        model: 'z-ai/glm-4.7-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      logger.warn(`Memory extraction HTTP ${response.status}`);
      return { operations: [], newMemory: currentMemory, changed: false };
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { operations: [], newMemory: currentMemory, changed: false };
    }

    const parsed = JSON.parse(content);
    const operations: MemoryOperation[] = parsed.operations || [];

    if (operations.length === 0) {
      logger.debug('Memory extraction: no durable facts found (correct outcome)');
      return { operations: [], newMemory: currentMemory, changed: false };
    }

    // Apply operations to get new memory content
    const newMemory = applyOperations(currentMemory, operations);

    // Compress if exceeds max lines
    const finalMemory =
      newMemory.split('\n').length > MAX_LINES ? await compressMemory(newMemory, MAX_LINES, openrouterKey) : newMemory;

    logger.info(`Memory extraction: ${operations.length} operations applied (${newMemory.split('\n').length} lines)`);

    return {
      operations,
      newMemory: finalMemory,
      changed: finalMemory !== currentMemory,
    };
  } catch (err) {
    logger.warn(`Memory extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return { operations: [], newMemory: currentMemory, changed: false };
  }
}

/**
 * Apply ADD/UPDATE/DELETE operations to the memory text.
 */
function applyOperations(currentMemory: string, operations: MemoryOperation[]): string {
  let lines = currentMemory.split('\n').filter((l) => l.trim());

  for (const op of operations) {
    switch (op.op) {
      case 'ADD': {
        if (op.text && !lines.includes(op.text)) {
          lines.push(op.text);
        }

        break;
      }
      case 'UPDATE': {
        if (op.target) {
          const target = op.target;
          const idx = lines.findIndex((l) => l === target || l.includes(target));

          if (idx >= 0 && op.text) {
            lines[idx] = op.text;
          } else if (op.text) {
            // Target not found — just add
            lines.push(op.text);
          }
        }

        break;
      }
      case 'DELETE': {
        if (op.target) {
          const target = op.target;
          lines = lines.filter((l) => l !== target && !l.includes(target));
        }

        break;
      }
    }
  }

  return lines.join('\n');
}

/**
 * Compress memory when it exceeds the line limit.
 */
async function compressMemory(memory: string, maxLines: number, apiKey: string): Promise<string> {
  const prompt = COMPRESSION_PROMPT.replace('{{MAX}}', String(maxLines));

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://palmkit.app',
        'X-Title': 'PalmKit Memory Compressor',
      },
      body: JSON.stringify({
        model: 'z-ai/glm-4.7-flash',
        messages: [
          { role: 'user', content: prompt },
          { role: 'user', content: memory },
        ],
        temperature: 0,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return memory;
    }

    const data: any = await response.json();
    const compressed = data.choices?.[0]?.message?.content;

    return compressed || memory;
  } catch {
    return memory;
  }
}
