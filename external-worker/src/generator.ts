/**
 * Generator — Phase 2 LLM generation using Vercel AI SDK
 *
 * Supports three app types classified from the user prompt:
 *   static  → HTML + CSS + JS (iframe preview, no sandbox)
 *   react   → React + Vite (WebContainer / E2B preview)
 *   python  → Python (E2B preview)
 *
 * Each type uses a different file plan and system prompt so the LLM
 * generates the correct structure without guessing.
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
  appType: ProjectSpec['appType'];
}

export interface ProjectSpec {
  appType: 'static' | 'react' | 'nextjs' | 'vue' | 'python';
  description: string;
  files: Array<{ path: string; purpose: string }>;
  designNotes: string;
}

/**
 * Classify the prompt and build a file plan.
 */
export function planProject(prompt: string): ProjectSpec {
  const lower = prompt.toLowerCase();

  const isPython = /python|flask|fastapi|django|pip\b/i.test(lower);
  const isNextjs = /next\.?js|nextjs|next app|app router|pages router/i.test(lower);
  const isVue = /\bvue\b|vuex|pinia|nuxt/i.test(lower);
  const isReact =
    /\breact\b|vite.*react|react.*vite|tsx|jsx|shadcn|radix|hooks?|useState|useEffect|react native/i.test(lower);
  const isExplicitlyStatic =
    /\bhtml\b|\bvanilla\b|\bstatic\b|landing page|no framework|no react|without react|pure js|plain js/i.test(lower);

  let appType: ProjectSpec['appType'];

  if (isPython && !isReact && !isVue) {
    appType = 'python';
  } else if (isNextjs) {
    appType = 'nextjs';
  } else if (isVue && !isReact) {
    appType = 'vue';
  } else if (isReact && !isExplicitlyStatic) {
    appType = 'react';
  } else {
    appType = 'static';
  }

  const filePlans: Record<ProjectSpec['appType'], Array<{ path: string; purpose: string }>> = {
    static: [
      { path: 'index.html', purpose: 'Main HTML with all sections and Tailwind CDN' },
      { path: 'styles.css', purpose: 'Custom CSS, animations, responsive rules' },
      { path: 'app.js', purpose: 'All interactivity, animations, and logic' },
    ],
    react: [
      { path: 'package.json', purpose: 'Vite + React + Tailwind dependencies' },
      { path: 'index.html', purpose: 'Vite entry HTML' },
      { path: 'vite.config.js', purpose: 'Vite configuration' },
      { path: 'tailwind.config.js', purpose: 'Tailwind configuration' },
      { path: 'src/main.jsx', purpose: 'React entry point' },
      { path: 'src/App.jsx', purpose: 'Root App component with routing' },
      { path: 'src/index.css', purpose: 'Tailwind directives + global styles' },
    ],
    nextjs: [
      { path: 'package.json', purpose: 'Next.js + Tailwind dependencies' },
      { path: 'next.config.js', purpose: 'Next.js configuration' },
      { path: 'tailwind.config.js', purpose: 'Tailwind configuration' },
      { path: 'app/layout.tsx', purpose: 'Root layout with metadata' },
      { path: 'app/page.tsx', purpose: 'Home page component' },
      { path: 'app/globals.css', purpose: 'Tailwind directives + global styles' },
    ],
    vue: [
      { path: 'package.json', purpose: 'Vite + Vue 3 + Tailwind dependencies' },
      { path: 'index.html', purpose: 'Vite entry HTML' },
      { path: 'vite.config.js', purpose: 'Vite + Vue plugin configuration' },
      { path: 'src/main.js', purpose: 'Vue app entry point' },
      { path: 'src/App.vue', purpose: 'Root Vue component' },
      { path: 'src/style.css', purpose: 'Tailwind directives + global styles' },
    ],
    python: [
      { path: 'app.py', purpose: 'Flask/FastAPI application with all routes' },
      { path: 'requirements.txt', purpose: 'Python dependencies' },
      { path: 'templates/index.html', purpose: 'Jinja2/HTML template' },
    ],
  };

  return {
    appType,
    description: prompt.slice(0, 400),
    files: filePlans[appType],
    designNotes: 'Beautiful, responsive, mobile-first design. Modern aesthetics, production quality.',
  };
}

const JSON_RULES = `STRICT RULES:
- Return raw JSON ONLY. No markdown, no backticks, no explanation.
- Write COMPLETE file content — no placeholders, no TODO, no "...".
- Escape all quotes (\\") and newlines (\\n) inside JSON string values.
- "complete": true only when every file is fully written.
- Production quality: beautiful UI, real logic, no stubs.`;

