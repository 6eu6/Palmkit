/**
 * Intent Classifier — decides stream mode BEFORE any LLM call.
 *
 * Two-stage:
 *   Stage 1 (heuristic, 0ms): regex + keyword matching.
 *            Returns immediately with high confidence for clear cases.
 *   Stage 2 (LLM, ~500ms):    small fast model with structured output.
 *            Only called when heuristic is uncertain.
 *
 * Output determines which code path api.chat.ts takes:
 *   - 'discuss' → streamText with discussPrompt, no validator, no retry
 *   - 'build'   → orchestrator (if complex) or streamText + validator + retries
 *   - 'hybrid'  → discuss first, then ask user to confirm build
 *
 * The classifier MUST be conservative — when unsure, default to 'discuss'.
 * Reason: a wrong 'build' triggers 10 annoying retries; a wrong 'discuss'
 * just produces text the user can re-prompt on.
 */

import { createScopedLogger } from '~/utils/logger';
import type { StreamMode } from '~/lib/stream/types';

const logger = createScopedLogger('intent-classifier');

export interface IntentResult {
  mode: StreamMode;
  confidence: number; // 0-1
  reason: string;
  stage: 'heuristic' | 'llm' | 'fallback';
  durationMs: number;
}

export interface ClassifyOptions {
  /** Skip Stage 2 (LLM) — heuristic only. Default: false. */
  heuristicOnly?: boolean;

  /** Override default mode when both stages fail. Default: 'discuss'. */
  fallbackMode?: StreamMode;
}

/* ────────────────────────────────────────────────────────────── */
/*  Keyword dictionaries — keep these SHORT and HIGH-PRECISION    */
/*  Adding too many keywords causes false positives.              */
/* ────────────────────────────────────────────────────────────── */

const BUILD_VERBS_EN = [
  'build',
  'create',
  'make',
  'design',
  'generate',
  'scaffold',
  'implement',
  'develop',
  'code',
  'produce',
  'construct',
  'assemble',
  'write me',
  'generate me',
] as const;

const BUILD_VERBS_AR = [
  'صمم',
  'صمّم',
  'أنشئ',
  'انشئ',
  'ابن',
  'ابنِ',
  'طور',
  'برمج',
  'اكتب لي',
  'اصنع',
  'اعمل لي',
  'جهّز',
  'نتج',
  'ولّد',
] as const;

const ANALYZE_VERBS_EN = [
  'analyze',
  'analyse',
  'explain',
  'review',
  'inspect',
  'examine',
  'compare',
  'evaluate',
  'assess',
  'audit',
  'investigate',
  'look at',
  'check',
  'tell me about',
  'what is',
  'why does',
  'how does',
  'how do',
  'why is',
  'what are',
] as const;

const ANALYZE_VERBS_AR = [
  'حلل',
  'حلّل',
  'اشرح',
  'فحص',
  'افحص',
  'راجع',
  'قارن',
  'قيّم',
  'ادرس',
  'ماذا',
  'لماذا',
  'كيف',
  'متى',
  'أين',
  'أخبرني عن',
  'وصف',
  'اشرح لي',
  'فكّر معي',
  'فكر معي',
] as const;

const APP_NOUNS_EN = [
  'app',
  'application',
  'website',
  'webpage',
  'page',
  'component',
  'feature',
  'dashboard',
  'clone',
  'site',
  'tool',
  'calculator',
  'counter',
  'timer',
  'todo',
  'form',
] as const;

const APP_NOUNS_AR = [
  'تطبيق',
  'موقع',
  'صفحة',
  'مكوّن',
  'مكون',
  'لوحة',
  'أداة',
  'الة حاسبة',
  'آلة حاسبة',
  'عدّاد',
  'مؤقت',
  'قائمة',
] as const;

/* ────────────────────────────────────────────────────────────── */
/*  Stage 1: Heuristic                                            */
/* ────────────────────────────────────────────────────────────── */

/**
 * Quick regex/keyword check. Returns null if uncertain → caller runs Stage 2.
 *
 * Heuristics (ordered by priority):
 *   1. URL-only message with question → discuss (e.g., "https://github.com/x/y")
 *   2. Short question (≤8 words) starting with wh-word → discuss
 *   3. Strong build verb + app noun → build
 *   4. Strong analyze verb without build verb → discuss
 *   5. Explicit "analyze ... link/repo/github" → discuss
 *   6. Otherwise → null (uncertain, defer to LLM)
 */
