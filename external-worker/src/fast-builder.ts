/**
 * Fast Builder — Single-Call Generation Engine
 *
 * Replaces the N-call orchestrator for simple/medium apps.
 * One LLM call returns ALL project files as JSON.
 *
 * Proven in experiments:
 *   - Counter app:  13.5s, 5 files, high quality
 *   - vs orchestrator: 4-16 min, 15-25 LLM calls
 *
 * This is NOT a return to the old generateStaticFiles. Key differences:
 *   1. Blueprint-guided prompts (structure + design tokens, not code)
 *   2. Production design system rules in the prompt
 *   3. Robust JSON extraction (handles markdown fences, truncated output)
 *   4. Output validation (entry point, no default blue, minimum files)
 *   5. Uses the same Vercel AI SDK streamText as the orchestrator
 */

import { streamText, type LanguageModelV1 } from 'ai';
import { getBlueprint, type Blueprint } from './blueprint-templates';
import { classifyPrompt, type AppType } from './prompt-classifier';
import { detectAppTypeFromFiles, type FileOperation } from './generator';
import { logger } from './logger';
import { emitEvent } from './event-emitter';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ──

export interface FastBuildResult {
  success: boolean;
  files: FileOperation[];
  durationMs: number;
  classification: ReturnType<typeof classifyPrompt>;
  blueprintUsed?: string;
  error?: string;
}

// ── System Prompt Builder ──

function buildSystemPrompt(blueprint: Blueprint | undefined): string {
  const designSection = blueprint
    ? `
## DESIGN TOKENS (use EXACTLY these)
- Primary text color: ${blueprint.designTokens.primary}
- Accent color: ${blueprint.designTokens.accent} — use for primary buttons, active states, highlights
- Background: ${blueprint.designTokens.background}
- Card/surface: ${blueprint.designTokens.surface}
- Body text: ${blueprint.designTokens.text}
- Muted text: ${blueprint.designTokens.textMuted}
- Borders: ${blueprint.designTokens.border}

## FILE STRUCTURE (generate EXACTLY these files)
${blueprint.fileStructure.map(f => `  - ${f.path}: ${f.purpose}`).join('\n')}

## ARCHITECTURE GUIDANCE
${blueprint.componentGuidance}`
    : '';

  return `You are an expert frontend engineer who generates complete, runnable web applications.

${designSection}

## DESIGN SYSTEM RULES (MANDATORY for ALL apps)
- Color: NEVER use default blue (#3B82F6) or indigo as primary/accent. Use the specified accent or a distinctive color (emerald, amber, rose, cyan, violet, orange, teal).
- Typography: Clear hierarchy. Headings text-2xl to text-4xl font-bold. Body text-base. Captions text-sm text-muted. Max 2 font weights.
- Spacing: p-4/p-6 for cards. gap-4/gap-6 between sections. py-16/py-24 for page sections.
- Cards: rounded-xl, shadow-sm or border. hover:shadow-md transition-shadow.
- Buttons: rounded-lg, px-6 py-2.5, font-medium. Primary: bg-accent text-white. Secondary: border outline.
- Background: Use the specified background color. Sections can alternate with slightly different shade.
- Mobile-first: Stack on mobile, side-by-side on md:+. Min 44px touch targets.

## CODE QUALITY RULES
- Functional components with hooks (useState, useEffect, useCallback)
- Extract reusable components — one component per file
- Semantic HTML: main, header, section, nav, footer, article
- Proper key props on ALL mapped lists
- Handle empty states and loading states gracefully
- Hover, focus, and active states on ALL interactive elements
- ARIA labels where needed for accessibility
- CSS transitions (transition-all duration-200) for hover effects
- NO placeholder text — use realistic, meaningful content
- NO "Lorem ipsum" — use content relevant to the app's purpose

## OUTPUT FORMAT
Return your response as a JSON object with this EXACT structure:
{
  "files": [
    { "path": "src/App.jsx", "content": "complete file content here" },
    { "path": "src/components/Header.jsx", "content": "..." }
  ]
}

CRITICAL:
- Generate ALL files listed in the file structure (if a blueprint is provided) or all files the app needs
- Each file must be COMPLETE and RUNNABLE — no "// ... rest of code" or "TODO"
- Use relative imports (./Component, ../components/Component)
- Return ONLY valid JSON — no markdown, no explanation, no code fences, no text before or after the JSON`;
}

// ── User Prompt Builder ──

function buildUserPrompt(userPrompt: string, blueprint: Blueprint | undefined): string {
  if (blueprint) {
    return `Build this application: ${userPrompt}

Generate ALL files listed in the file structure above. Each file must be COMPLETE and RUNNABLE.
Follow the architecture guidance and design tokens exactly.`;
  }
  return userPrompt;
}

// ── JSON Extraction ──

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Direct parse
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  // Extract from code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }
  // Find outermost { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1)); } catch { /* continue */ }
  }
  return null;
}

// ── Output Validation ──

interface ValidationResult {
  valid: boolean;
  issues: string[];
}

