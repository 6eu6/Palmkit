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

import { generateText, streamText } from 'ai';
import { getModelInstance } from './provider-registry';
import { logger } from './logger';

/**
 * Per-provider and per-model completion token limits.
 *
 * BUG FIX (2026-06-29): Previously maxTokens was hardcoded to 16000/32000. When
 * the LLM generated a large project (many files, long content), the response
 * hit the token cap mid-JSON → truncated output → "JSON truncated — recovered
 * N file(s) from partial response" → missing files → validation failure.
 *
 * Now we:
 *   1. Look up the model's actual maxCompletionTokens (passed in via spec).
 *   2. Fall back to a generous default (128000) — never the old 16000 cap.
 *   3. If the response is still truncated (finishReason === 'length'),
 *      auto-continue with a follow-up prompt asking for the remaining files.
 */

/** Default per-app-type token budgets when model limit is unknown. */
const DEFAULT_MAX_TOKENS: Record<ProjectSpec['appType'], number> = {
  static: 64000,
  python: 64000,
  react: 128000,
  nextjs: 128000,
  vue: 128000,
  flutter: 128000,
  'react-native': 128000,
};

/** Hard floor so we never go below this even if the model reports a tiny limit. */
const MIN_MAX_TOKENS = 32000;

/**
 * Resolve the maxTokens to send to the LLM.
 * Prefers spec.maxCompletionTokens (from /api/models lookup), else default per app type.
 */
function resolveMaxTokens(spec: ProjectSpec, maxCompletionTokens?: number): number {
  if (maxCompletionTokens && maxCompletionTokens > 0) {
    return Math.max(maxCompletionTokens, MIN_MAX_TOKENS);
  }

  return DEFAULT_MAX_TOKENS[spec.appType] ?? MIN_MAX_TOKENS;
}

/** Optional callback for streaming progress to the UI (via Supabase job_events). */
export type ProgressEmitter = (event: { type: string; message: string; payload?: Record<string, unknown> }) => Promise<void> | void;

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
  appType: 'static' | 'react' | 'nextjs' | 'vue' | 'python' | 'flutter' | 'react-native';
  description: string;
  files: Array<{ path: string; purpose: string }>;
  designNotes: string;
  /** Optional: model's actual maxCompletionTokens (looked up from /api/models). */
  maxCompletionTokens?: number;
}

/**
 * Classify the prompt and build a file plan.
 */
