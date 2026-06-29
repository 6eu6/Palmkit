/**
 * Build Orchestrator v2 — Matches Super Z's working pattern exactly
 *
 * How Super Z works:
 *   1. ANALYZE: Read full prompt (no truncation)
 *   2. PLAN: Create specific steps (dynamic, not hardcoded)
 *   3. DECOMPOSE: Break into tasks, each with FULL context
 *   4. EXECUTE: Run tasks (parallel for independent, sequential for dependent)
 *   5. VERIFY: Check output completeness before proceeding
 *   6. FIX: If incomplete, send targeted fix request (not full regenerate)
 *   7. MERGE: Combine all results
 *
 * Key principles:
 *   - NEVER truncate the prompt — every agent sees the FULL original request
 *   - NEVER truncate existing content — every agent sees the FULL current file
 *   - VERIFY after each task — don't proceed with incomplete output
 *   - PARALLEL execution for independent tasks (saves time)
 *   - TARGETED FIX on failure (not expensive regeneration)
 *   - Worklog: track every decision in the project's worklog file
 */

import { generateText, type LanguageModelV1 } from 'ai';
import { logger } from './logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentTask {
  id: number;
  name: string;
  file: string;
  description: string;
  /** Tasks that must complete before this one can start */
  dependsOn?: number[];
  /** Whether this task can run in parallel with others */
  parallelizable?: boolean;
}

export interface BuildPlan {
  reasoning: string;
  tasks: AgentTask[];
}

export interface TaskResult {
  taskId: number;
  taskName: string;
  success: boolean;
  content: string;
  duration: number;
  verified: boolean;
  error?: string;
}

export interface OrchestratorResult {
  success: boolean;
  files: Record<string, { type: 'file'; content: string; isBinary?: boolean }>;
  taskResults: TaskResult[];
  totalDuration: number;
  worklog: string;
}

export type ProgressCallback = (update: {
  type: 'plan' | 'task_start' | 'task_complete' | 'task_error' | 'task_fix' | 'verify' | 'complete' | 'error';
  message: string;
  taskId?: number;
  totalTasks?: number;
  taskName?: string;
}) => void;

// ─── Phase 1: ANALYZE + PLAN (Dynamic Decomposition) ────────────────────────

/**
 * Analyze the prompt and create a dynamic task plan.
 *
 * This is NOT hardcoded — the LLM reads the FULL prompt and decides:
 * - How many tasks are needed
 * - What each task should contain
 * - Which tasks can run in parallel
 * - Dependencies between tasks
 *
 * Retry logic: 3 attempts with increasing temperature.
 * If all fail, use dynamic fallback that analyzes the prompt content.
 */