function validateOutput(raw: any, files: FileOperation[]): ValidationResult {
  const issues: string[] = [];

  if (!Array.isArray(raw?.files)) {
    return { valid: false, issues: ['No files array in response'] };
  }

  if (files.length < 2) {
    issues.push('Too few files — app needs at least App component + entry point');
  }

  const hasApp = files.some(f => f.path.includes('App.') || f.path.includes('app.'));
  if (!hasApp) {
    issues.push('Missing App component');
  }

  // Check for default blue usage
  const allContent = files.map(f => f.content).join('\n');
  if (allContent.includes('bg-blue-500') || allContent.includes('bg-blue-600')) {
    issues.push('Uses default blue — design system violation (non-blocking)');
  }

  // Check for incomplete files (placeholder patterns)
  const placeholderPatterns = ['// ...', '// rest', 'TODO:', '/* ... */', '// remaining'];
  for (const f of files) {
    for (const pattern of placeholderPatterns) {
      if (f.content.includes(pattern) && f.content.length < 500) {
        issues.push(`${f.path} may contain placeholder content`);
        break;
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// ── Main Fast Build Function ──

export async function runFastBuild(
  prompt: string,
  model: LanguageModelV1,
  jobId: string,
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  opts?: {
    maxCompletionTokens?: number;
    reasoningEffort?: 'off' | 'medium' | 'max';
  },
): Promise<FastBuildResult> {
  const startTime = Date.now();
  const classification = classifyPrompt(prompt);
  const blueprint = getBlueprint(classification.appType);

  logger.info(`[fast-builder] Starting fast build for job=${jobId} type=${classification.appType} complexity=${classification.complexity} blueprint=${blueprint?.id || 'none'}`);

  try {
    await emitEvent(supabase, jobId, 'file_chunk' as any,
      `⚡ Fast build: ${classification.appType} (${classification.complexity})${blueprint ? ` using ${blueprint.id} blueprint` : ''}`,
      { agent: 'System', kind: 'fast_build_start', classification, blueprintId: blueprint?.id }
    );

    // ── 1. Build prompts ──
    const systemPrompt = buildSystemPrompt(blueprint);
    const userPrompt = buildUserPrompt(prompt, blueprint);

    // ── 2. Single LLM call ──
    const llmStart = Date.now();
    let fullText = '';

    const result = streamText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      maxSteps: 1, // SINGLE step — no tool use
      temperature: 0.3,
      maxTokens: opts?.maxCompletionTokens || 32_000,
      ...(opts?.reasoningEffort && opts.reasoningEffort !== 'off' ? {
        providerOptions: { reasoningEffort: opts.reasoningEffort },
      } : {}),
      onStepFinish({ text }) {
        fullText += text;
      },
    });

    // Consume the stream
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        fullText += part.textDelta;
        // Stream progress to user
        if (fullText.length % 500 < 50) {
          await emitEvent(supabase, jobId, 'file_chunk' as any,
            `📝 Generating... (${(Date.now() - llmStart) / 1000}s)`,
            { agent: 'System', kind: 'fast_build_progress', elapsedMs: Date.now() - llmStart }
          ).catch(() => {});
        }
      }
    }

    const llmDuration = Date.now() - llmStart;
    logger.info(`[fast-builder] LLM call completed in ${llmDuration}ms, response length: ${fullText.length} chars`);

    // ── 3. Parse JSON ──
    const parsed = extractJson(fullText);
    if (!parsed || typeof parsed !== 'object') {
      return {
        success: false,
        files: [],
        durationMs: Date.now() - startTime,
        classification,
        error: `Failed to parse LLM output as JSON. Response length: ${fullText.length}`,
      };
    }

    const rawFiles: Array<{ path: string; content: string }> = (parsed as any).files || [];
    const files: FileOperation[] = rawFiles
      .filter((f) => f.path && typeof f.path === 'string' && f.content && typeof f.content === 'string')
      .map((f) => ({ path: f.path, content: f.content }));

    if (files.length === 0) {
      return {
        success: false,
        files: [],
        durationMs: Date.now() - startTime,
        classification,
        error: 'LLM returned an empty files array',
      };
    }

    logger.info(`[fast-builder] Parsed ${files.length} files, total size: ${files.reduce((s, f) => s + f.content.length, 0)} chars`);

    // ── 4. Validate ──
    const validation = validateOutput(parsed, files);
    if (validation.issues.length > 0) {
      logger.warn(`[fast-builder] Validation issues: ${validation.issues.join('; ')}`);
    }

    await emitEvent(supabase, jobId, 'file_chunk' as any,
      `✅ Fast build complete: ${files.length} files in ${(Date.now() - startTime) / 1000}s`,
      {
        agent: 'System',
        kind: 'fast_build_complete',
        fileCount: files.length,
        durationMs: Date.now() - startTime,
        llmDurationMs: llmDuration,
        validation,
      }
    );

    return {
      success: validation.valid,
      files,
      durationMs: Date.now() - startTime,
      classification,
      blueprintUsed: blueprint?.id,
      ...(validation.issues.length > 0 ? { error: validation.issues.join('; ') } : {}),
    };

  } catch (error: any) {
    logger.error(`[fast-builder] Error: ${error.message}`, error);
    return {
      success: false,
      files: [],
      durationMs: Date.now() - startTime,
      classification,
      error: error.message,
    };
  }
}