export function planProject(prompt: string): ProjectSpec {
  const lower = prompt.toLowerCase();

  const isPython = /python|flask|fastapi|django|pip\b/i.test(lower);
  const isNextjs = /next\.?js|nextjs|next app|app router|pages router/i.test(lower);
  const isVue = /\bvue\b|vuex|pinia|nuxt/i.test(lower);
  const isFlutter = /\bflutter\b|\bdart\b|flutter.*app|material.*widget|stateful.*widget/i.test(lower);
  const isReactNative = /react.?native|expo\b|expo.*app|\bnative.*app\b|mobile.*react|react.*mobile/i.test(lower);
  const isReact =
    /\breact\b|vite.*react|react.*vite|tsx|jsx|shadcn|radix|hooks?|useState|useEffect/i.test(lower);
  const isExplicitlyStatic =
    /\bhtml\b|\bvanilla\b|\bstatic\b|landing page|no framework|no react|without react|pure js|plain js/i.test(lower);

  let appType: ProjectSpec['appType'];

  if (isFlutter) {
    appType = 'flutter';
  } else if (isReactNative) {
    appType = 'react-native';
  } else if (isPython && !isReact && !isVue) {
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
    flutter: [
      { path: 'pubspec.yaml', purpose: 'Flutter dependencies and metadata' },
      { path: 'lib/main.dart', purpose: 'App entry point, MaterialApp setup' },
      { path: 'lib/app.dart', purpose: 'Root app widget with theme and routing' },
      { path: 'lib/screens/home_screen.dart', purpose: 'Main home screen widget' },
      { path: 'lib/widgets/app_widgets.dart', purpose: 'Reusable UI widgets' },
      { path: 'lib/models/models.dart', purpose: 'Data models and state' },
    ],
    'react-native': [
      { path: 'package.json', purpose: 'Expo + React Native dependencies' },
      { path: 'app.json', purpose: 'Expo app configuration' },
      { path: 'App.tsx', purpose: 'Root app component with navigation' },
      { path: 'src/screens/HomeScreen.tsx', purpose: 'Main home screen' },
      { path: 'src/components/ui.tsx', purpose: 'Reusable UI components' },
      { path: 'src/types.ts', purpose: 'TypeScript type definitions' },
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

  if (spec.appType === 'flutter') {
    return `You are Palmkit's build worker. Generate a COMPLETE Flutter mobile app in Dart.

OUTPUT FORMAT:
{ "files": [
    { "op": "write_file", "path": "pubspec.yaml",                    "content": "...", "mime_type": "text/yaml" },
    { "op": "write_file", "path": "lib/main.dart",                   "content": "...", "mime_type": "text/x-dart" },
    { "op": "write_file", "path": "lib/app.dart",                    "content": "...", "mime_type": "text/x-dart" },
    { "op": "write_file", "path": "lib/screens/home_screen.dart",    "content": "...", "mime_type": "text/x-dart" },
    { "op": "write_file", "path": "lib/widgets/app_widgets.dart",    "content": "...", "mime_type": "text/x-dart" },
    { "op": "write_file", "path": "lib/models/models.dart",          "content": "...", "mime_type": "text/x-dart" }
  ], "complete": true }

${JSON_RULES}
- pubspec.yaml: flutter sdk >=3.0.0 <4.0.0, use material3, include common packages (provider or riverpod for state).
- lib/main.dart: void main() => runApp(MyApp()); ONLY. All logic in other files.
- Use Material 3 widgets, proper theming, StatefulWidget / StatelessWidget correctly.
- Complete Dart syntax — no omissions, no '// ...rest of code'.
- Run with: flutter pub get && flutter run

PROJECT: ${spec.description}
DESIGN: Beautiful Material 3 UI, smooth animations, proper navigation.`;
  }

  if (spec.appType === 'react-native') {
    return `You are Palmkit's build worker. Generate a COMPLETE React Native + Expo app with TypeScript.

OUTPUT FORMAT:
{ "files": [
    { "op": "write_file", "path": "package.json",              "content": "...", "mime_type": "application/json" },
    { "op": "write_file", "path": "app.json",                  "content": "...", "mime_type": "application/json" },
    { "op": "write_file", "path": "App.tsx",                   "content": "...", "mime_type": "text/typescript" },
    { "op": "write_file", "path": "src/screens/HomeScreen.tsx","content": "...", "mime_type": "text/typescript" },
    { "op": "write_file", "path": "src/components/ui.tsx",     "content": "...", "mime_type": "text/typescript" },
    { "op": "write_file", "path": "src/types.ts",              "content": "...", "mime_type": "text/typescript" }
  ], "complete": true }

${JSON_RULES}
- package.json: expo ~51.0, react-native 0.74, react 18, typescript, @react-navigation/native, @react-navigation/stack.
- app.json: valid Expo config with name, slug, version, platforms: ["ios", "android"].
- Use StyleSheet.create() for all styles — NO Tailwind (not supported in RN).
- Complete TypeScript — proper types, no 'any', no omissions.
- Run with: npx expo start

PROJECT: ${spec.description}
DESIGN: Native-feeling UI with proper touch targets (44px+), platform-aware styling.`;
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
  onProgress?: ProgressEmitter,
): Promise<GenerationResult> {
  logger.info(`Generating ${spec.appType} with provider=${providerName}, model=${modelName}`);

  const systemPrompt = buildSystemPrompt(spec);
  const model = getModelInstance(providerName, modelName, apiKey);
  const maxTokens = resolveMaxTokens(spec, spec.maxCompletionTokens);

  logger.info(`Token budget for ${modelName}: maxTokens=${maxTokens} (model reported: ${spec.maxCompletionTokens ?? 'n/a'})`);

  // ── STREAMING GENERATION ────────────────────────────────────────────────
  // Use streamText so the user sees real-time progress (file_chunk events)
  // instead of staring at a static "Generating files..." for 2-5 minutes.
  let rawText = '';
  let finishReason: string | undefined;
  let usage: any = undefined;
  let lastProgressEmit = 0;

  await onProgress?.({ type: 'file_stream_started', message: `Streaming response from ${modelName}...` });

  const result = await streamText({
    model,
    system: systemPrompt,
    prompt,
    maxTokens,
    temperature: 0.7,
  });

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      rawText += part.textDelta;

      // Emit progress every ~500ms so we don't spam Supabase.
      const now = Date.now();

      if (now - lastProgressEmit > 500) {
        lastProgressEmit = now;
        await onProgress?.({
          type: 'file_chunk',
          message: `Generating… ${rawText.length.toLocaleString()} chars received`,
          payload: { charsReceived: rawText.length },
        });
      }
    } else if (part.type === 'error') {
      const errMsg = (part.error as Error)?.message ?? JSON.stringify(part.error) ?? 'unknown';
      logger.error(`Stream error part: ${errMsg}`);
      throw new Error(`Stream error: ${errMsg}`);
    } else if (part.type === 'finish') {
      finishReason = part.finishReason;
      usage = part.usage;
    }
  }

  if (!rawText) {
    throw new Error(`${providerName} returned empty content (finishReason: ${finishReason})`);
  }

  logger.info(`Received ${rawText.length} chars from ${providerName} (finishReason: ${finishReason}, usage: ${JSON.stringify(usage)})`);

  // ── AUTO-CONTINUE IF TRUNCATED ───────────────────────────────────────────
  // If the model hit the token limit (finishReason === 'length'), the JSON is
  // almost certainly truncated mid-file. Send a follow-up prompt asking for
  // ONLY the remaining files, then merge.
  let attempts = 0;
  const MAX_CONTINUATIONS = 3;

  while (finishReason === 'length' && attempts < MAX_CONTINUATIONS) {
    attempts++;
    logger.warn(`Response truncated (finishReason=length). Auto-continuing attempt ${attempts}/${MAX_CONTINUATIONS}`);

    await onProgress?.({
      type: 'file_chunk',
      message: `Response was truncated — requesting remaining files (attempt ${attempts}/${MAX_CONTINUATIONS})...`,
      payload: { attempt: attempts, charsSoFar: rawText.length },
    });

    // Parse what we have so far to know which files are complete.
    const partialFiles = extractPartialFiles(rawText);
    const havePaths = new Set(partialFiles.map((f) => f.path));
    const needPaths = spec.files.map((f) => f.path).filter((p) => !havePaths.has(p));

    if (needPaths.length === 0) {
      // All planned files are present — just the JSON wrapper got cut.
      logger.info('All planned files already recovered; no continuation needed');
      break;
    }

    const continuePrompt = `You were generating a JSON project but hit your output token limit. Continue from where you left off.

You already completed these files: ${[...havePaths].join(', ') || '(none)'}

STILL NEEDED: ${needPaths.join(', ')}

Return ONLY a JSON object with the REMAINING files (do NOT repeat files already generated):
{"files":[{"op":"write_file","path":"...","content":"..."},...], "complete": true}

Start directly with { — no markdown fences, no preamble.`;

    let continueText = '';
    const continueResult = await streamText({
      model,
      system: 'You are a JSON-only code generator. Continue the previous response with the remaining files only.',
      prompt: continuePrompt,
      maxTokens,
      temperature: 0.5,
    });

    let contFinishReason: string | undefined;

    for await (const part of continueResult.fullStream) {
      if (part.type === 'text-delta') {
        continueText += part.textDelta;

        const now = Date.now();

        if (now - lastProgressEmit > 500) {
          lastProgressEmit = now;
          await onProgress?.({
            type: 'file_chunk',
            message: `Continuing… ${continueText.length.toLocaleString()} chars in attempt ${attempts}`,
            payload: { attempt: attempts, charsInAttempt: continueText.length },
          });
        }
      } else if (part.type === 'finish') {
        contFinishReason = part.finishReason;
      } else if (part.type === 'error') {
        logger.error(`Continuation stream error: ${JSON.stringify(part.error)}`);
        break;
      }
    }

    logger.info(`Continuation ${attempts}: ${continueText.length} chars (finishReason: ${contFinishReason})`);

    // Merge: append continuation text to rawText so the parser can find new files.
    rawText += '\n' + continueText;
    finishReason = contFinishReason;

    // If we got the remaining files, we're done.
    const allFilesNow = extractPartialFiles(rawText);
    const allHavePaths = new Set(allFilesNow.map((f) => f.path));
    const stillMissing = spec.files.map((f) => f.path).filter((p) => !allHavePaths.has(p));

    if (stillMissing.length === 0) {
      logger.info(`All ${spec.files.length} planned files recovered after ${attempts} continuation(s)`);
      break;
    }
  }

  // ── PARSE THE (POSSIBLY MERGED) RESPONSE ─────────────────────────────────
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

      logger.warn(`JSON truncated — recovered ${recovered.length} file(s) from partial response after ${attempts} continuation(s)`);
      parsed = { files: recovered, complete: false };
    }
  }

  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const complete = Boolean(parsed.complete);

  if (files.length === 0) {
    throw new Error('LLM returned no files in the JSON response');
  }

  // Deduplicate by path (continuation may have produced overlapping files; keep the longer content).
  const deduped = new Map<string, FileOperation>();

  for (const f of files) {
    if (!f.path || typeof f.content !== 'string') {
      continue;
    }

    if (f.content.trim().length === 0) {
      continue;
    }

    if (!f.mime_type) {
      f.mime_type = inferMimeType(f.path);
    }

    const existing = deduped.get(f.path);

    if (!existing || f.content.length > existing.content.length) {
      deduped.set(f.path, f);
    }
  }

  const finalFiles = [...deduped.values()];

  if (finalFiles.length === 0) {
    throw new Error('All files had empty content or missing paths');
  }

  logger.info(`Generation complete: ${finalFiles.length} files, appType=${spec.appType}, complete=${complete}`);

  await onProgress?.({
    type: 'file_generation_completed',
    message: `Generated ${finalFiles.length} files (${rawText.length.toLocaleString()} chars total)`,
    payload: { fileCount: finalFiles.length, totalChars: rawText.length, continuations: attempts },
  });

  return { files: finalFiles, complete: complete || finalFiles.length >= spec.files.length, rawText, appType: spec.appType };
}