export function heuristicClassify(text: string): IntentResult | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const startTime = Date.now();

  // Empty or near-empty → treat as discuss (will produce empty response)
  if (wordCount === 0 || trimmed.length < 3) {
    return {
      mode: 'discuss',
      confidence: 0.7,
      reason: 'empty or near-empty input',
      stage: 'heuristic',
      durationMs: Date.now() - startTime,
    };
  }

  // Check if message contains a URL (especially github/gitlab)
  const hasUrl = /https?:\/\/\S+/i.test(trimmed);
  const hasGitUrl = /https?:\/\/(github|gitlab|bitbucket)\.com\/\S+/i.test(trimmed);

  // Detect Arabic content (basic check)
  const hasArabic = /[\u0600-\u06FF]/.test(trimmed);

  // Build detection
  const hasBuildVerbEn = BUILD_VERBS_EN.some((kw) => lower.includes(kw));
  const hasBuildVerbAr = BUILD_VERBS_AR.some((kw) => trimmed.includes(kw));
  const hasBuildVerb = hasBuildVerbEn || hasBuildVerbAr;

  // Analyze detection
  const hasAnalyzeVerbEn = ANALYZE_VERBS_EN.some((kw) => lower.includes(kw));
  const hasAnalyzeVerbAr = ANALYZE_VERBS_AR.some((kw) => trimmed.includes(kw));
  const hasAnalyzeVerb = hasAnalyzeVerbEn || hasAnalyzeVerbAr;

  // App noun detection
  const hasAppNounEn = APP_NOUNS_EN.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(lower));
  const hasAppNounAr = APP_NOUNS_AR.some((kw) => trimmed.includes(kw));
  const hasAppNoun = hasAppNounEn || hasAppNounAr;

  // Rule 1: URL-only or URL-with-question → discuss (analyze the URL)
  if (hasGitUrl && wordCount <= 12) {
    /*
     * e.g., "https://github.com/6eu6/Palmkit ممكن تفحص لي ذا المستودع"
     * The user pasted a URL with a short request → analyze
     */
    return {
      mode: 'discuss',
      confidence: 0.92,
      reason: 'URL with short request — analysis intent',
      stage: 'heuristic',
      durationMs: Date.now() - startTime,
    };
  }

  if (hasUrl && !hasBuildVerb && wordCount <= 15) {
    return {
      mode: 'discuss',
      confidence: 0.85,
      reason: 'URL with short message, no build verb — analysis intent',
      stage: 'heuristic',
      durationMs: Date.now() - startTime,
    };
  }

  // Rule 2: Short question starting with wh-word
  const whPatternEn = /^(what|why|how|when|where|who|which|whose|whom)\b/i;
  const whPatternAr = /^(ماذا|لماذا|كيف|متى|أين|من|أي|ما)\s/;

  if (wordCount <= 10 && (whPatternEn.test(lower) || whPatternAr.test(trimmed))) {
    return {
      mode: 'discuss',
      confidence: 0.93,
      reason: 'short wh-question',
      stage: 'heuristic',
      durationMs: Date.now() - startTime,
    };
  }

  // Rule 3: Strong build verb + app noun
  if (hasBuildVerb && hasAppNoun) {
    // Verify it's not negated ("don't build", "لا تصمم")
    const hasNegationEn = /\b(don'?t|do not|never|stop building)\b/i.test(lower);
    const hasNegationAr = /(لا تصم|لا تصمّم|لا تبني|لا تبن|ما تصير|ما تقدر)/.test(trimmed);

    if (!hasNegationEn && !hasNegationAr) {
      return {
        mode: 'build',
        confidence: 0.91,
        reason: hasArabic ? 'explicit Arabic build request' : 'explicit build request',
        stage: 'heuristic',
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Rule 4: Analyze verb without build verb
  if (hasAnalyzeVerb && !hasBuildVerb) {
    // Check it's not "analyze and build"
    const hasConjunctionBuild = /\b(and|then|ثم|وبعد|وصلح|وابن)\b/i.test(lower) && hasBuildVerb;

    if (!hasConjunctionBuild) {
      return {
        mode: 'discuss',
        confidence: 0.88,
        reason: hasArabic ? 'explicit Arabic analysis request' : 'explicit analysis request',
        stage: 'heuristic',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /*
   * Rule 4b: Analyze verb alone (even with build verb, if analyze comes first)
   * e.g., "Analyze this code for bugs" → discuss (analyze is the primary intent)
   */
  if (
    hasAnalyzeVerbEn &&
    /^\s*(analyze|analyse|explain|review|inspect|examine|compare|evaluate|assess|audit|investigate)\b/i.test(trimmed)
  ) {
    return {
      mode: 'discuss',
      confidence: 0.86,
      reason: 'sentence starts with analysis verb',
      stage: 'heuristic',
      durationMs: Date.now() - startTime,
    };
  }

  if (hasAnalyzeVerbAr && /^(حلل|حلّل|اشرح|فحص|افحص|راجع|قارن|قيّم|ادرس)\s/.test(trimmed)) {
    return {
      mode: 'discuss',
      confidence: 0.86,
      reason: 'الجملة تبدأ بفعل تحليل',
      stage: 'heuristic',
      durationMs: Date.now() - startTime,
    };
  }

  // Rule 5: URL + "analyze/explain" pattern
  if (hasUrl && hasAnalyzeVerb) {
    return {
      mode: 'discuss',
      confidence: 0.9,
      reason: 'URL with analysis verb',
      stage: 'heuristic',
      durationMs: Date.now() - startTime,
    };
  }

  // Uncertain → defer to LLM
  return null;
}

/* ────────────────────────────────────────────────────────────── */
/*  Stage 2: LLM classifier                                       */
/* ────────────────────────────────────────────────────────────── */

const LLM_CLASSIFY_PROMPT = `You are an intent classifier. Read the user message and decide:
- "discuss": user wants analysis, explanation, Q&A, or discussion. No code files needed.
- "build":   user wants to create/build/modify code (app, website, component, etc).
- "hybrid":  user wants discussion that may lead to a build (needs confirmation).

Reply with JSON only — no prose, no markdown fences:
{"mode":"discuss"|"build"|"hybrid","confidence":0.0-1.0,"reason":"one short sentence"}

Heuristics:
- If the message contains a URL and asks to look at / analyze / explain it → discuss
- If the message asks to "build/create/make/design" + an app/website/component → build
- If the message is a question (what/why/how) without build verbs → discuss
- If unsure, lean toward "discuss" (safer default)
- Arabic keywords count: صمم/أنشئ/ابنِ = build, حلل/اشرح/فحص = discuss`;

/**
 * LLM-based classifier — Stage 2.
 * Uses a small fast model via the configured providers.
 * Returns null on any failure (caller falls back to default mode).
 */
async function llmClassify(text: string, env: any, apiKeys: Record<string, string>): Promise<IntentResult | null> {
  const startTime = Date.now();

  try {
    // Try OpenRouter first (configured by default in PalmKit)
    const openrouterKey = apiKeys.OpenRouter || env?.OPENROUTER_API_KEY;

    if (!openrouterKey) {
      logger.warn('No OpenRouter key available for LLM classifier');
      return null;
    }

    // Use a fast cheap model
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://palmkit.app',
        'X-Title': 'PalmKit Intent Classifier',
      },
      body: JSON.stringify({
        model: 'z-ai/glm-4.5-flash', // fast + cheap
        messages: [
          { role: 'system', content: LLM_CLASSIFY_PROMPT },
          { role: 'user', content: text.slice(0, 2000) }, // cap input
        ],
        temperature: 0,
        max_tokens: 100,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(4000), // hard cap 4s
    });

    if (!response.ok) {
      logger.warn(`LLM classifier HTTP ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return null;
    }

    const parsed = JSON.parse(content);
    const mode = ['discuss', 'build', 'hybrid'].includes(parsed.mode) ? parsed.mode : 'discuss';
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));

    return {
      mode: mode as StreamMode,
      confidence,
      reason: String(parsed.reason || 'llm classification').slice(0, 120),
      stage: 'llm',
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    logger.warn(`LLM classifier failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  Public API                                                    */
/* ────────────────────────────────────────────────────────────── */

/**
 * Classify user intent. Returns the chosen mode + metadata.
 *
 * Default flow:
 *   1. Try heuristic — if confident, return immediately.
 *   2. Try LLM — if confident (≥0.7), return.
 *   3. Fall back to discuss mode with low confidence.
 */
export async function classifyIntent(
  text: string,
  env: any,
  apiKeys: Record<string, string>,
  options: ClassifyOptions = {},
): Promise<IntentResult> {
  const { heuristicOnly = false, fallbackMode = 'discuss' } = options;

  // Stage 1
  const heuristic = heuristicClassify(text);

  if (heuristic) {
    logger.debug(
      `[heuristic] mode=${heuristic.mode} confidence=${heuristic.confidence} reason="${heuristic.reason}" (${heuristic.durationMs}ms)`,
    );
    return heuristic;
  }

  // Stage 2 (optional)
  if (!heuristicOnly) {
    const llm = await llmClassify(text, env, apiKeys);

    if (llm && llm.confidence >= 0.7) {
      logger.debug(`[llm] mode=${llm.mode} confidence=${llm.confidence} reason="${llm.reason}" (${llm.durationMs}ms)`);
      return llm;
    }

    if (llm) {
      logger.debug(`[llm] low confidence (${llm.confidence}) — falling back`);
    }
  }

  // Fallback
  return {
    mode: fallbackMode,
    confidence: 0.5,
    reason: 'fallback — uncertain input',
    stage: 'fallback',
    durationMs: 0,
  };
}