function buildSystemPrompt(spec: ProjectSpec): string {
  if (spec.appType === 'static') {
    return `You are Palmkit's build worker. Generate a COMPLETE, production-quality static web project.

OUTPUT FORMAT:
{ "files": [
    { "op": "write_file", "path": "index.html", "content": "...full HTML...", "mime_type": "text/html" },
    { "op": "write_file", "path": "styles.css",  "content": "...full CSS...",  "mime_type": "text/css" },
    { "op": "write_file", "path": "app.js",       "content": "...full JS...",   "mime_type": "text/javascript" }
  ], "complete": true }

${JSON_RULES}
- index.html MUST link styles.css and app.js.
- Use Tailwind CDN (<script src="https://cdn.tailwindcss.com"></script>) OR write your own CSS in styles.css.
- Mobile-first (375px base), semantic HTML5, smooth animations, accessible.

PROJECT: ${spec.description}
DESIGN: ${spec.designNotes}`;
  }

  if (spec.appType === 'react') {
    return `You are Palmkit's build worker. Generate a COMPLETE React + Vite + Tailwind project.

OUTPUT FORMAT:
{ "files": [
    { "op": "write_file", "path": "package.json",    "content": "...", "mime_type": "application/json" },
    { "op": "write_file", "path": "index.html",       "content": "...", "mime_type": "text/html" },
    { "op": "write_file", "path": "vite.config.js",   "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "tailwind.config.js","content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "src/main.jsx",     "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "src/App.jsx",      "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "src/index.css",    "content": "...", "mime_type": "text/css" }
  ], "complete": true }

${JSON_RULES}
- package.json: react 18, react-dom 18, vite 5, @vitejs/plugin-react, tailwindcss, autoprefixer, postcss.
- src/index.css: @tailwind base; @tailwind components; @tailwind utilities;
- Mobile-first, component-based, real app logic.

PROJECT: ${spec.description}
DESIGN: ${spec.designNotes}`;
  }

  if (spec.appType === 'nextjs') {
    return `You are Palmkit's build worker. Generate a COMPLETE Next.js 14 App Router + Tailwind project.

OUTPUT FORMAT:
{ "files": [
    { "op": "write_file", "path": "package.json",        "content": "...", "mime_type": "application/json" },
    { "op": "write_file", "path": "next.config.js",      "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "tailwind.config.js",  "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "postcss.config.js",   "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "app/layout.tsx",      "content": "...", "mime_type": "text/typescript" },
    { "op": "write_file", "path": "app/page.tsx",        "content": "...", "mime_type": "text/typescript" },
    { "op": "write_file", "path": "app/globals.css",     "content": "...", "mime_type": "text/css" }
  ], "complete": true }

${JSON_RULES}
- package.json: next 14, react 18, react-dom 18, typescript, tailwindcss, autoprefixer, postcss.
- Use 'use client' directive only where needed (interactivity).
- app/globals.css: @tailwind base; @tailwind components; @tailwind utilities;
- Mobile-first, TypeScript strict, Server Components by default.

PROJECT: ${spec.description}
DESIGN: ${spec.designNotes}`;
  }

  if (spec.appType === 'vue') {
    return `You are Palmkit's build worker. Generate a COMPLETE Vue 3 + Vite + Tailwind project.

OUTPUT FORMAT:
{ "files": [
    { "op": "write_file", "path": "package.json",    "content": "...", "mime_type": "application/json" },
    { "op": "write_file", "path": "index.html",       "content": "...", "mime_type": "text/html" },
    { "op": "write_file", "path": "vite.config.js",   "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "tailwind.config.js","content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "src/main.js",      "content": "...", "mime_type": "text/javascript" },
    { "op": "write_file", "path": "src/App.vue",      "content": "...", "mime_type": "text/x-vue" },
    { "op": "write_file", "path": "src/style.css",    "content": "...", "mime_type": "text/css" }
  ], "complete": true }

${JSON_RULES}
- package.json: vue 3, vite 5, @vitejs/plugin-vue, tailwindcss, autoprefixer, postcss.
- Use Composition API (<script setup>).
- Mobile-first, reactive, real app logic.

PROJECT: ${spec.description}
DESIGN: ${spec.designNotes}`;
  }

  // python
  return `You are Palmkit's build worker. Generate a COMPLETE Python web application.

OUTPUT FORMAT:
{ "files": [
    { "op": "write_file", "path": "app.py",              "content": "...", "mime_type": "text/x-python" },
    { "op": "write_file", "path": "requirements.txt",    "content": "...", "mime_type": "text/plain" },
    { "op": "write_file", "path": "templates/index.html","content": "...", "mime_type": "text/html" }
  ], "complete": true }

${JSON_RULES}
- Use Flask (preferred) or FastAPI.
- requirements.txt: all deps, pinned versions.
- Complete routes, real logic, no stubs.

PROJECT: ${spec.description}`;
}

/**
 * Generate project files using the LLM.
 */
