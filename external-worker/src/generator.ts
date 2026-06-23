/**
 * Generator — Phase 2 LLM generation using Vercel AI SDK
 *
 * Uses the provider registry (provider-registry.ts) so the worker can call
 * ANY of the 22 providers Palmkit supports — NOT just OpenRouter.
 *
 * The user's decrypted API key is passed in (fetched by key-fetcher.ts from
 * the encrypted user_api_keys table). The worker NEVER reads provider keys
 * from its own env vars — keys come from the user's account.
 *
 * Output: file-operations JSON (same format as before).
 */

import { generateText } from 'ai';
import { getModelInstance } from './provider-registry';
import { logger } from './logger';

export interface FileOperation {
  op: 'write_file';
  path: string;
  content: string;
  mime_type?: string;
}

export interface GenerationResult {
  files: FileOperation[];
  complete: boolean;
  rawText: string;
}

export interface ProjectSpec {
  appType: 'static' | 'react' | 'python';
  description: string;
  files: Array<{ path: string; purpose: string }>;
  designNotes: string;
}

/**
 * Phase 1: Plan the project from the user prompt.
 */
export function planProject(prompt: string): ProjectSpec {
  const lower = prompt.toLowerCase();
  const isStatic =
    /html|css|js|javascript|vanilla|static|landing page|no framework|simple/i.test(lower) ||
    !/react|vue|vite|next|svelte|angular|express|flask|python/i.test(lower);

  return {
    appType: isStatic ? 'static' : 'static',
    description: prompt.slice(0, 200),
    files: [
      { path: 'index.html', purpose: 'Main HTML structure with semantic tags' },
      { path: 'styles.css', purpose: 'Complete CSS styling for all elements' },
      { path: 'app.js', purpose: 'JavaScript for interactivity and animations' },
    ],
    designNotes: 'Beautiful, responsive, mobile-first design with modern aesthetics.',
  };
}

function buildSystemPrompt(spec: ProjectSpec): string {
  return `You are Palmkit's build worker. Generate a COMPLETE static web project.

OUTPUT FORMAT (STRICT JSON):
Return a single JSON object with this exact shape:
{
  "files": [
    { "op": "write_file", "path": "index.html", "content": "...full HTML...", "mime_type": "text/html" },
    { "op": "write_file", "path": "styles.css", "content": "...full CSS...", "mime_type": "text/css" },
    { "op": "write_file", "path": "app.js", "content": "...full JS...", "mime_type": "text/javascript" }
  ],
  "complete": true
}

RULES:
1. Generate ALL THREE files: index.html, styles.css, app.js — no exceptions.
2. index.html MUST link to styles.css and app.js:
   <link rel="stylesheet" href="styles.css">
   <script src="app.js"></script>
3. Write COMPLETE file content — no placeholders, no TODO, no "...".
4. Every CSS file must fully style ALL elements in the HTML.
5. Every JS file must have complete, working logic.
6. The JSON must be valid and parseable — escape quotes and newlines properly.
7. Set "complete": true only when all 3 files are fully written.
8. Do NOT wrap the JSON in markdown code fences. Return raw JSON only.

PROJECT SPEC:
- Description: ${spec.description}
- Files: ${spec.files.map((f) => `${f.path} (${f.purpose})`).join(', ')}
- Design: ${spec.designNotes}

QUALITY:
- Mobile-first responsive (test at 390px width).
- Modern design: CSS variables, gradients, shadows, smooth transitions.
- Semantic HTML5, accessible.
- Production quality, not a tutorial example.

Return ONLY the JSON object. No prose before or after.`;
}

/**
 * Phase 2: Generate all static files in ONE LLM call.
 *
 * Uses the Vercel AI SDK with whatever provider the user has configured.
 * The apiKey is the user's DECRYPTED key from user_api_keys.
 */
export async function generateStaticFiles(
  prompt: string,
  spec: ProjectSpec,
  providerName: string,
  modelName: string,
  apiKey: string,
): Promise<GenerationResult> {
  logger.info(`Generating with provider=${providerName}, model=${modelName}`);

  const systemPrompt = buildSystemPrompt(spec);
  const model = getModelInstance(providerName, modelName, apiKey);

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt,
    // Large enough for 3 complete files, small enough to stay fast.
    maxTokens: 16000,
    temperature: 0.7,
  });

  const rawText: string = result.text ?? '';

  if (!rawText) {
    throw new Error(`${providerName} returned empty content (finishReason: ${result.finishReason})`);
  }

  logger.info(`Received ${rawText.length} chars from ${providerName} (usage: ${JSON.stringify(result.usage)})`);

  // Parse the JSON response.
  let parsed: { files?: FileOperation[]; complete?: boolean };

  try {
    parsed = JSON.parse(rawText);
  } catch (parseError: any) {
    // Try to extract JSON from a fenced code block (LLM may have ignored instructions).
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error(
        `LLM did not return valid JSON: ${parseError.message}. First 200 chars: ${rawText.slice(0, 200)}`,
      );
    }

    parsed = JSON.parse(jsonMatch[0]);
  }

  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const complete = Boolean(parsed.complete);

  if (files.length === 0) {
    throw new Error('LLM returned no files in the JSON response');
  }

  // Validate each file has content.
  for (const f of files) {
    if (!f.path || typeof f.content !== 'string') {
      throw new Error(`Invalid file operation: missing path or content`);
    }

    if (f.content.trim().length === 0) {
      throw new Error(`File ${f.path} has empty content`);
    }

    if (!f.mime_type) {
      f.mime_type = inferMimeType(f.path);
    }
  }

  logger.info(`Generation complete: ${files.length} files, complete=${complete}`);

  return { files, complete, rawText };
}

function inferMimeType(path: string): string {
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain';
}

/**
 * Validate the generation result.
 */
export function validateGeneration(result: GenerationResult): string[] {
  const issues: string[] = [];

  if (!result.complete) {
    issues.push('Generation did not set complete=true');
  }

  if (result.files.length < 3) {
    issues.push(`Expected 3 files (index.html, styles.css, app.js), got ${result.files.length}`);
  }

  const paths = result.files.map((f) => f.path);

  if (!paths.includes('index.html')) issues.push('Missing index.html');
  if (!paths.includes('styles.css')) issues.push('Missing styles.css');
  if (!paths.includes('app.js')) issues.push('Missing app.js');

  const html = result.files.find((f) => f.path === 'index.html')?.content ?? '';

  if (html && !html.includes('styles.css')) issues.push('index.html does not link to styles.css');
  if (html && !html.includes('app.js')) issues.push('index.html does not reference app.js');

  for (const f of result.files) {
    if (/\/\/\s*TODO|\/\/\s*FIXME|<!--\s*add.*here\s*-->|<!--\s*COMPLETE/i.test(f.content)) {
      issues.push(`File ${f.path} contains placeholder content`);
    }

    if (f.content.trim().length < 20) {
      issues.push(`File ${f.path} is suspiciously short (${f.content.length} chars)`);
    }
  }

  return issues;
}