/**
 * Phase 7 — Edit Mode Generator
 *
 * Given the existing files and an edit prompt, asks the LLM to return
 * ONLY the files that need to change. Merges them with the originals.
 */
export async function generateEdit(
  existingFiles: FileOperation[],
  appType: string,
  editPrompt: string,
  providerName: string,
  modelName: string,
  apiKey: string,
): Promise<FileOperation[]> {
  const fileDump = existingFiles
    .map((f) => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n')
    .slice(0, 12000);

  const systemPrompt = `You are Palmkit's code editor. You are modifying an existing ${appType} project.

Current project files:
${fileDump}

The user wants to make changes. Return ONLY the files that need to change.

OUTPUT FORMAT:
{"files":[{"op":"write_file","path":"...","content":"..."},...], "complete": true}

STRICT RULES:
- Return raw JSON ONLY. No markdown, no backticks, no explanation.
- Include ONLY files that actually change. Unchanged files MUST NOT be included.
- Write COMPLETE file content for each changed file — no truncation, no "...rest stays same".
- "complete": true when all changes are included.
- Production quality — no placeholders, no TODOs.`;

  const model = getModelInstance(providerName, modelName, apiKey);
  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: editPrompt,
    maxTokens: 64000,
    temperature: 0.5,
  });

  const rawText = result.text ?? '';

  if (!rawText) {
    throw new Error(`${providerName} returned empty content for edit`);
  }

  logger.info(`[generateEdit] received ${rawText.length} chars`);

  let parsed: { files?: FileOperation[] };

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? rawText);
  } catch {
    const recovered = extractPartialFiles(rawText);
    parsed = { files: recovered };
  }

  const patchedFiles = Array.isArray(parsed.files) ? parsed.files : [];

  if (patchedFiles.length === 0) {
    logger.warn('[generateEdit] LLM returned no changed files — returning original files unchanged');
    return existingFiles;
  }

  for (const f of patchedFiles) {
    if (!f.mime_type) f.mime_type = inferMimeType(f.path);
  }

  const patchMap = new Map(
    patchedFiles
      .filter((f) => f.path && typeof f.content === 'string' && f.content.trim().length > 0)
      .map((f) => [f.path, f]),
  );

  logger.info(`[generateEdit] patching ${patchMap.size} file(s): ${[...patchMap.keys()].join(', ')}`);

  const merged = new Map(existingFiles.map((f) => [f.path, f]));

  for (const [path, file] of patchMap) {
    merged.set(path, file);
  }

  return [...merged.values()];
}