export async function generateStaticFiles(
  prompt: string,
  spec: ProjectSpec,
  providerName: string,
  modelName: string,
  apiKey: string,
): Promise<GenerationResult> {
  logger.info(`Generating ${spec.appType} with provider=${providerName}, model=${modelName}`);

  const systemPrompt = buildSystemPrompt(spec);
  const model = getModelInstance(providerName, modelName, apiKey);

  const maxTokens = spec.appType === 'static' || spec.appType === 'python' ? 16000 : 32000;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt,
    maxTokens,
    temperature: 0.7,
  });

  const rawText: string = result.text ?? '';

  if (!rawText) {
    throw new Error(`${providerName} returned empty content (finishReason: ${result.finishReason})`);
  }

  logger.info(`Received ${rawText.length} chars from ${providerName} (usage: ${JSON.stringify(result.usage)})`);

  let parsed: { files?: FileOperation[]; complete?: boolean };

  try {
    parsed = JSON.parse(rawText);
  } catch (parseError: any) {
    // Try outer regex first (strips markdown fences etc.)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    try {
      parsed = JSON.parse(jsonMatch?.[0] ?? '');
    } catch {
      // JSON was truncated mid-stream (model hit token limit).
      // Walk the text with a state machine and recover all complete file objects.
      const recovered = extractPartialFiles(rawText);

      if (recovered.length === 0) {
        throw new Error(
          `LLM did not return valid JSON: ${parseError.message}. First 200 chars: ${rawText.slice(0, 200)}`,
        );
      }

      logger.warn(`JSON truncated — recovered ${recovered.length} file(s) from partial response`);
      parsed = { files: recovered, complete: false };
    }
  }

  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const complete = Boolean(parsed.complete);

  if (files.length === 0) {
    throw new Error('LLM returned no files in the JSON response');
  }

  for (const f of files) {
    if (!f.path || typeof f.content !== 'string') {
      throw new Error('Invalid file operation: missing path or content');
    }

    if (f.content.trim().length === 0) {
      throw new Error(`File ${f.path} has empty content`);
    }

    if (!f.mime_type) {
      f.mime_type = inferMimeType(f.path);
    }
  }

  logger.info(`Generation complete: ${files.length} files, appType=${spec.appType}, complete=${complete}`);

  return { files, complete, rawText, appType: spec.appType };
}

/**
 * Walk truncated JSON text with a state machine and extract all complete
 * file objects from the "files" array before the truncation point.
 * Used when the LLM hits its output-token limit mid-stream.
 */
function extractPartialFiles(text: string): FileOperation[] {
  const filesIdx = text.indexOf('"files"');
  if (filesIdx === -1) return [];

  const arrayStart = text.indexOf('[', filesIdx);
  if (arrayStart === -1) return [];

  const files: FileOperation[] = [];
  let i = arrayStart + 1;

  while (i < text.length) {
    // Skip whitespace / commas between objects
    while (i < text.length && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t' || text[i] === ',')) i++;

    if (text[i] !== '{') break;

    // Found start of an object — find its end by tracking brace/string depth
    const objStart = i;
    let depth = 0;
    let inString = false;

    while (i < text.length) {
      const ch = text[i];

      if (inString) {
        if (ch === '\\') {
          i++; // skip escaped char
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            // Complete object found
            const objText = text.slice(objStart, i + 1);

            try {
              const obj = JSON.parse(objText) as FileOperation;

              if (obj.path && typeof obj.content === 'string' && obj.content.trim().length > 0) {
                if (!obj.mime_type) obj.mime_type = inferMimeType(obj.path);
                files.push(obj);
              }
            } catch {
              // Malformed object — skip
            }

            i++;
            break;
          }
        }
      }

      i++;
    }
  }

  return files;
}

function inferMimeType(path: string): string {
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'text/javascript';
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'text/typescript';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.py')) return 'text/x-python';
  if (path.endsWith('.txt')) return 'text/plain';
  return 'text/plain';
}

/**
 * Validate the generation result based on the app type.
 */
export function validateGeneration(result: GenerationResult): string[] {
  const issues: string[] = [];

  if (!result.complete) {
    issues.push('Generation did not set complete=true');
  }

  const paths = result.files.map((f) => f.path);

  if (result.appType === 'static') {
    if (!paths.includes('index.html')) issues.push('Missing index.html');
    if (!paths.includes('styles.css')) issues.push('Missing styles.css');
    if (!paths.includes('app.js')) issues.push('Missing app.js');

    const html = result.files.find((f) => f.path === 'index.html')?.content ?? '';
    if (html && !html.includes('styles.css')) issues.push('index.html does not link to styles.css');
    if (html && !html.includes('app.js')) issues.push('index.html does not reference app.js');
  } else if (result.appType === 'react') {
    if (!paths.includes('package.json')) issues.push('Missing package.json');
    if (!paths.some((p) => p.endsWith('App.jsx') || p.endsWith('App.tsx'))) {
      issues.push('Missing App component');
    }
    if (!paths.some((p) => p.endsWith('main.jsx') || p.endsWith('main.tsx'))) {
      issues.push('Missing main entry point');
    }
  } else if (result.appType === 'python') {
    if (!paths.some((p) => p.endsWith('.py'))) issues.push('Missing Python file');
    if (!paths.includes('requirements.txt')) issues.push('Missing requirements.txt');
  }

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