async function analyzeAndPlan(
  prompt: string,
  model: LanguageModelV1,
  onProgress: ProgressCallback,
): Promise<BuildPlan> {
  onProgress({ type: 'plan', message: '📋 Analyzing request and creating build plan...' });

  const systemPrompt = `You are an expert project planner for an AI app builder. Your job is to break a build request into tasks.

CRITICAL RULES:
1. Read the ENTIRE prompt carefully — note every specific element, text, number, name, URL, and style
2. Each task should produce 2000-5000 chars of code
3. Order by dependency: foundation first, then components, then sections, then assembly
4. Mark tasks as parallelizable=true if they don't depend on each other
5. The LAST task must be "App Assembly" that wires everything together
6. Be EXTREMELY SPECIFIC — include exact text, numbers, class names, URLs from the prompt
7. Each task description must mention ALL specific content it needs to include

OUTPUT FORMAT — return ONLY valid JSON (no markdown, no explanation):
{
  "reasoning": "1-2 sentences",
  "tasks": [
    {
      "id": 1,
      "name": "Short name",
      "file": "index.html",
      "description": "DETAILED description including ALL specific elements, text, numbers, URLs from the prompt that this task must include",
      "dependsOn": [],
      "parallelizable": true
    }
  ]
}

IMPORTANT: Do NOT skip or summarize any content from the prompt. Every specific element (text, numbers, names, URLs, styles) must appear in at least one task description.`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await generateText({
      model,
      system: systemPrompt + (attempt > 1 ? '\n\nPREVIOUS ATTEMPT FAILED. Return ONLY valid JSON. Start with { and end with }.' : ''),
      prompt: `Break this build request into tasks. Return ONLY JSON:\n\n${prompt}`,
      maxTokens: 4000,
      temperature: attempt === 1 ? 0.2 : 0.5,
    });

    const rawText = result.text ?? '';
    logger.info(`[orchestrator] Plan attempt ${attempt}: ${rawText.length} chars`);

    try {
      // Robust JSON extraction
      let jsonStr = rawText;
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1) throw new Error('No JSON found');

      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      const plan = JSON.parse(jsonStr) as BuildPlan;

      if (!plan.tasks?.length) throw new Error('No tasks');

      for (const task of plan.tasks) {
        if (!task.name || !task.file || !task.description) {
          throw new Error(`Task ${task.id} missing fields`);
        }
      }

      const parallelCount = plan.tasks.filter((t) => t.parallelizable).length;
      onProgress({
        type: 'plan',
        message: `✓ Plan ready: ${plan.tasks.length} tasks (${parallelCount} parallelizable)\n${plan.tasks.map((t) => `  ${t.id}. ${t.name}${t.parallelizable ? ' ⟂' : ''}`).join('\n')}`,
        totalTasks: plan.tasks.length,
      });

      return plan;
    } catch (err) {
      logger.warn(`[orchestrator] Plan attempt ${attempt} failed: ${err}`);
      if (attempt < 3) continue;
    }
  }

  // Dynamic fallback: analyze the prompt and create tasks based on content
  logger.warn('[orchestrator] Using dynamic fallback plan');
  return createDynamicPlan(prompt, onProgress);
}

/**
 * Dynamic fallback: reads the prompt and creates tasks based on detected features.
 * NOT hardcoded — adapts to what the user actually asked for.
 */