/**
 * Phase 4 — Repair Agent
 *
 * Given build errors and the affected files, asks the LLM for targeted fixes.
 * Returns the patched FileOperation array (unaffected files are passed through).
 */
export async function repairGeneration(
  files: FileOperation[],
  appType: string,
  buildErrors: string,
  providerName: string,
  modelName: string,
  apiKey: string,
): Promise<FileOperation[]> {
  const errorSnippet = buildErrors.slice(0, 3000);

  const affectedPaths = files
    .map((f) => f.path)
    .filter((p) => buildErrors.includes(p));

  /* Include the files that appear in error messages plus package.json */
  const toFix = files.filter((f) => affectedPaths.includes(f.path) || f.path === 'package.json' || f.path.startsWith('src/') || f.path.startsWith('app/'));

  const fileDump = toFix.map((f) => `=== ${f.path} ===\n${f.content}`).join('\n\n').slice(0, 8000);

  const systemPrompt = `You are a code repair assistant. Fix the ${appType} build errors below.
Return ONLY a JSON object: {"files":[{"op":"write_file","path":"...","content":"..."},...]}
Include ONLY the files you are changing. Keep all other files identical. No markdown fences.`;

  const repairPrompt = `BUILD ERRORS:\n${errorSnippet}\n\nCURRENT FILES:\n${fileDump}`;

  const model = getModelInstance(providerName, modelName, apiKey);
  const result = await generateText({ model, system: systemPrompt, prompt: repairPrompt, maxTokens: 64000, temperature: 0.3 });

  const rawText = result.text ?? '';

  let parsed: { files?: FileOperation[] };

  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? rawText);
  } catch {
    const recovered = extractPartialFiles(rawText);
    parsed = { files: recovered };
  }

  const patchedFiles = Array.isArray(parsed.files) ? parsed.files : [];

  if (patchedFiles.length === 0) {
    logger.warn('[repair] LLM returned no files — skipping patch');
    return files;
  }

  const patchMap = new Map(patchedFiles.filter((f) => f.path && f.content).map((f) => {
    if (!f.mime_type) f.mime_type = inferMimeType(f.path);
    return [f.path, f];
  }));

  logger.info(`[repair] patching ${patchMap.size} file(s): ${[...patchMap.keys()].join(', ')}`);

  return files.map((f) => patchMap.get(f.path) ?? f);
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
  } else if (result.appType === 'flutter') {
    if (!paths.includes('pubspec.yaml')) issues.push('Missing pubspec.yaml');
    if (!paths.includes('lib/main.dart')) issues.push('Missing lib/main.dart');
  } else if (result.appType === 'react-native') {
    if (!paths.includes('package.json')) issues.push('Missing package.json');
    if (!paths.some((p) => p === 'App.tsx' || p === 'App.js' || p === 'App.jsx')) {
      issues.push('Missing App entry component');
    }
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
