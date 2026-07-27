/**
 * Chat-Side Build Orchestrator — Phase 3
 *
 * This runs on Cloudflare Pages (in api.chat.ts) and uses the same
 * provider/model infrastructure as the normal chat path.
 *
 * It decomposes complex prompts into sequential tasks, generates each
 * with a small LLM call, and streams progress to the browser.
 */

import { streamText, type LanguageModelV1 } from 'ai';
import { logger } from '~/utils/logger';

export interface OrchestratorTask {
  id: number;
  name: string;
  file: string;
  description: string;
}

export interface OrchestratorPlan {
  reasoning: string;
  tasks: OrchestratorTask[];
}

export interface OrchestratorResult {
  success: boolean;
  artifactText: string; // The final palmkitArtifact text to send to the parser
  taskResults: Array<{
    taskId: number;
    taskName: string;
    success: boolean;
    duration: number;
    error?: string;
  }>;
  totalDuration: number;
}

export type ProgressCallback = (update: {
  type: 'plan' | 'task_start' | 'task_complete' | 'task_error' | 'verify' | 'complete' | 'error';
  message: string;
  taskId?: number;
  totalTasks?: number;
  taskName?: string;
}) => void;

/**
 * Check if a prompt is complex enough to warrant decomposition.
 */
export function shouldDecompose(prompt: string): boolean {
  if (prompt.length < 500) {
    return false;
  }

  const lower = prompt.toLowerCase();
  const componentKeywords = [
    'component',
    'section',
    'navbar',
    'footer',
    'hero',
    'card',
    'modal',
    'sidebar',
    'dashboard',
    'table',
    'form',
    'carousel',
    'video',
    'animation',
    'framer motion',
    'tailwind',
    'custom',
    'liquid',
    'glass',
    'crossfade',
    'intersection',
  ];

  const matches = componentKeywords.filter((k) => lower.includes(k)).length;

  return matches >= 3;
}

/**
 * Decompose a complex prompt into sequential tasks.
 */
async function decompose(
  prompt: string,
  model: LanguageModelV1,
  onProgress: ProgressCallback,
): Promise<OrchestratorPlan> {
  onProgress({
    type: 'plan',
    message: '📋 Analyzing request and creating build plan...',
  });

  const systemPrompt = `You are a project planner for an AI app builder. Break the user's request into 3-8 sequential tasks.

RULES:
1. Each task should produce code that fits in 1000-3000 chars
2. Order by dependency: foundation first, then components, then assembly
3. For single-file apps (HTML/CSS/JS), each task adds a SECTION to the same file
4. For multi-file apps, each task creates or updates ONE file
5. Be specific about what to create

OUTPUT FORMAT (strict JSON, no markdown):
{"reasoning":"1-2 sentences","tasks":[{"id":1,"name":"Short name","file":"index.html","description":"What to generate"}]}`;

  /*
   * Use streamText (not generateText) to avoid CF Pages 30s wall-clock limit.
   * streamText is exempt from the timeout because it's a streaming response.
   */
  const result = await streamText({
    model,
    system: systemPrompt,
    prompt: `Break this into tasks:\n\n${prompt}`,
    maxTokens: 2000,
    temperature: 0.3,
  });

  // Collect the full text from the stream
  let fullText = '';

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      fullText += part.textDelta;
    }
  }

  try {
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    const plan = JSON.parse(jsonMatch?.[0] ?? fullText ?? '{}') as OrchestratorPlan;

    if (!plan.tasks?.length) {
      throw new Error('No tasks in plan');
    }

    onProgress({
      type: 'plan',
      message: `✓ Plan ready: ${plan.tasks.length} tasks\n${plan.tasks.map((t) => `  ${t.id}. ${t.name}`).join('\n')}`,
      totalTasks: plan.tasks.length,
    });

    return plan;
  } catch {
    // Fallback: single task
    onProgress({
      type: 'plan',
      message: '✓ Plan ready: 1 task (direct build)',
      totalTasks: 1,
    });

    return {
      reasoning: 'Single task fallback',
      tasks: [{ id: 1, name: 'Build project', file: 'index.html', description: prompt }],
    };
  }
}

/**
 * Execute a single task.
 */
async function executeTask(
  task: OrchestratorTask,
  originalPrompt: string,
  currentContent: string,
  model: LanguageModelV1,
  onProgress?: ProgressCallback,
  taskId?: number,
  totalTasks?: number,
): Promise<string> {
  const systemPrompt = `You are an expert web developer. Generate code for the requested task.

CRITICAL RULES:
1. You MUST output code wrapped in <palmkitArtifact> tags
2. For EXISTING files, output the COMPLETE file with your additions merged in
3. Write COMPLETE code — no placeholders, no "...rest stays same"
4. End with __PALMKIT_DONE__ on the last line

FORMAT:
<palmkitArtifact id="task-${task.id}" title="${task.name}">
<palmkitAction type="file" filePath="${task.file}">
[COMPLETE FILE CONTENT]
</palmkitAction>
</palmkitArtifact>
__PALMKIT_DONE__`;

  const userPrompt = `Original request: ${originalPrompt.substring(0, 2000)}

${currentContent ? `Current ${task.file} content (MERGE your additions into this, output the COMPLETE file):` : 'This is a new file.'}
${currentContent ? currentContent.substring(0, 4000) : ''}

YOUR TASK: ${task.name}
${task.description}

Generate the ${currentContent ? 'updated' : 'complete'} ${task.file} file now. Output ONLY the palmkitArtifact.`;

  // Use streamText with a timeout to prevent hanging.
  const result = await streamText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 8000,
    temperature: 0.7,
  });

  // Collect full text from stream with a 90s timeout
  let fullText = '';
  const TIMEOUT_MS = 90_000;
  const startTime = Date.now();

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      fullText += part.textDelta;

      // Send keep-alive progress every 5 seconds
      if (onProgress && taskId && totalTasks) {
        const elapsed = Date.now() - startTime;

        if (elapsed % 5000 < 1000) {
          onProgress({
            type: 'task_start',
            message: `▶ Task ${taskId}/${totalTasks}: ${task.name} — generating (${fullText.length} chars)...`,
            taskId,
            totalTasks,
            taskName: task.name,
          });
        }
      }
    }

    // Check timeout
    if (Date.now() - startTime > TIMEOUT_MS) {
      logger.warn(`[orchestrator] Task ${task.id} timed out after ${TIMEOUT_MS}ms (${fullText.length} chars received)`);
      break;
    }
  }

  return fullText;
}