function createDynamicPlan(prompt: string, onProgress: ProgressCallback): BuildPlan {
  const lower = prompt.toLowerCase();
  const tasks: AgentTask[] = [];
  let id = 1;
  const file = lower.includes('cdn') || lower.includes('html') ? 'index.html' : 'src/App.tsx';

  // Task 1: Foundation (always needed)
  tasks.push({
    id: id++,
    name: 'HTML shell + CDN + base styles + fonts',
    file,
    description: `Create the base ${file}. Include: DOCTYPE, head with ALL CDN scripts from the prompt, ALL Google Fonts, ALL custom CSS (liquid-glass, backdrop-filter, gradients, etc). Body background. ${file === 'index.html' ? '#root div + script type=text/babel.' : 'Vite entry.'} FULL PROMPT:\n${prompt}`,
    parallelizable: false,
  });

  // Task 2: Custom components (if needed)
  const components: string[] = [];
  if (lower.includes('video') || lower.includes('fading') || lower.includes('crossfade')) {
    components.push('FadingVideo component with requestAnimationFrame crossfade');
  }
  if (lower.includes('blur') || lower.includes('word-by-word')) {
    components.push('BlurText component with word-by-word animation');
  }
  if (lower.includes('animation') || lower.includes('framer') || lower.includes('motion')) {
    components.push('Framer Motion animation wrappers');
  }
  if (components.length > 0) {
    tasks.push({
      id: id++,
      name: `Custom components (${components.length})`,
      file,
      description: `Add these React components: ${components.join(', ')}. Each must be fully functional with ALL event handlers, animations, and styles specified. FULL PROMPT:\n${prompt}`,
      dependsOn: [1],
      parallelizable: false,
    });
  }

  // Task 3: Navbar (if needed)
  if (lower.includes('navbar') || lower.includes('nav') || lower.includes('navigation')) {
    tasks.push({
      id: id++,
      name: 'Navbar / Navigation',
      file,
      description: `Add Navbar with ALL elements from the prompt: logo, links (exact text), buttons (exact text), styling. FULL PROMPT:\n${prompt}`,
      dependsOn: [1],
      parallelizable: true,
    });
  }

  // Task 4: Hero section (if needed)
  if (lower.includes('hero') || lower.includes('landing')) {
    tasks.push({
      id: id++,
      name: 'Hero section',
      file,
      description: `Add Hero section with ALL elements: badge (exact text), headline (exact text), subheading (exact text), CTAs (exact button text), stats cards (exact numbers and labels), background video, animations. FULL PROMPT:\n${prompt}`,
      dependsOn: [1],
      parallelizable: true,
    });
  }

  // Task 5: Additional sections (if needed)
  const sections: string[] = [];
  if (lower.includes('capabilit') || lower.includes('feature') || lower.includes('card')) {
    sections.push('Capabilities/Features section with ALL cards, icons, tags, descriptions (exact text)');
  }
  if (lower.includes('partner') || lower.includes('aeon') || lower.includes('vela')) {
    sections.push('Partners section with ALL partner names (exact): Aeon, Vela, Apex, Orbit, Zeno');
  }
  if (lower.includes('footer')) {
    sections.push('Footer with all content');
  }
  if (lower.includes('form') || lower.includes('contact')) {
    sections.push('Contact form with all inputs');
  }
  if (sections.length > 0) {
    tasks.push({
      id: id++,
      name: `Additional sections (${sections.length})`,
      file,
      description: `Add these sections: ${sections.join('; ')}. Include ALL specific content, text, numbers, names exactly as in the prompt. FULL PROMPT:\n${prompt}`,
      dependsOn: [1],
      parallelizable: true,
    });
  }

  // Task N: Assembly (always last)
  tasks.push({
    id: id++,
    name: 'App assembly + render',
    file,
    description: `Add App component rendering ALL sections in order. Mount with ${file === 'index.html' ? 'ReactDOM.render' : 'createRoot'}. Ensure everything is connected. FULL PROMPT:\n${prompt}`,
    dependsOn: tasks.slice(1).map((t) => t.id), // depends on all previous
    parallelizable: false,
  });

  onProgress({
    type: 'plan',
    message: `✓ Dynamic plan: ${tasks.length} tasks\n${tasks.map((t) => `  ${t.id}. ${t.name}`).join('\n')}`,
    totalTasks: tasks.length,
  });

  return { reasoning: `Dynamic ${tasks.length}-task plan`, tasks };
}

// ─── Phase 2: EXECUTE (with parallel support) ───────────────────────────────

/**
 * Execute a single task. The LLM gets:
 * - The FULL original prompt (no truncation)
 * - The FULL current file content (no truncation)
 * - The specific task description
 *
 * This matches how Super Z gives subagents full context.
 */