/**
 * Extract file content from the LLM response.
 */
function extractFileContent(text: string): string | null {
  const actionMatch = text.match(/<palmkitAction[^>]*>([\s\S]*?)<\/palmkitAction>/i);
  return actionMatch?.[1]?.trim() ?? null;
}

/**
 * Main orchestrator entry point.
 *
 * Returns the final palmkitArtifact text that api.chat.ts can feed
 * into the data stream (the parser will extract files from it).
 */
export async function orchestrateBuild(
  prompt: string,
  model: LanguageModelV1,
  onProgress: ProgressCallback,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const taskResults: OrchestratorResult['taskResults'] = [];

  /*
   * Keep-alive timer: sends a progress message every 5 seconds to prevent
   * the HTTP connection from being dropped during long task execution.
   * Without this, the browser/proxy may close the connection after 60-120s
   * of inactivity, killing the orchestrator mid-task.
   */
  const keepAlive = setInterval(() => {
    onProgress({
      type: 'task_start',
      message: `⏳ Working... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`,
    });
  }, 5000);

  try {
    // Phase 1: Decompose
    const plan = await decompose(prompt, model, onProgress);

    // Phase 2: Execute tasks sequentially
    let currentContent = '';

    for (const task of plan.tasks) {
      const taskStart = Date.now();

      onProgress({
        type: 'task_start',
        message: `▶ Task ${task.id}/${plan.tasks.length}: ${task.name}`,
        taskId: task.id,
        totalTasks: plan.tasks.length,
        taskName: task.name,
      });

      try {
        const resultText = await executeTask(
          task,
          prompt,
          currentContent,
          model,
          onProgress,
          task.id,
          plan.tasks.length,
        );
        const fileContent = extractFileContent(resultText);

        if (!fileContent || fileContent.length < 20) {
          throw new Error(`Output too short (${fileContent?.length ?? 0} chars)`);
        }

        currentContent = fileContent;

        const duration = Date.now() - taskStart;

        taskResults.push({
          taskId: task.id,
          taskName: task.name,
          success: true,
          duration,
        });

        onProgress({
          type: 'task_complete',
          message: `✓ Task ${task.id}/${plan.tasks.length}: ${task.name} (${duration}ms, ${fileContent.length} chars)`,
          taskId: task.id,
          totalTasks: plan.tasks.length,
          taskName: task.name,
        });

        logger.info(`[orchestrator] Task ${task.id} complete: ${task.name} (${duration}ms)`);
      } catch (taskErr) {
        const duration = Date.now() - taskStart;
        const errorMsg = taskErr instanceof Error ? taskErr.message : String(taskErr);

        taskResults.push({
          taskId: task.id,
          taskName: task.name,
          success: false,
          duration,
          error: errorMsg,
        });

        onProgress({
          type: 'task_error',
          message: `⚠ Task ${task.id} failed: ${errorMsg}. Continuing...`,
          taskId: task.id,
          totalTasks: plan.tasks.length,
          taskName: task.name,
        });
      }
    }

    // Phase 3: Build final artifact from accumulated content
    onProgress({
      type: 'verify',
      message: '🔍 Assembling final build...',
    });

    const successCount = taskResults.filter((r) => r.success).length;
    const success = successCount > 0 && currentContent.length > 50;

    // Build the final palmkitArtifact that the parser will process
    const finalFile = plan.tasks[0]?.file ?? 'index.html';
    const artifactText = `<palmkitArtifact id="orchestrated-build" title="Build Result">
<palmkitAction type="file" filePath="${finalFile}">
${currentContent}
</palmkitAction>
</palmkitArtifact>
__PALMKIT_DONE__`;

    const totalDuration = Date.now() - startTime;

    if (success) {
      onProgress({
        type: 'complete',
        message: `🚀 Build complete! ${successCount}/${plan.tasks.length} tasks succeeded (${totalDuration}ms, ${currentContent.length} chars)`,
      });
    } else {
      onProgress({
        type: 'error',
        message: `Build failed — no tasks succeeded`,
      });
    }

    return {
      success,
      artifactText,
      taskResults,
      totalDuration,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    onProgress({
      type: 'error',
      message: `Build failed: ${errorMsg}`,
    });

    return {
      success: false,
      artifactText: '',
      taskResults,
      totalDuration: Date.now() - startTime,
    };
  } finally {
    clearInterval(keepAlive);
  }
}