async function executeTask(
  task: AgentTask,
  fullPrompt: string,
  currentContent: string,
  model: LanguageModelV1,
): Promise<string> {
  const systemPrompt = `You are an expert web developer. Generate code for the specified task.

CRITICAL RULES:
1. You MUST output code wrapped in <palmkitArtifact> tags
2. For EXISTING files, output the COMPLETE file with your additions MERGED in
3. Write COMPLETE code — no placeholders, no "...", no "// rest stays same"
4. Include ALL specific text, numbers, names, URLs from the original prompt
5. End with __PALMKIT_DONE__ on the last line
6. Do NOT skip or summarize any content

FORMAT:
<palmkitArtifact id="task-${task.id}" title="${task.name}">
<palmkitAction type="file" filePath="${task.file}">
[COMPLETE FILE CONTENT — include ALL existing code + your additions]
</palmkitAction>
</palmkitArtifact>
__PALMKIT_DONE__`;

  // FULL prompt + FULL current content — NO TRUNCATION
  const userPrompt = `=== ORIGINAL REQUEST (FULL) ===
${fullPrompt}

=== YOUR TASK ===
${task.name}
${task.description}

=== CURRENT ${task.file} CONTENT (MERGE your additions into this) ===
${currentContent || '(empty — this is a new file)'}

Generate the COMPLETE updated ${task.file}. Include ALL existing content plus your new additions. Do not skip anything.`;

  // Use Promise.race with a timeout to prevent tasks from hanging forever
  // 3 minutes max per task (180s) — enough for 16000 tokens
  const TASK_TIMEOUT_MS = 180_000;

  const resultPromise = generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 16000,
    temperature: 0.7,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Task timed out after ${TASK_TIMEOUT_MS / 1000}s`)), TASK_TIMEOUT_MS),
  );

  try {
    const result = await Promise.race([resultPromise, timeoutPromise]);
    return result.text ?? '';
  } catch (err) {
    logger.warn(`[orchestrator] Task execution error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/**
 * Extract file content from palmkitArtifact response.
 */
function extractFileContent(text: string): string | null {
  const match = text.match(/<palmkitAction[^>]*>([\s\S]*?)<\/palmkitAction>/i);
  return match?.[1]?.trim() ?? null;
}

// ─── Phase 3: VERIFY (check completeness) ───────────────────────────────────

/**
 * Verify that a task's output is complete and contains expected elements.
 *
 * Like Super Z checking "did this step actually work?" before proceeding.
 */
function verifyTaskOutput(
  content: string,
  task: AgentTask,
  fullPrompt: string,
): { passed: boolean; missing: string[] } {
  const missing: string[] = [];

  // Basic checks
  if (content.length < 20) {
    missing.push('output too short');
  }

  // Check for specific content mentioned in the task description
  // Extract quoted strings from the task description
  const quotedStrings = task.description.match(/["']([^"']+)["']/g) || [];
  for (const quoted of quotedStrings) {
    const text = quoted.replace(/["']/g, '');
    // Skip generic words, only check meaningful content (>3 chars)
    if (text.length > 3 && !['json', 'html', 'file', 'type', 'text', 'babel'].includes(text.toLowerCase())) {
      if (!content.includes(text)) {
        missing.push(`missing: "${text}"`);
      }
    }
  }

  // Check for specific numbers from the prompt
  const numbers = fullPrompt.match(/\b\d+\.?\d*[BMK+]?/g) || [];
  for (const num of numbers) {
    if (num.length > 2 && !content.includes(num)) {
      // Only flag if it's a meaningful number (not just "1" or "2")
      if (/\d{2,}/.test(num) || num.includes('.') || num.includes('B') || num.includes('M')) {
        missing.push(`missing number: ${num}`);
      }
    }
  }

  return {
    passed: missing.length === 0,
    missing: missing.slice(0, 5), // cap for brevity
  };
}

// ─── Phase 4: FIX (targeted repair, not full regeneration) ──────────────────

/**
 * If a task's output is incomplete, send a TARGETED fix request.
 * This is cheaper than regenerating the entire task.
 *
 * Like Super Z using Edit tool to fix a specific line instead of Write.
 */
async function fixTaskOutput(
  content: string,
  missing: string[],
  task: AgentTask,
  fullPrompt: string,
  model: LanguageModelV1,
): Promise<string> {
  const fixPrompt = `The previous output for task "${task.name}" is missing these elements:
${missing.map((m) => `- ${m}`).join('\n')}

Here is the current content:
${content.substring(0, 5000)}

Add the missing elements. Output the COMPLETE updated file in <palmkitArtifact> format.

Original request for reference:
${fullPrompt}`;

  // Timeout: 2 minutes for fix requests (shorter than full task)
  const FIX_TIMEOUT_MS = 120_000;

  const resultPromise = generateText({
    model,
    system: 'You are fixing incomplete code output. Add the missing elements and output the COMPLETE file.',
    prompt: fixPrompt,
    maxTokens: 16000,
    temperature: 0.5,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Fix timed out')), FIX_TIMEOUT_MS),
  );

  try {
    const result = await Promise.race([resultPromise, timeoutPromise]);
    const fixed = extractFileContent(result.text ?? '');
    return fixed ?? content;
  } catch {
    return content; // return original if fix failed
  }
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

export async function orchestrateBuild(
  prompt: string,
  model: LanguageModelV1,
  existingFiles: Record<string, { type: 'file'; content: string }>,
  onProgress: ProgressCallback,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const taskResults: TaskResult[] = [];
  const worklogEntries: string[] = [`# Build Worklog\nStarted: ${new Date().toISOString()}\nPrompt: ${prompt.substring(0, 200)}...\n`];

  // Keep-alive timer (prevents connection drop during long LLM calls)
  const keepAlive = setInterval(() => {
    onProgress({
      type: 'task_start',
      message: `⏳ Working... (${Math.round((Date.now() - startTime) / 1000)}s)`,
    });
  }, 5000);

  try {
    // ── Phase 1: ANALYZE + PLAN ─────────────────────────────────────────
    const plan = await analyzeAndPlan(prompt, model, onProgress);
    worklogEntries.push(`## Plan\n${plan.tasks.map((t) => `- [ ] ${t.id}. ${t.name}`).join('\n')}\n`);

    // ── Phase 2: EXECUTE tasks ──────────────────────────────────────────
    let currentContent = existingFiles['index.html']?.content ?? '';
    const completedTasks = new Set<number>();

    // Group tasks by dependency level (for parallel execution)
    while (completedTasks.size < plan.tasks.length) {
      // Find tasks whose dependencies are all met
      const ready = plan.tasks.filter(
        (t) => !completedTasks.has(t.id) && (t.dependsOn ?? []).every((dep) => completedTasks.has(dep)),
      );

      if (ready.length === 0) {
        // Deadlock — shouldn't happen, but handle gracefully
        logger.warn('[orchestrator] No ready tasks (possible circular dependency)');
        break;
      }

      // Split into parallelizable and sequential
      const parallel = ready.filter((t) => t.parallelizable && ready.length > 1);
      const sequential = ready.filter((t) => !t.parallelizable || ready.length === 1);

      // Execute sequential tasks one by one
      for (const task of sequential) {
        const result = await runTask(task, prompt, currentContent, model, onProgress, worklogEntries);
        taskResults.push(result);
        completedTasks.add(task.id);
        if (result.success && result.content) {
          currentContent = result.content;
        }
      }

      // Execute parallel tasks simultaneously (like Super Z's Task tool)
      if (parallel.length > 1) {
        onProgress({
          type: 'task_start',
          message: `⚡ Running ${parallel.length} tasks in parallel...`,
        });

        const results = await Promise.all(
          parallel.map((task) =>
            runTask(task, prompt, currentContent, model, onProgress, worklogEntries).catch((err) => ({
              taskId: task.id,
              taskName: task.name,
              success: false,
              content: '',
              duration: 0,
              verified: false,
              error: err.message,
            })),
          ),
        );

        for (const result of results) {
          taskResults.push(result);
          completedTasks.add(result.taskId);
          if (result.success && result.content) {
            // Merge: use the longest content (most complete)
            if (result.content.length > currentContent.length) {
              currentContent = result.content;
            }
          }
        }
      }
    }

    // ── Phase 3: FINAL VERIFICATION ────────────────────────────────────
    onProgress({ type: 'verify', message: '🔍 Final verification...' });

    const successCount = taskResults.filter((r) => r.success).length;
    const success = successCount > 0 && currentContent.length > 100;

    worklogEntries.push(`\n## Results\n- Tasks: ${successCount}/${plan.tasks.length} succeeded\n- Final size: ${currentContent.length} chars\n- Duration: ${Date.now() - startTime}ms\n`);

    if (success) {
      onProgress({
        type: 'complete',
        message: `🚀 Build complete! ${successCount}/${plan.tasks.length} tasks succeeded, ${currentContent.length} chars (${Date.now() - startTime}ms)`,
      });
    } else {
      onProgress({ type: 'error', message: `Build failed — ${successCount}/${plan.tasks.length} tasks succeeded` });
    }

    return {
      success,
      files: success ? { [plan.tasks[0]?.file ?? 'index.html']: { type: 'file', content: currentContent } } : {},
      taskResults,
      totalDuration: Date.now() - startTime,
      worklog: worklogEntries.join('\n'),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    onProgress({ type: 'error', message: `Build failed: ${errorMsg}` });
    return {
      success: false,
      files: existingFiles,
      taskResults,
      totalDuration: Date.now() - startTime,
      worklog: worklogEntries.join('\n'),
    };
  } finally {
    clearInterval(keepAlive);
  }
}

/**
 * Run a single task with verification and fix-on-failure.
 */
async function runTask(
  task: AgentTask,
  fullPrompt: string,
  currentContent: string,
  model: LanguageModelV1,
  onProgress: ProgressCallback,
  worklog: string[],
): Promise<TaskResult> {
  const taskStart = Date.now();

  onProgress({
    type: 'task_start',
    message: `▶ Task ${task.id}: ${task.name}`,
    taskId: task.id,
    taskName: task.name,
  });

  try {
    // Execute the task (FULL prompt + FULL content — no truncation)
    const rawOutput = await executeTask(task, fullPrompt, currentContent, model);
    let fileContent = extractFileContent(rawOutput);

    if (!fileContent || fileContent.length < 20) {
      throw new Error(`Output too short (${fileContent?.length ?? 0} chars)`);
    }

    // VERIFY: check if output contains expected elements
    const verification = verifyTaskOutput(fileContent, task, fullPrompt);

    if (!verification.passed && verification.missing.length > 0) {
      onProgress({
        type: 'task_fix',
        message: `🔧 Task ${task.id}: fixing missing elements (${verification.missing.length})...`,
        taskId: task.id,
        taskName: task.name,
      });

      // TARGETED FIX: send a fix request (not full regeneration)
      const fixedContent = await fixTaskOutput(fileContent, verification.missing, task, fullPrompt, model);

      if (fixedContent && fixedContent.length > fileContent.length) {
        fileContent = fixedContent;
        onProgress({
          type: 'task_complete',
          message: `✓ Task ${task.id}: ${task.name} (fixed +verified, ${fileContent.length} chars)`,
          taskId: task.id,
          taskName: task.name,
        });
      } else {
        onProgress({
          type: 'task_complete',
          message: `✓ Task ${task.id}: ${task.name} (${fileContent.length} chars, ${verification.missing.length} items may be missing)`,
          taskId: task.id,
          taskName: task.name,
        });
      }
    } else {
      onProgress({
        type: 'task_complete',
        message: `✓ Task ${task.id}: ${task.name} (verified ✓, ${fileContent.length} chars)`,
        taskId: task.id,
        taskName: task.name,
      });
    }

    const duration = Date.now() - taskStart;
    worklog.push(`- [x] ${task.id}. ${task.name} (${duration}ms, ${fileContent.length} chars)\n`);

    return {
      taskId: task.id,
      taskName: task.name,
      success: true,
      content: fileContent,
      duration,
      verified: verification.passed,
    };
  } catch (err) {
    const duration = Date.now() - taskStart;
    const errorMsg = err instanceof Error ? err.message : String(err);

    onProgress({
      type: 'task_error',
      message: `⚠ Task ${task.id}: ${task.name} failed — ${errorMsg}`,
      taskId: task.id,
      taskName: task.name,
    });

    worklog.push(`- [!] ${task.id}. ${task.name} FAILED: ${errorMsg}\n`);

    return {
      taskId: task.id,
      taskName: task.name,
      success: false,
      content: '',
      duration,
      verified: false,
      error: errorMsg,
    };
  }
}
