/**
 * Orchestrator — Coordinates subagents to build a project
 *
 * Flow:
 * 1. Orchestrator reads the user prompt + worklog + manifest
 * 2. Orchestrator creates a build plan (which agents to call, in what order)
 * 3. For each step in the plan:
 *    a. Get the agent config (role, tools, system prompt)
 *    b. Filter tools to only allowed ones
 *    c. Run generateText with that agent's config
 *    d. Collect the result
 * 4. Return the final result (files from Builder, verification from Tester)
 *
 * In Phase 1, we use a DEFAULT_AGENT_FLOW (Researcher → Builder → Tester)
 * instead of asking the Orchestrator LLM to plan. This is simpler and
 * more reliable. The Orchestrator LLM planning can be added in Phase 2.
 */

import { streamText, type LanguageModelV1, type ToolSet } from 'ai';

/*
 * GLOBAL TOOL-CALL REPAIR — the root fix for GLM's string-serialization
 * habit. GLM-4.x/5.x models frequently pass structured arguments as JSON
 * STRINGS ('[{...}]' for arrays, '{"width":390}' for objects). A strict
 * schema then fails validation at the SDK layer and the error aborts the
 * whole stream — this killed live builds three separate ways (done(),
 * write_files(), analyze_screenshot()) before per-tool guards were added.
 *
 * Instead of patching every tool schema forever, this repairer runs ONLY
 * when the SDK reports InvalidToolArgumentsError, deep-walks the args, and
 * parses any string value that is itself valid JSON of an object/array.
 * Deterministic (no extra LLM call); returns null when it cannot help so
 * the original error surfaces unchanged.
 */
function repairStringifiedArgs(argsJson: string): string | null {
  const looksJson = (s: string) => {
    const t = s.trimStart();
    return t.startsWith('{') || t.startsWith('[');
  };

  const deepRepair = (v: unknown): { value: unknown; changed: boolean } => {
    if (typeof v === 'string' && looksJson(v)) {
      try {
        const parsed = JSON.parse(v);

        if (parsed && typeof parsed === 'object') {
          return { value: deepRepair(parsed).value, changed: true };
        }
      } catch {
        /* not JSON — keep the string */
      }

      return { value: v, changed: false };
    }

    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((item) => {
        const r = deepRepair(item);
        changed = changed || r.changed;

        return r.value;
      });

      return { value: out, changed };
    }

    if (v && typeof v === 'object') {
      let changed = false;
      const out: Record<string, unknown> = {};

      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const r = deepRepair(val);
        changed = changed || r.changed;
        out[k] = r.value;
      }

      return { value: out, changed };
    }

    return { value: v, changed: false };
  };

  try {
    const parsed = JSON.parse(argsJson);
    const { value, changed } = deepRepair(parsed);

    return changed ? JSON.stringify(value) : null;
  } catch {
    return null;
  }
}
import {
  createAgentTools,
  resetProjectFiles,
  getProjectFiles,
  getJobFiles,
  disposeProjectFiles,
  getBuildResult,
  disposeBuildResult,
  getDoneSummary,
  disposeDoneSummary,
} from './agent-tools';
import { filterTools, getAgentConfig, DEFAULT_AGENT_FLOW, type AgentRole } from './agent-registry';
import { disposeSandbox } from './e2b-runner';
import { putFile, buildWorkspaceKey } from './r2-client';
import { logger } from './logger';
import { emitEvent } from './event-emitter';
import type { SupabaseClient } from '@supabase/supabase-js';
import { detectAppTypeFromFiles, type FileOperation } from './project-spec';
import {
  readWorklog,
  readWorkspaceFile,
  appendToWorklog,
  readManifest,
  writeManifest,
  generateWorklogEntry,
  generateSmartManifest,
  writePalmkitMemory,
  writePalmkitProjectMemory,
  writePalmkitFile,
} from './workspace-manager';
import { loadSession, appendToSession, estimateSessionTokens, type SessionMessage } from './session-manager';
import { commitProjectTurn } from './git-manager';
import { sendDelta, sendTool, sendStep, closeJobStream } from './stream-bus';
import { registerJobAbort, unregisterJobAbort } from './abort-registry';

export interface OrchestratorResult {
  success: boolean;
  files: FileOperation[];
  rawText: string;
  totalDuration: number;
  agentResults: Array<{ role: AgentRole; success: boolean; text: string; duration: number }>;

  /**
   * ANSWER MODE — the agent judged the request to be a question/discussion
   * and finished via done() without touching files. A legitimate success.
   */
  answered: boolean;

  /**
   * Context-pressure telemetry — the peak input (prompt) tokens the model
   * consumed on its single most demanding request during this build, and the
   * model's context window. Drives the "continue in a fresh chat" nudge on the
   * client, replacing the old file-count heuristic with a real measurement of
   * how full the context actually got.
   */
  contextTokens: number;
  contextWindow: number;
  contextRatio: number;
  truncated: boolean;
}

/** Fallback context window when the model's real limit isn't known. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Run the full agent pipeline: Researcher → Builder → Tester
 *
 * Each agent gets its own generateText call with filtered tools.
 * The Researcher's output is passed as context to the Builder.
 * The Builder's output (files) is passed to the Tester.
 */
export async function runOrchestratedBuild(
  prompt: string,
  model: LanguageModelV1,
  jobId: string,
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  maxCompletionTokens?: number,
  appType?: string,
  contextWindow?: number,
  opts?: {
    /** Per-role model overrides (Model Router): brain/builder/tester. Missing role = main model. */
    agentModels?: Partial<Record<'brain' | 'builder' | 'tester', LanguageModelV1>>;

    /** How hard reasoning models think: off | medium | max (default: enabled, provider-decided). */
    reasoningEffort?: 'off' | 'medium' | 'max';

    /** Media config for generate_image (OpenRouter key + image model). */
    media?: import('./agent-tools').MediaConfig;

    /** User-enabled Skills — instruction playbooks injected into Planner/Builder. */
    skills?: { name: string; instructions: string }[];

    /** User-enabled Libraries — reference material injected into the Builder. */
    libraries?: { name: string; kind: string; content: string }[];

    /** Model config for sub-agents (passed through so they can create their own model instance) */
    modelConfig?: {
      provider: string;
      model: string;
      apiKey: string;
      reasoningEffort?: 'off' | 'medium' | 'max';
    };

    /** Optional pipeline phases the user toggled (Researcher / Tester). */
    agentConfig?: { researcher: boolean; tester: boolean };

    /** User-chosen design scheme (palette + fonts + features) — injected into Planner/Builder. */
    designScheme?: { palette: Record<string, string>; font: string[]; features: string[] };

    /** Preload existing files into the agent workspace (edit mode). */
    preloadFiles?: Array<{ path: string; content: string }>;

    /** Conversation history (last few messages) — for edit context references. */
    conversationHistory?: Array<{ role: string; content: string }>;

    /*
     * User-uploaded images — the user attached these to their prompt (food
     * photos, logos, screenshots, etc.). Each entry has the original R2 path,
     * a base64 data URL, and the MIME type. The brain receives them inline
     * in its prompt so it can:
     *   1. "See" them (if the model supports multimodal/vision input)
     *   2. Reference them by path in the project (e.g., /uploads/user-image-0.jpg)
     *   3. Save them to the workspace as actual files the built site can serve
     *
     * Without this, the user's image uploads were silently dropped — the brain
     * never knew they existed.
     */
    userImages?: Array<{ path: string; dataUrl: string; mime: string }>;
  },
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  resetProjectFiles(jobId);

  /*
   * Edit mode: preload existing files into the agent's workspace map so the
   * Builder agent can read_file, edit_file, and run_shell against them.
   * Without this, the Builder starts from an empty workspace and rebuilds
   * from scratch — losing all the user's existing work.
   */
  const isEditMode = opts?.preloadFiles && opts.preloadFiles.length > 0;

  if (isEditMode) {
    const projectFiles = getJobFiles(jobId);

    for (const f of opts!.preloadFiles!) {
      projectFiles.set(f.path, f.content);
    }

    logger.info(`[orchestrator] Edit mode: preloaded ${opts!.preloadFiles!.length} files into workspace`);
  }

  /*
   * USER-UPLOADED IMAGES — write them into the workspace as ES modules at
   * src/assets/user-image-N.ts, following the SAME pattern as generate_image.
   * Each module exports the data URL as the default export:
   *
   *   // User-uploaded image (image/jpeg, ~123KB). Do not edit.
   *   const src = "data:image/jpeg;base64,...";
   *   export default src;
   *
   * This way:
   *   1. The brain can `import userImage0 from './assets/user-image-0'` and
   *      use it as `<img src={userImage0}>` — the bundler inlines the data URL.
   *   2. The built site renders the image correctly (data URLs work everywhere).
   *   3. The brain's list_files() shows them, so it knows they're available.
   *   4. No need for binary file serving — the data URL is embedded in JS.
   *
   * For static HTML projects (no bundler), the brain can also just inline the
   * data URL directly into <img src="data:..."> — the prompt instruction
   * explains both patterns.
   */
  if (opts?.userImages && opts.userImages.length > 0) {
    const projectFiles = getJobFiles(jobId);

    for (let i = 0; i < opts.userImages.length; i++) {
      const img = opts.userImages[i];
      const modulePath = `src/assets/user-image-${i}.ts`;
      const approxKb = Math.round((img.dataUrl.length * 0.75) / 1024);
      const mod =
        `// User-uploaded image (${img.mime}, ~${approxKb}KB). Do not edit — replace by re-uploading.\n` +
        `const src = ${JSON.stringify(img.dataUrl)};\nexport default src;\n`;
      projectFiles.set(modulePath, mod);

      /*
       * Emit a user_image event so the front-end shows the uploaded image
       * inline in the stream. This gives the user visual confirmation that
       * their upload was received and is available to the brain. Reuses the
       * same `image_ready` kind the BuildStream already knows how to render.
       */
      try {
        await emitEvent(supabase, jobId, 'file_chunk', `📷 User image ${i + 1} ready (${approxKb}KB)`, {
          agent: 'Brain',
          kind: 'image_ready',
          name: `user-image-${i}`,
          dataUrl: img.dataUrl,
          mime: img.mime,
          sizeBytes: Math.round(img.dataUrl.length * 0.75),
          isUserUpload: true,
        });
      } catch {
        // best-effort — don't fail the build if the event can't be emitted
      }
    }

    logger.info(
      `[orchestrator] Wrote ${opts.userImages.length} user-uploaded images to workspace at src/assets/user-image-*.ts`,
    );
  }

  /*
   * Context-pressure tracking. We measure the PEAK single-request prompt-token
   * count across every agent step (not the sum — the sum over-counts, since each
   * step re-sends the growing conversation). The largest single request is what
   * actually approaches the model's context window, so it's the honest "how full
   * did the context get" number. `truncated` flips if any agent finishReason was
   * 'length' — the model literally ran out of room, the strongest possible fork
   * signal.
   */
  const effectiveContextWindow = contextWindow && contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW;
  let peakPromptTokens = 0;
  let truncated = false;

  logger.info(`[orchestrator] Starting orchestrated build for job ${jobId} (project ${projectId})`);

  // Read worklog for context
  const worklog = await readWorklog(projectId);
  const hasWorklog = !!worklog;

  /*
   * PALMKIT SESSION — the project's ongoing conversation. Loaded once per
   * build; the brain runs on [session messages + this build's user message]
   * so it remembers everything it did in earlier turns (files, commands,
   * decisions) instead of reconstructing context from prompt blocks. After
   * the brain finishes, this build's exchange is appended back (compacted).
   */
  const session = await loadSession(projectId);
  const hasSession = session.messages.length > 0;

  /*
   * Palmkit.md — the project's memory file (stack, entrypoints, state,
   * decisions). Written at the end of every build; injected at session
   * start so the agent always knows what project it is working on.
   */
  const palmkitMd = await readWorkspaceFile(projectId, 'Palmkit.md');

  /*
   * .palmkit/ MEMORY LAYER — deep project memory that was previously WRITTEN
   * but NEVER READ (dead code). This radical fix loads the full memory layer
   * and injects it into the brain's prompt, giving the agent real context
   * across turns:
   *
   * - worklog.md: WHAT was built in previous turns (agent-authored narrative)
   * - current-task.md: WHAT the user asked for last (the active task)
   * - decisions.md: WHY certain choices were made (design decisions)
   * - errors.json: errors encountered in previous turns (avoid repeating)
   *
   * Without this, the brain sees only Palmkit.md (a 15-line summary) and
   * loses all turn-by-turn context. With it, the brain can say "last turn
   * you asked me to add a dark mode toggle — I see it's already there,
   * what would you like to change?"
   */
  const [worklogMd, currentTaskMd, decisionsMd, errorsJson] = await Promise.all([
    readWorkspaceFile(projectId, '.palmkit/worklog.md').catch(() => null),
    readWorkspaceFile(projectId, '.palmkit/current-task.md').catch(() => null),
    readWorkspaceFile(projectId, '.palmkit/decisions.md').catch(() => null),
    readWorkspaceFile(projectId, '.palmkit/errors.json').catch(() => null),
  ]);

  let previousErrors: string[] = [];

  try {
    if (errorsJson) {
      const parsed = JSON.parse(errorsJson);
      if (Array.isArray(parsed)) {
        previousErrors = parsed.slice(-5); // last 5 errors only
      }
    }
  } catch {
    // not valid JSON — ignore
  }

  /*
   * CONTINUATION HANDOFF — when this project was forked from another chat
   * ("Continue in a fresh chat"), /api/fork-chat wrote .palmkit/handoff.md: a
   * compact brief of the carried-over project (type, stack, files, last state,
   * suggested next step). Injecting it into the agents' prompts GUARANTEES the
   * model knows it is CONTINUING an existing project — with its real state —
   * before it does anything, instead of blindly rebuilding from scratch.
   */
  const handoff = await readWorkspaceFile(projectId, '.palmkit/handoff.md');
  const handoffBlock = handoff
    ? `\n\n=== CONTINUATION HANDOFF (this project was carried over from a previous chat — you are CONTINUING it, not starting over) ===\n${handoff}\n=== END HANDOFF ===\n`
    : '';

  if (handoff) {
    logger.info(
      `[orchestrator] Continuation handoff found for ${projectId} (${handoff.length} chars) — injecting into agents`,
    );
    await emitEvent(
      supabase,
      jobId,
      'file_chunk',
      '🧬 Continuing a project carried over from a previous chat — loaded its handoff memory',
      { continuation: true },
    );
  }

  /*
   * DESIGN BRIEF MEMORY — the Planner writes .palmkit/design-brief.md on the
   * first build (identity + palette + media plan). On later edits the Planner is
   * skipped, but the Builder still needs that art direction so the design stays
   * consistent (same palette, same logo, no off-theme new imagery). We load any
   * previously-saved brief here and fall back to it when the Planner didn't run.
   */
  const existingBrief = await readWorkspaceFile(projectId, '.palmkit/design-brief.md');

  /*
   * Create all tools (shared across agents, filtered per agent)
   * Pass the model so spawn_subagent can create sub-agents
   */
  const allTools = createAgentTools(jobId, supabase, projectId, opts?.media, model, opts?.modelConfig);

  // Keep-alive timer (every 10s instead of 5s to reduce Realtime events)
  const keepAlive = setInterval(async () => {
    try {
      await emitEvent(
        supabase,
        jobId,
        'file_chunk',
        `⏳ Building... (${Math.round((Date.now() - startTime) / 1000)}s)`,
      );
    } catch {
      /* best-effort */
    }
  }, 10000);

  /*
   * Hard-cap the whole orchestrator at 15 minutes using AbortController.
   *
   * The previous approach used setTimeout + throw. That DID NOT WORK because:
   *   1. streamText runs as an async iterator (for await ... of fullStream).
   *   2. The throw inside setTimeout fires in a separate event-loop turn.
   *   3. The throw doesn't propagate into the active async iterator — the
   *      for-await loop keeps waiting for the next chunk that never arrives.
   *   4. Result: the Builder "finishes" writing files, then hangs forever
   *      reading/rewriting the same file in a loop, never calling done(),
   *      and the timeout never triggers a clean abort.
   *
   * The fix: AbortController. We pass abortSignal to streamText, which
   * forwards it to the underlying fetch() call. When abort() fires:
   *   - The fetch is cancelled → the LLM stream closes.
   *   - The for-await loop sees an error chunk (or throws) → breaks out.
   *   - We catch the AbortError and fail the job cleanly.
   *
   * 15 minutes is enough for real projects (Builder ~6min + Tester ~5min
   * + npm install on cold E2B ~3min). Anything beyond that is a stuck LLM.
   */
  const HARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — complex multi-phase builds (50+ files) need time
  const abortController = new AbortController();
  const hardTimeout = setTimeout(() => {
    logger.error(`[orchestrator] Hard timeout (${HARD_TIMEOUT_MS}ms) reached for job ${jobId} — aborting stream`);
    abortController.abort();
  }, HARD_TIMEOUT_MS);

  /*
   * Register an abort handle so the /jobs/:id/cancel endpoint can stop this
   * build on user demand. abort() fires the AbortController (cancels the
   * in-flight LLM fetch). finalize() writes a PARTIAL manifest from the files
   * written so far so the user's next message can edit the partial state
   * instead of waiting or starting fresh. Both must be safe to call from
   * outside the orchestrator's normal flow.
   */
  let finalizeCalled = false;

  const finalizePartial = async () => {
    if (finalizeCalled) {
      return;
    }

    finalizeCalled = true;

    try {
      const files = getProjectFiles(jobId) as Record<string, string>;
      const pathCount = Object.keys(files).length;

      if (pathCount === 0) {
        logger.info(`[orchestrator] Job ${jobId} cancelled with 0 files — no partial manifest`);
        return;
      }

      // Upload partial files to the workspace (same keying as the normal upload).
      for (const [path, content] of Object.entries(files)) {
        const workspaceKey = buildWorkspaceKey(projectId, path);

        try {
          await putFile(workspaceKey, content);
        } catch (e) {
          logger.warn(`[orchestrator] partial upload failed for ${path}: ${e}`);
        }
      }

      // Insert partial manifest rows so the edit path finds them.
      const manifestRows = Object.entries(files).map(([path, content]) => ({
        job_id: jobId,
        project_id: null,
        user_id: userId,
        path,
        version: 1,
        hash: '',
        size_bytes: new TextEncoder().encode(content).length,
        mime_type: 'text/plain',
        storage_provider: 'r2',
        storage_key: buildWorkspaceKey(projectId, path),
        integrity: 'partial',
      }));

      /*
       * Insert partial manifest rows. If rows already exist for this
       * (job_id, path) the insert will fail with a duplicate-key error —
       * that's fine, it means the normal upload phase already wrote them, so
       * the edit path will find them. Log the error but don't fail.
       */
      const { error: manifestErr } = await supabase.from('project_files_manifest').insert(manifestRows);

      if (manifestErr) {
        logger.warn(`[orchestrator] partial manifest insert failed: ${manifestErr.message}`);
      } else {
        logger.info(`[orchestrator] Job ${jobId}: wrote partial manifest (${manifestRows.length} files)`);
      }

      // Append a worklog note so the next build/edit knows it was interrupted.
      try {
        const fileList = Object.keys(files).join(', ');
        await appendToWorklog(
          projectId,
          `\n## Build interrupted by user\nPartial state saved (${manifestRows.length} files: ${fileList}). The next message should continue from here.\n`,
        ).catch(() => undefined);
      } catch {
        // best-effort
      }
    } catch (e) {
      logger.warn(`[orchestrator] finalizePartial error: ${e}`);
    }
  };

  registerJobAbort(jobId, {
    abort: () => abortController.abort(),
    finalize: finalizePartial,
  });

  const agentResults: OrchestratorResult['agentResults'] = [];

  let builderContext = '';
  let overallSuccess = false;

  /*
   * Empty-Builder retry. Some models (observed with GLM-5.2 on complex prompts)
   * spend the whole turn REASONING and never call write_file, then stop cleanly
   * — leaving 0 files. Rather than fail, we re-prompt the Builder ONCE with a
   * blunt "stop planning, write the files now" directive.
   */
  let builderEmptyRetries = 0;
  const MAX_BUILDER_EMPTY_RETRIES = 10; // Natural retry limit for stalls/errors
  let forceBuild = false;
  let incompleteBuild = false; // Vite build finished but is missing scaffolding (e.g. package.json)
  let verifyAndFinish = false; // Project looks complete — tell model to run npm install and call done()

  /*
   * Loop detection — track how many times each file path is written per
   * build. If a path is written 4+ times, the LLM is stuck in a loop
   * (observed with GLM-4.7: write → read → rewrite → hang). We abort
   * the stream to prevent the build from running forever.
   */
  const fileWriteCounts = new Map<string, number>();

  try {
    /*
     * A mutable work queue (not a fixed list) so a failed build can re-enqueue
     * a Builder repair round + another Tester verification.
     */
    const agentQueue = [...DEFAULT_AGENT_FLOW];

    while (agentQueue.length > 0) {
      const role = agentQueue.shift() as (typeof DEFAULT_AGENT_FLOW)[number];
      const config = getAgentConfig(role);

      const agentTools = filterTools(allTools as unknown as ToolSet, config.allowedTools);

      // Build the agent's prompt (includes context from previous agents)
      let agentPrompt = prompt;

      /*
       * BRAIN — the unified agent. Gets ALL context: handoff, worklog,
       * design scheme, skills, libraries. No role-specific filtering.
       */
      if (role === 'brain') {
        agentPrompt = `${prompt}${handoffBlock}`;

        /*
         * Project memory: Palmkit.md is the primary memory (written at the
         * end of every build). Fall back to the legacy worklog for projects
         * built before Palmkit.md existed. When the session already carries
         * the full conversation, memory is still injected — it is small and
         * anchors the project identity even after session compaction.
         */
        if (palmkitMd) {
          agentPrompt += `\n\n=== Palmkit.md (PROJECT MEMORY) ===\n${palmkitMd}\n=== END Palmkit.md ===`;
        } else if (hasWorklog) {
          agentPrompt += `\n\nPROJECT MEMORY (worklog.md):\n${worklog}`;
        }

        /*
         * DEEP MEMORY INJECTION — turn-by-turn context from .palmkit/ layer.
         * This gives the brain real conversation memory, not just a summary.
         * Each block is conditional (only injected if the file exists).
         */
        if (currentTaskMd) {
          agentPrompt += `\n\n=== CURRENT TASK (what you were working on) ===\n${currentTaskMd}\n=== END TASK ===`;
        }

        if (worklogMd) {
          // Truncate worklog to last 2000 chars to avoid context bloat
          const truncatedWorklog = worklogMd.length > 2000
            ? '...(earlier entries truncated)...\n' + worklogMd.slice(-2000)
            : worklogMd;
          agentPrompt += `\n\n=== WORKLOG (what was built in previous turns) ===\n${truncatedWorklog}\n=== END WORKLOG ===`;
        }

        if (decisionsMd) {
          // Truncate decisions to last 1500 chars
          const truncatedDecisions = decisionsMd.length > 1500
            ? '...(earlier decisions truncated)...\n' + decisionsMd.slice(-1500)
            : decisionsMd;
          agentPrompt += `\n\n=== DESIGN DECISIONS (why certain choices were made) ===\n${truncatedDecisions}\n=== END DECISIONS ===`;
        }

        if (previousErrors.length > 0) {
          agentPrompt += `\n\n=== PREVIOUS ERRORS (avoid repeating these) ===\n${previousErrors.map((e, i) => `${i + 1}. ${e.slice(0, 200)}`).join('\n')}\n=== END ERRORS ===`;
        }

        if (existingBrief) {
          agentPrompt += `\n\n=== DESIGN BRIEF (from previous build — keep the design consistent) ===\n${existingBrief}\n=== END BRIEF ===`;
        }

        /*
         * EXISTING FILES — show the brain WHAT files exist (names only,
         * NOT content). The brain reads the actual content via read_file
         * when it needs to — exactly like Super Z reads files from disk.
         *
         * This is the KEY difference from before: instead of injecting
         * all file content into the prompt (consuming tokens and making
         * the brain lazy), we give it a FILE LIST and let it decide
         * which files to read. This makes edits PRECISE because the
         * brain sees the actual code before editing, not a summary.
         */
        const existingFiles = getProjectFiles(jobId);
        const existingPaths = Object.keys(existingFiles);

        if (existingPaths.length > 0) {
          const fileListBlock = existingPaths
            .sort()
            .map((p) => {
              const content = existingFiles[p] || '';
              const lines = content.split('\n').length;

              return `  - ${p} (${lines} lines)`;
            })
            .join('\n');
          agentPrompt += `\n\n=== EXISTING PROJECT FILES ===\nThe following ${existingPaths.length} files ALREADY EXIST in your workspace. They are loaded and ready to read with read_file().\n${fileListBlock}\n=== END FILES ===\n`;

          /*
           * For edit mode, also inject content of key small files so the model
           * has immediate context without extra tool calls
           */
          if (isEditMode) {
            const SMALL_FILE_THRESHOLD = 50; // lines
            const keyFiles = [
              'package.json',
              'index.html',
              'src/App.jsx',
              'src/App.tsx',
              'src/main.jsx',
              'src/main.tsx',
              'vite.config.js',
              'vite.config.ts',
              'tailwind.config.js',
              'tailwind.config.ts',
            ];
            const smallKeyFiles = existingPaths
              .filter((p) => keyFiles.some((k) => p === k || p.endsWith('/' + k)))
              .filter((p) => (existingFiles[p]?.split('\n').length ?? 0) <= SMALL_FILE_THRESHOLD);

            if (smallKeyFiles.length > 0) {
              const contentBlock = smallKeyFiles
                .map((p) => {
                  const content = existingFiles[p] || '';
                  return `--- ${p} ---\n${content}`;
                })
                .join('\n\n');

              agentPrompt += `\n\n=== KEY FILE CONTENTS (for quick reference — use read_file for full content) ===\n${contentBlock}\n=== END KEY FILE CONTENTS ===\n`;
            }
          }
        }

        if (isEditMode) {
          /*
           * Conversation history: only injected as TEXT when the project has
           * no stored session (legacy projects). Session-backed projects get
           * the real prior messages via streamText({messages}) — injecting
           * the history again would duplicate it and bloat the prompt.
           */
          const editConvBlock =
            !hasSession && opts?.conversationHistory && opts.conversationHistory.length > 0
              ? `\n\nCONVERSATION HISTORY:\n${opts.conversationHistory
                  .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
                  .join('\n\n')}\n`
              : '';

          const fileList = existingPaths.length > 0 ? existingPaths.join(', ') : 'None found — check with list_files()';

          /*
           * STATE, not intent. The model is told what exists — nothing more.
           * What to DO with the request (answer / build / edit) is entirely
           * its judgment, per the system prompt. The old shouting guard
           * block ("DO NOT REBUILD", "NEVER ask_user", numbered workflow)
           * is gone: rails belong in the runtime, not in prose.
           */
          agentPrompt +=
            `${editConvBlock}\n\n` +
            `Project state: ${existingPaths.length} files exist in your workspace (${fileList}).\n`;
        }

        // Skills
        if (opts?.skills && opts.skills.length > 0) {
          const skillsBlock = opts.skills.map((s) => `• ${s.name}: ${s.instructions}`).join('\n');
          agentPrompt += `\n\n=== ACTIVE SKILLS (mandatory house rules — apply all of them) ===\n${skillsBlock}\n=== END SKILLS ===`;
        }

        /*
         * USER-UPLOADED IMAGES — the user attached images to their prompt.
         * The brain receives:
         *   1. A list of image module paths (e.g., src/assets/user-image-0.ts)
         *   2. Instruction to import and use these images in the project
         *
         * The brain should:
         *   - For bundler projects (React/Vue/Vite): `import userImage0 from './assets/user-image-0'` then `<img src={userImage0}>`
         *   - For static HTML: inline the data URL directly into `<img src="data:...">` (read the file to get the URL)
         *   - Use them as hero backgrounds, product photos, gallery images, avatars, etc.
         *   - NOT regenerate or replace them with AI-generated images
         *
         * The actual image modules are already in the workspace (the brain can
         * read_file to inspect them, or just import them directly).
         */
        if (opts?.userImages && opts.userImages.length > 0) {
          const imageList = opts.userImages
            .map(
              (img, i) =>
                `  - src/assets/user-image-${i}.ts (${img.mime}, ~${Math.round((img.dataUrl.length * 0.75) / 1024)}KB)`,
            )
            .join('\n');
          agentPrompt += `\n\n=== USER-UPLOADED IMAGES (the user attached these — USE THEM in the project) ===\nThe user uploaded ${opts.userImages.length} image(s) with their prompt. They are saved as ES modules in the workspace at:\n${imageList}\n\nUSAGE:\n- For React/Vue/Vite projects: \`import userImage0 from './assets/user-image-0'\` then \`<img src={userImage0} />\`\n- For static HTML projects: read_file('src/assets/user-image-0.ts') to get the data URL, then inline it: \`<img src="data:image/jpeg;base64,...">\`\n\nUse these images where they fit — as hero backgrounds, product photos, gallery images, avatars, etc. Do NOT regenerate or replace them with AI-generated images unless the user explicitly asks. If the user's prompt references "the photo I uploaded" or "my image", this is what they mean.\n=== END USER-UPLOADED IMAGES ===`;
        }

        // Design scheme
        if (opts?.designScheme) {
          const ds = opts.designScheme;
          const paletteLines = Object.entries(ds.palette)
            .map(([role, hex]) => `- ${role}: ${hex}`)
            .join('\n');
          const fontLine = ds.font.length > 0 ? ds.font.join(', ') : 'not specified';
          const featuresLine = ds.features.length > 0 ? ds.features.join(', ') : 'none specified';
          agentPrompt += `\n\n=== USER DESIGN SCHEME (MANDATORY — use these exact values) ===\nPALETTE:\n${paletteLines}\n\nFONTS: ${fontLine}\n\nDESIGN FEATURES: ${featuresLine}\n=== END USER DESIGN SCHEME ===`;
        }

        // Libraries
        if (opts?.libraries && opts.libraries.length > 0) {
          const libBlock = opts.libraries.map((l) => `--- ${l.name} (${l.kind}) ---\n${l.content}`).join('\n\n');
          agentPrompt += `\n\n=== REFERENCE LIBRARY (reusable material to draw on where relevant) ===\n${libBlock}\n=== END REFERENCE LIBRARY ===`;
        }
      }

      /*
       * The design brief handed to the Builder: the Planner's fresh output when
       * it ran (new project), otherwise the saved brief from a previous build
       * (edits) so the design stays consistent.
       */
      const activeBrief = existingBrief || '';
      const briefBlock = activeBrief
        ? `\n\n=== DESIGN & MEDIA BRIEF (your art direction — apply the design system and execute the media plan exactly) ===\n${activeBrief}\n=== END BRIEF ===`
        : '';

      /*
       * Edit mode: the Builder has preloaded files + worklog + conversation
       * history. Inject all of it so the agent understands WHAT to change
       * and WHY (references from prior messages). The agent uses read_file
       * to inspect, write_file/edit_file to modify, and run_shell to verify
       * the build — a full agent loop, not a single LLM call.
       */
      /*
       * Force-build retry: the previous Builder turn produced NO files (the
       * model reasoned but never called write_file). Override the prompt with a
       * blunt directive to act now. Takes precedence over the normal prompts.
       */
      if (verifyAndFinish) {
        const vfFiles = Object.keys(getProjectFiles(jobId) as Record<string, string>);
        agentPrompt = `${prompt}\n\n` +
          `CRITICAL: You have written ${vfFiles.length} files including entry points (src/main.jsx, src/App.jsx, index.html).\n` +
          `The project is COMPLETE. DO NOT write more files. DO NOT call list_files or read_file.\n` +
          `RIGHT NOW: call run_shell("npm install && npm run build") to verify the build.\n` +
          `If build passes, call done(). If build fails, read the error, fix the file, and rebuild.`;
        verifyAndFinish = false; // consumed
      } else if (forceBuild) {
        const existingFiles = Object.keys(getProjectFiles(jobId) as Record<string, string>);
        agentPrompt = incompleteBuild
          ? `${prompt}\n\n` +
            `CRITICAL: CONTINUATION — ${existingFiles.length} files already written:\n` +
            existingFiles.map(f => `  ✓ ${f}`).join('\n') + '\n\n' +
            `DO NOT rewrite these files. DO NOT call list_files or read_file. YOU ALREADY HAVE THE FILE LIST ABOVE.\n\n` +
            `WRITE THE REMAINING FILES NOW using write_files. Each file must be COMPLETE and LARGE:\n` +
            `- Components: 150-300+ lines with full JSX, state, effects, event handlers\n` +
            `- Backend routes: 100-200+ lines with full CRUD, validation, error handling\n` +
            `- Models: 80-150+ lines with all fields, methods, queries\n` +
            `- Do NOT write minimal/skeleton files. Write PRODUCTION-GRADE code.\n\n` +
            `After all files are written, run_shell("npm install && npm run build") to verify, then call done().`
          : `${prompt}\n\n` +
            `CRITICAL: You produced NO files on your last turn — you only planned. ` +
            `STOP planning and explaining. DO NOT call list_files or read_file. ` +
            `RIGHT NOW, use the write_files tool to create EVERY file the project needs. ` +
            `Start with: package.json, vite.config.js, tailwind.config.js, postcss.config.js, index.html, src/main.jsx, src/App.jsx, src/index.css.\n` +
            `Each file must be COMPLETE and LARGE (150-300+ lines for components, 100-200+ for routes). ` +
            `After all files are written, call done(). Do NOT describe the plan — build it with tool calls immediately.`;
        forceBuild = false; // consumed
        incompleteBuild = false; // consumed
      }

      logger.info(`[orchestrator] Running ${config.name} agent (maxSteps=${config.maxSteps})`);

      /*
       * Cancel check — between agent steps, poll the job's status in Supabase.
       * The front-end writes status='cancel_requested' when the user hits Stop.
       * If we see it, fire the AbortController (cancels the in-flight LLM
       * stream) and write a partial manifest from the files written so far,
       * then break out of the agent loop. The orchestrator's finally{} does
       * the rest (cleanup + unregister).
       *
       * Polling between agents (not mid-stream) is enough for UX — a single
       * agent step is 5-30s, so the cancel lands within that window. Mid-
       * stream polling would need abortSignal checks inside the for-await
       * loop (already handled by streamText's abortSignal).
       */
      const { data: cancelCheck } = await supabase
        .from('build_jobs')
        .select('status, error_summary')
        .eq('id', jobId)
        .single();

      /*
       * The front-end writes status='failed_clean' + error_summary='Cancelled
       * by user' when the user hits Stop (the DB's CHECK constraint only
       * allows pending/generating/ready_for_preview/failed_clean — no
       * 'cancelled' or 'cancel_requested'). We detect a user cancel by the
       * error_summary tag.
       */
      if (cancelCheck?.status === 'failed_clean' && cancelCheck?.error_summary === 'Cancelled by user') {
        logger.info(`[orchestrator] Job ${jobId} cancelled by user — aborting before ${config.name} agent`);
        await emitEvent(supabase, jobId, 'job_failed', 'Build cancelled by user — saving partial state...');
        abortController.abort();

        /*
         * Write partial manifest immediately (don't wait for finally{} — the
         * file map is still populated here).
         */
        await finalizePartial();

        overallSuccess = false;
        break;
      }

      // Emit agent_started — lets the activity stream UI open a new group for this agent.
      await emitEvent(supabase, jobId, 'agent_started', `🤖 ${config.name} agent starting...`, {
        agent: config.name,
        role,
      });

      const agentStart = Date.now();

      /*
       * Token budget per step.
       *
       * The old code did Math.min(config.maxTokens, maxCompletionTokens ?? config.maxTokens)
       * — which means if maxCompletionTokens was undefined (model didn't expose it),
       * we got config.maxTokens (was 12000). And if maxCompletionTokens WAS set
       * (e.g. 65536 for GLM-5.2), we still got Math.min(32000, 65536) = 32000.
       * Either way, large models were capped at the registry floor.
       *
       * The fix: prefer maxCompletionTokens (the model's actual limit). Only fall
       * back to config.maxTokens when it's missing. Never Math.min — the registry
       * floor is already conservative.
       */
      const stepMaxTokens = Math.max(maxCompletionTokens ?? config.maxTokens, 32000);

      /*
       * providerOptions for OpenRouter reasoning support.
       *
       * OpenRouter's API accepts `reasoning: { enabled: true }` in the request
       * body. For models that support reasoning (DeepSeek-R1, GLM-4.7+,
       * Claude thinking, o1/o3, etc.), this makes the model emit reasoning
       * tokens alongside regular text. For models that don't support it,
       * OpenRouter silently ignores the parameter — so it's always safe to
       * pass.
       *
       * We always pass it for OpenRouter (no regex check) because:
       * 1. OpenRouter itself decides whether to use it based on model capability
       * 2. Even GLM-4.7 supports reasoning — the old regex missed it
       * 3. Harmless for non-reasoning models
       */
      /*
       * Thinking control now lives in the MODEL ITSELF: the job processor
       * bakes reasoningEffort into getModelInstance() (the official
       * OpenRouter provider takes it at construction). The old
       * providerOptions.openrouter path was silently ignored by the
       * previous adapter — the setting never reached the request.
       */

      /*
       * STREAMING — use streamText (not generateText) so the LLM's text and
       * reasoning tokens arrive as live delta chunks. This is what makes the
       * "Thought Process" panel stream in real-time, exactly like Claude Code
       * / Cursor / Super Z.
       *
       * We iterate result.fullStream to consume every chunk:
       *   - text-delta  → the model's regular text output (narration between
       *                   tool calls). This IS the reasoning the user sees.
       *   - reasoning   → dedicated reasoning tokens (for models that support
       *                   a separate reasoning channel, e.g. DeepSeek-R1).
       *   - tool-call   → the model is requesting a tool execution. We emit
       *                   a tool-specific event for tools that don't emit
       *                   their own (read_file, run_shell, etc.). Tools that
       *                   DO emit their own (write_file, update_todos, done)
       *                   are skipped here to avoid duplication.
       *   - step-finish → a step boundary. Flush the text buffer and increment
       *                   the stepId so the next text-delta starts a new
       *                   reasoning entry in the client UI.
       *   - finish      → the entire stream is done. Capture finishReason.
       *   - error       → stream error. Log and rethrow.
       *
       * The text buffer is flushed every 500ms (or on step-finish / tool-call)
       * so the user sees live streaming without flooding the event system.
       */
      let stepId = 0;
      let textBuffer = ''; // narration — the model's spoken text
      let thinkBuffer = ''; // thinking — reasoning tokens (S2 channel split)
      let lastFlushTime = Date.now();

      /*
       * Reasoning aggregation. Each flush writes ONE job_events row, so flushing
       * on every 500ms delta produced a swarm of tiny rows for a single continuous
       * thought (observed: ~8 rows / ~10-char fragments for one narration) — costly
       * (DB inserts + Realtime messages + poll payload) and choppy.
       *
       * Now we COALESCE a contiguous reasoning run: buffer deltas and flush only
       * when the chunk gets sizeable (FLUSH_CHARS) OR a longer interval passes
       * (FLUSH_INTERVAL_MS) OR a real boundary hits (tool-call / step-finish /
       * finish, which call flushText directly). Short narrations become a single
       * row; long "thinking" still streams periodically so it never looks frozen.
       * The client concatenates fragments unchanged, so the rendered text is
       * identical — just far fewer rows.
       */
      const FLUSH_INTERVAL_MS = 2000;
      const FLUSH_CHARS = 700;

      /*
       * S2 CHANNEL SPLIT — thinking and narration flush as SEPARATE durable
       * rows, each tagged payload.channel, so the UI renders reasoning as a
       * dim collapsible "Thinking" block and narration as the reply text.
       * The live layer gets the same split via sendDelta's channel.
       */
      const flushChannel = async (channel: 'thinking' | 'narration', isFinal: boolean) => {
        const text = channel === 'thinking' ? thinkBuffer : textBuffer;

        if (text.length === 0) {
          return;
        }

        if (channel === 'thinking') {
          thinkBuffer = '';
        } else {
          textBuffer = '';
        }

        lastFlushTime = Date.now();

        try {
          await emitEvent(
            supabase,
            jobId,
            'reasoning',
            `${config.name}: ${text.slice(0, 180)}${text.length > 180 ? '…' : ''}`,
            {
              agent: config.name,
              role,
              text,
              stepId,
              isFinal,
              channel,
            },
          );
        } catch {
          /* best-effort */
        }
      };

      const flushText = async (isFinal: boolean) => {
        await flushChannel('thinking', isFinal);
        await flushChannel('narration', isFinal);
      };

      /* Flush only when a buffer is big enough or the interval elapsed. */
      const maybeFlush = async () => {
        const pending = textBuffer.length + thinkBuffer.length;

        if (
          thinkBuffer.length >= FLUSH_CHARS ||
          textBuffer.length >= FLUSH_CHARS ||
          (pending > 0 && Date.now() - lastFlushTime > FLUSH_INTERVAL_MS)
        ) {
          await flushChannel('thinking', false);
          await flushChannel('narration', false);
        }
      };

      /*
       * Tools that emit their OWN events from inside their execute() function.
       * We do NOT emit orchestrator-level events for these to avoid duplication.
       * Tools NOT in this set get an orchestrator-level event on tool-call.
       */
      const SELF_EMITTING_TOOLS = new Set([
        'write_file',
        'write_files',
        'edit_file',
        'delete_file',
        'update_todos',
        'done',
        'ask_user',
        'analyze_screenshot',
        'generate_video',
        'generate_image',
      ]);

      const emitToolEvent = async (toolName: string, args: any) => {
        try {
          if (toolName === 'read_file') {
            await emitEvent(supabase, jobId, 'file_chunk', `📖 [${config.name}] Read: ${args.path}`, {
              agent: config.name,
              kind: 'read',
              path: args.path,
            });
          } else if (toolName === 'search_code') {
            await emitEvent(supabase, jobId, 'file_chunk', `🔍 [${config.name}] Search: ${args.pattern}`, {
              agent: config.name,
              kind: 'search',
              pattern: args.pattern,
            });
          } else if (toolName === 'list_files') {
            await emitEvent(supabase, jobId, 'file_chunk', `📋 [${config.name}] List files`, {
              agent: config.name,
              kind: 'list',
            });
          } else if (toolName === 'list_uploads') {
            await emitEvent(supabase, jobId, 'file_chunk', `📤 [${config.name}] List uploads`, {
              agent: config.name,
              kind: 'list_uploads',
            });
          } else if (toolName === 'run_shell') {
            await emitEvent(supabase, jobId, 'file_chunk', `⚡ [${config.name}] Run: ${args.command?.slice(0, 80)}`, {
              agent: config.name,
              kind: 'shell',
              command: args.command,
            });
          } else if (toolName === 'run_tests') {
            await emitEvent(supabase, jobId, 'file_chunk', `🧪 [${config.name}] Run tests`, {
              agent: config.name,
              kind: 'tests',
            });
          } else if (toolName === 'take_screenshot') {
            await emitEvent(supabase, jobId, 'file_chunk', `📸 [${config.name}] Screenshot`, {
              agent: config.name,
              kind: 'screenshot',
            });
          }
        } catch {
          /* best-effort */
        }
      };

      /*
       * Model Router: each agent can run on its own model — the brain
       * (orchestrator/researcher) on the smartest one, builders on a fast
       * coder, the tester on a checker. Falls back to the main model.
       */
      const agentModel = opts?.agentModels?.brain ?? model;

      /*
       * ── PRE-FLIGHT TOKEN ESTIMATION ──────────────────────────────────
       * Estimate input tokens BEFORE calling the LLM so we can fail early
       * when the prompt is clearly too large for the model's context window.
       * For the brain, the stored session messages are part of the request.
       */
      const sessionTokens = role === 'brain' ? estimateSessionTokens(session.messages) : 0;
      const estimatedInputTokens = Math.ceil((config.systemPrompt.length + agentPrompt.length) / 4) + sessionTokens;
      const warnThreshold = Math.floor(effectiveContextWindow * 0.8);
      const failThreshold = Math.floor(effectiveContextWindow * 0.95);

      if (estimatedInputTokens > failThreshold) {
        const msg =
          `Your prompt is too large for this model's context window ` +
          `(estimated ${estimatedInputTokens.toLocaleString()} tokens vs ${effectiveContextWindow.toLocaleString()} limit). ` +
          `Please use a model with a larger context, shorten your prompt, or continue in a fresh chat.`;
        logger.error(`[orchestrator] Pre-flight token check FAILED: ${msg}`);
        await emitEvent(supabase, jobId, 'file_chunk', `❌ ${msg}`, {
          agent: config.name,
          kind: 'context_overflow_preflight',
          estimatedTokens: estimatedInputTokens,
          contextWindow: effectiveContextWindow,
        });
        throw new Error(msg);
      } else if (estimatedInputTokens > warnThreshold) {
        logger.warn(
          `[orchestrator] Pre-flight token warning: estimated ${estimatedInputTokens} tokens (${Math.round((estimatedInputTokens / effectiveContextWindow) * 100)}% of ${effectiveContextWindow} window)`,
        );
        await emitEvent(
          supabase,
          jobId,
          'file_chunk',
          `⚠️ Prompt is large (~${estimatedInputTokens.toLocaleString()} tokens, ${Math.round((estimatedInputTokens / effectiveContextWindow) * 100)}% of context window). Build may fail or produce incomplete results. Consider using a model with a larger context or starting a fresh chat.`,
          {
            agent: config.name,
            kind: 'context_pressure_warning',
            estimatedTokens: estimatedInputTokens,
            contextWindow: effectiveContextWindow,
          },
        );
      }

      /*
       * GUARANTEED FIRST EVENT — always emit before the LLM call so the user
       * sees activity even if the provider is slow or the prompt is huge.
       */
      const promptChars = agentPrompt.length;
      const estimatedTokens = Math.ceil(promptChars / 4);
      await emitEvent(
        supabase,
        jobId,
        'file_chunk',
        `🧠 ${config.name} is processing your request (${(promptChars / 1024).toFixed(1)}KB, ~${estimatedTokens} tokens)...`,
        { agent: config.name, kind: 'agent_thinking', promptSize: promptChars, estimatedTokens },
      );

      /*
       * SESSION-BASED LOOP (brain only). The brain runs on the project's
       * full message history + this build's user message — real conversation
       * continuity, like a coding-agent CLI session. Other roles (planner,
       * tester, legacy builder) stay prompt-based: they are single-purpose
       * passes with no cross-turn memory.
       */
      const brainMessages =
        role === 'brain'
          ? ([...session.messages, { role: 'user', content: agentPrompt }] as SessionMessage[])
          : undefined;

      /*
       * Per-ATTEMPT abort controller. The job-level abortController (hard
       * timeout + user cancel) used to be passed straight to streamText —
       * but then a stall/loop abort of one attempt poisoned every retry
       * (the shared signal stays aborted forever). Now each attempt gets
       * its own controller; job-level aborts propagate into it.
       */
      const attemptController = new AbortController();
      const onJobAbort = () => attemptController.abort();

      if (abortController.signal.aborted) {
        attemptController.abort();
      }

      abortController.signal.addEventListener('abort', onJobAbort);

      const streamResult = streamText({
        model: agentModel,
        system: config.systemPrompt,
        ...(brainMessages ? { messages: brainMessages as any } : { prompt: agentPrompt }),
        tools: agentTools,
        maxSteps: config.maxSteps,

        /*
         * Deterministic tool-call repair (see repairStringifiedArgs above).
         * Fires only on InvalidToolArgumentsError; null = not repairable,
         * original error propagates.
         */
        experimental_repairToolCall: async ({ toolCall, error }) => {
          if ((error as any)?.name === 'NoSuchToolError') {
            return null;
          }

          // First: try unstringifying stringified JSON args (GLM habit).
          const repaired = repairStringifiedArgs(toolCall.args);

          if (repaired !== null) {
            logger.warn(
              `[orchestrator] Repaired stringified args for tool ${toolCall.toolName} (${toolCall.args.length} → ${repaired.length} chars)`,
            );

            return { ...toolCall, args: repaired };
          }

          /*
           * Second: structural repair for write_files. GLM-4.x often calls
           * write_files with a SINGLE file object as the top-level args
           *   {"path":"App.jsx","content":"..."}
           * instead of the required shape
           *   {"files":[{"path":"App.jsx","content":"..."}]}
           * The Zod schema rejects this ("files: expected nonoptional,
           * received undefined"). Wrap the stray object in a `files` array
           * so the tool can proceed. Observed live on multiple builds.
           */
          if (toolCall.toolName === 'write_files') {
            try {
              const parsed = JSON.parse(toolCall.args);

              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !('files' in parsed)) {
                // Looks like a single file object (has path/content) or an
                // array of file objects placed at the top level.
                const wrapped = Array.isArray(parsed) ? { files: parsed } : { files: [parsed] };
                const wrappedJson = JSON.stringify(wrapped);

                logger.warn(
                  `[orchestrator] Structural repair for write_files: wrapped top-level object in files[] array`,
                );

                return { ...toolCall, args: wrappedJson };
              }
            } catch {
              // not JSON — fall through
            }
          }

          /*
           * ═══════════════════════════════════════════════════════════════════
           * DEEP REPAIR #3: extract code from RAW args when JSON.parse fails.
           *
           * ROOT CAUSE (confirmed via Supabase job_events on edit job
           * 21b17abb): GLM-4.7 generates the correct file content in its
           * reasoning stream, but the write_file tool-call args arrive as
           * MALFORMED JSON — the content string contains unescaped newlines,
           * quotes, or backticks that break JSON.parse. The model then loops:
           *   "I keep making the same mistake" (30+ times)
           *   → never reaches write_file → auto-repair never fires → build stalls.
           *
           * FIX: instead of giving up when JSON.parse fails, scan the RAW args
           * string for code-block fences (```jsx\n...```) or for path/content
           * pairs using regex. Reconstruct valid JSON from what we found.
           * This is the DEFINITIVE fix — it works even when the model's JSON
           * is completely unparseable, because the code itself is still in
           * the raw text.
           * ═══════════════════════════════════════════════════════════════════
           */
          if (toolCall.toolName === 'write_file' || toolCall.toolName === 'write_files') {
            const rawArgs = toolCall.args;

            // Try to extract a path from the raw args (even if JSON is broken)
            const pathMatch = rawArgs.match(/"path"\s*:\s*"([^"]+)"/);
            if (pathMatch) {
              const filePath = pathMatch[1];

              // Strategy A: look for code-block fences in the raw args
              const fenceMatch = rawArgs.match(/```(?:[a-z]*)\n?([\s\S]*?)```/);
              if (fenceMatch && fenceMatch[1] && fenceMatch[1].trim().length > 10) {
                const code = fenceMatch[1].trim();
                const repairedJson = JSON.stringify({ path: filePath, content: code });

                logger.warn(
                  `[orchestrator] DEEP REPAIR: extracted code from fence in write_file args (path=${filePath}, ${code.length} chars)`,
                );

                return { ...toolCall, args: repairedJson };
              }

              // Strategy B: look for "content":"..." even in broken JSON
              // (grab everything between "content":" and the next unescaped ")
              const contentMatch = rawArgs.match(/"content"\s*:\s*"([\s\S]*?)(?<!\\)"/);
              if (contentMatch && contentMatch[1] && contentMatch[1].length > 5) {
                // Unescape the captured content
                let code = contentMatch[1]
                  .replace(/\\n/g, '\n')
                  .replace(/\\t/g, '\t')
                  .replace(/\\"/g, '"')
                  .replace(/\\\\/g, '\\');

                const repairedJson = JSON.stringify({ path: filePath, content: code });

                logger.warn(
                  `[orchestrator] DEEP REPAIR: extracted content from broken JSON in write_file args (path=${filePath}, ${code.length} chars)`,
                );

                return { ...toolCall, args: repairedJson };
              }
            }

            // Strategy C: for write_files, try to find MULTIPLE path/content pairs
            if (toolCall.toolName === 'write_files') {
              const files: Array<{ path: string; content: string }> = [];
              const fileRegex = /"path"\s*:\s*"([^"]+)"[\s\S]*?"content"\s*:\s*"([\s\S]*?)(?<!\\)"/g;
              let m;
              while ((m = fileRegex.exec(rawArgs)) !== null) {
                const fp = m[1];
                let code = m[2]
                  .replace(/\\n/g, '\n')
                  .replace(/\\t/g, '\t')
                  .replace(/\\"/g, '"')
                  .replace(/\\\\/g, '\\');
                if (code.length > 5) files.push({ path: fp, content: code });
              }
              if (files.length > 0) {
                const repairedJson = JSON.stringify({ files });

                logger.warn(
                  `[orchestrator] DEEP REPAIR: extracted ${files.length} files from broken write_files args`,
                );

                return { ...toolCall, args: repairedJson };
              }
            }
          }

          return null;
        },
        temperature: 0.3, // Low temperature for consistent code generation (was 0.7 — too random)
        maxTokens: stepMaxTokens,

        /*
         * abortSignal — when abortController.abort() fires (either from the
         * 15-min hard timeout OR from the loop-detection below), streamText
         * cancels the underlying fetch() to the LLM provider. The fullStream
         * iterator then throws an AbortError which we catch below and convert
         * to a clean job failure.
         *
         * Without this signal, the stream would hang forever waiting for
         * chunks from a provider that's not sending any.
         */
        abortSignal: attemptController.signal,
      });

      let streamError: Error | null = null;

      /*
       * STALL WATCHDOG — observed twice in production (735s and 901s of
       * total silence): the provider accepts the request, maybe delivers a
       * first tool call, then the stream emits NOTHING until the 15-min
       * hard timeout kills the whole job. Track the last chunk arrival; if
       * no chunk lands for STALL_TIMEOUT_MS, abort THIS ATTEMPT ONLY (the
       * per-attempt controller below) so the normal retry path re-runs the
       * agent instead of failing the build.
       *
       * 400s threshold: chunks pause legitimately while a tool executes
       * (npm install is capped at 300s in the E2B runner) — the watchdog
       * must outlast the slowest tool, not race it.
       */
      /*
       * 180s (was 400s): with the S1 root fix, thinking tokens stream
       * continuously, so a genuinely silent stream is now measurable —
       * only long tool executions (npm install ≤300s) pause chunks, and
       * those arrive as tool-call/tool-result boundaries around the gap.
       * Kept above the typical install by resetting on tool parts too
       * (every fullStream part refreshes lastChunkAt).
       */
      const STALL_TIMEOUT_MS = 600_000; // 10 min — model generates large write_files calls (12+ files, 50KB+) without streaming intermediate chunks. AI SDK buffers tool-call args.
      let lastChunkAt = Date.now();
      let stalled = false;
      let toolExecuting = false; // true while a tool (esp. spawn_subagent) runs — pauses stall watchdog

      /*
       * TOOL-CALL WATCHDOG — the REAL fix for "model thinks forever without acting".
       *
       * PROBLEM: GLM-4.7 enters deep reasoning loops, producing reasoning tokens
       * continuously. The stall watchdog never fires because chunks ARE arriving
       * (lastChunkAt refreshes on every part). But no tool calls happen — the
       * model just thinks and thinks without writing files.
       *
       * FIX: Track lastToolCallAt. If no tool call happens within 3 min (even
       * with reasoning flowing), abort and force a phase boundary. The model
       * gets a fresh context with "STOP planning, WRITE files NOW".
       *
       * This is the key difference from the stall watchdog:
       * - Stall watchdog: catches SILENT streams (no chunks at all)
       * - Tool-call watchdog: catches ACTIVE-but-unproductive streams (reasoning
       *   without action)
       */
      const TOOL_CALL_TIMEOUT_MS = 600_000; // 10 min — reasoning is off, so model streams continuously
      let lastToolCallAt = Date.now();

      const stallTimer = setInterval(() => {
        // Stall watchdog: catches SILENT streams (no chunks at all)
        // Only pause for long-running tools (sub-agents, shell)
        if (!toolExecuting && Date.now() - lastChunkAt > STALL_TIMEOUT_MS) {
          stalled = true;
          logger.warn(
            `[orchestrator] ${config.name} stream stalled (${STALL_TIMEOUT_MS / 1000}s without a chunk) — aborting this attempt for retry`,
          );
          attemptController.abort();
          clearInterval(stallTimer);
          return;
        }

        // Tool-call watchdog: catches ACTIVE-but-unproductive streams
        // (reasoning flowing but no productive tool calls for 5 min)
        // This fires EVEN IF toolExecuting is true — because a tool
        // that's been "executing" for 8+ min without producing files
        // is stuck (e.g., spawn_subagent that's hanging).
        // EXCEPTION: spawn_subagent has its OWN 8-min timeout internally,
        // so we give it 9 min here (8 min sub-agent + 1 min buffer).
        // Also fires when model reasons without calling ANY tools.
        const effectiveToolTimeout = toolExecuting ? 600_000 : TOOL_CALL_TIMEOUT_MS; // 10 min if tool executing (npm install), 10 min otherwise
        if (Date.now() - lastToolCallAt > effectiveToolTimeout) {
          stalled = true;
          logger.warn(
            `[orchestrator] ${config.name} ${toolExecuting ? 'tool executing too long' : 'reasoning without action'} (${effectiveToolTimeout / 1000}s) — aborting for phase boundary`,
          );
          attemptController.abort();
          clearInterval(stallTimer);
        }
      }, 15_000);

      try {
        for await (const part of streamResult.fullStream) {
          lastChunkAt = Date.now();

          switch (part.type) {
            /*
             * text-delta — the model's regular text output.
             * For tool-using models, this is the narration between tool calls
             * ("Let me create the App.tsx file now..."). This IS the reasoning
             * the user wants to see streaming live.
             */
            case 'text-delta': {
              textBuffer += part.textDelta;
              sendDelta(jobId, part.textDelta, 'narration'); // instant live layer (fire-and-forget)
              await maybeFlush();

              break;
            }

            /*
             * reasoning — dedicated reasoning tokens (separate from text).
             * Models like DeepSeek-R1 emit these via a special channel.
             * We treat them the same as text-delta — both go into the
             * Thought Process panel.
             */
            case 'reasoning': {
              // S1 root fix made these flow (94% of a thinking model's output).
              thinkBuffer += part.textDelta;
              sendDelta(jobId, part.textDelta, 'thinking');
              await maybeFlush();

              break;
            }

            /*
             * tool-call — the model is requesting a tool execution.
             * Flush any accumulated text first (closes the current reasoning
             * bubble), then emit a tool-specific event for tools that don't
             * emit their own.
             *
             * Note: the tool's execute() function runs AFTER this part
             * (during the tool-result phase). Tools that emit their own
             * events (write_file, update_todos, etc.) will fire their events
             * during execution — we don't duplicate them here.
             */
            case 'tool-call': {
              // Only pause watchdog for LONG-RUNNING tools (sub-agent, shell).
              // File writes/reads/edits complete in <1s — no need to pause.
              // This was the bug: toolExecuting stayed true for update_todos,
              // blocking the watchdog while the model reasoned endlessly.
              const isLongRunning = ['spawn_subagent', 'run_shell', 'run_tests', 'analyze_screenshot', 'generate_image', 'generate_video'].includes(part.toolName);
              if (isLongRunning) {
                toolExecuting = true;
              }
              // Reset tool-call watchdog for PRODUCTIVE tools only
              if (['write_file', 'write_files', 'edit_file', 'edit_files', 'spawn_subagent'].includes(part.toolName)) {
                lastToolCallAt = Date.now();
              }
              await flushText(true);

              /*
               * M2: broadcast a live "tool started" chip. Details stay short
               * and human: file path(s), the command, or the tool name.
               */
              try {
                const a: any = part.args ?? {};
                let detail: string | undefined;

                if (part.toolName === 'write_file' || part.toolName === 'edit_file' || part.toolName === 'read_file') {
                  detail = a.path;
                } else if (part.toolName === 'write_files') {
                  let batchArg = a.files;

                  if (typeof batchArg === 'string') {
                    try {
                      batchArg = JSON.parse(batchArg);
                    } catch {
                      batchArg = [];
                    }
                  }

                  const n = Array.isArray(batchArg) ? batchArg.length : 0;
                  detail = `${n} files`;
                } else if (part.toolName === 'run_shell') {
                  detail = String(a.command ?? '').slice(0, 80);
                }

                sendTool(jobId, part.toolName, detail);
              } catch {
                /* live layer is best-effort */
              }

              /*
               * LOOP DETECTION — catch the case where the LLM is stuck
               * rewriting the same file over and over (observed with GLM-4.7:
               * it wrote App.tsx, read it, then rewrote it 11 chars shorter,
               * then hung). Without this, the build runs forever until the
               * 15-min hard timeout.
               *
               * Track write_file/edit_file calls per path. If the same path
               * is written 4+ times, abort the stream and fail the job —
               * the LLM is in a loop it can't escape.
               */
              /*
               * write_files (batch) counts each contained path — a model that
               * keeps re-shipping the same batch is looping just as surely as
               * one rewriting a single file.
               */
              if (part.toolName === 'write_files') {
                let batch = (part.args as any)?.files as unknown;

                // GLM models may pass the array as a JSON string — parse for counting.
                if (typeof batch === 'string') {
                  try {
                    batch = JSON.parse(batch);
                  } catch {
                    batch = [];
                  }
                }

                for (const f of (Array.isArray(batch) ? batch : []) as Array<{ path?: string }>) {
                  if (f?.path) {
                    fileWriteCounts.set(f.path, (fileWriteCounts.get(f.path) ?? 0) + 1);
                  }
                }
              }

              if (part.toolName === 'write_file' || part.toolName === 'edit_file') {
                const filePath = (part.args as any)?.path as string | undefined;

                if (filePath) {
                  fileWriteCounts.set(filePath, (fileWriteCounts.get(filePath) ?? 0) + 1);

                  const writes = fileWriteCounts.get(filePath)!;

                  /*
                   * LOOP BACKSTOP (very high threshold — trust the model).
                   *
                   * The old thresholds (8-10) killed legitimate work: a model
                   * making 12 targeted edits to one file, or rewriting a file
                   * 9 times during a complex refactor, would get aborted mid-
                   * build. Z.ai Code does NOT have loop detection at all — the
                   * model self-corrects because it reads its own output.
                   *
                   * We keep a SAFETY NET at 40 writes to the same file — this
                   * is only hit by a truly stuck model (40 rewrites of the same
                   * file is never legitimate). At that point we salvage. Normal
                   * builds, even complex 40-file projects, never approach this.
                   */
                  const LOOP_ABORT_AT = 40;

                  if (writes >= LOOP_ABORT_AT) {
                    logger.warn(
                      `[orchestrator] ${config.name} wrote ${filePath} ${writes}× — stopping this agent and salvaging the files built so far.`,
                    );

                    /*
                     * Silent: don't emit a user-visible error. The build continues
                     * with the files already written. The brain will call done()
                     * or the orchestrator will finalize with what's available.
                     */
                    attemptController.abort();
                    break;
                  }
                }
              }

              if (!SELF_EMITTING_TOOLS.has(part.toolName)) {
                await emitToolEvent(part.toolName, part.args);
              }

              break;
            }

            /*
             * step-finish — a step boundary (one LLM call + tool executions
             * completed). Flush remaining text and increment stepId so the
             * next text-delta starts a fresh reasoning entry in the client.
             */
            case 'step-finish': {
              toolExecuting = false; // resume stall watchdog — all tools in this step done
              await flushText(true);
              sendStep(jobId); // M2: close the live text segment
              stepId++;
              break;
            }

            /*
             * finish — the entire stream is done (all steps completed).
             * Flush any remaining text.
             */
            case 'finish': {
              await flushText(true);
              break;
            }

            /*
             * error — the stream encountered an error. Capture it and break
             * out of the loop. We rethrow after the loop so the outer
             * try/catch can handle it.
             */
            case 'error': {
              const errStr = String(part.error);
              const errStack = part.error instanceof Error ? part.error.stack : '';
              logger.error(
                `[orchestrator] Stream error in ${config.name}: ${errStr}${errStack ? '\n' + errStack : ''}`,
              );
              streamError = part.error instanceof Error ? part.error : new Error(errStr);
              break;
            }

            default:
              /*
               * Other part types (tool-call-streaming-start, tool-call-delta,
               * step-start, source, file, reasoning-signature,
               * redacted-reasoning) — not relevant to event emission.
               */
              break;
          }

          if (streamError) {
            break;
          }
        }
      } catch (streamErr) {
        clearInterval(stallTimer);
        abortController.signal.removeEventListener('abort', onJobAbort);

        /*
         * Distinguish AbortError (triggered by our hard timeout or loop
         * detection) from other stream errors. For AbortError, we don't
         * rethrow — the agent loop should just stop and we report a clean
         * failure to the user. For other errors, rethrow so the outer
         * catch can fail the job.
         */
        const errName = (streamErr as any)?.name ?? '';
        const isAbort =
          errName === 'AbortError' ||
          errName === 'AbortError2' ||
          /abort/i.test(String((streamErr as any)?.message ?? ''));

        if (isAbort) {
          /*
           * STALL RETRY — this attempt was aborted by the stall watchdog
           * (provider went silent), NOT by the job-level hard timeout or a
           * user cancel. The build deserves a fresh attempt: re-queue the
           * same agent and continue, exactly like the flaky-provider retry.
           */
          if (stalled && !abortController.signal.aborted && builderEmptyRetries < MAX_BUILDER_EMPTY_RETRIES) {
            clearInterval(stallTimer);
            abortController.signal.removeEventListener('abort', onJobAbort);
            builderEmptyRetries++;
            logger.warn(
              `[orchestrator] ${config.name} stalled — retrying (attempt ${builderEmptyRetries}/${MAX_BUILDER_EMPTY_RETRIES})`,
            );

            /*
             * STALL RECOVERY: inject the list of already-written files so the
             * model CONTINUES from where it left off instead of restarting.
             * Without this, the model re-plans from scratch and stalls again
             * at the same point (observed on 40+ file builds).
             */
            const existingFiles = Object.keys(getProjectFiles(jobId) as Record<string, string>);
            if (existingFiles.length > 0) {
              forceBuild = true; // signal to the prompt builder to inject continuation context
              incompleteBuild = true;
              logger.info(
                `[orchestrator] Stall retry ${builderEmptyRetries}: ${existingFiles.length} files already written — model will continue from here`,
              );
            }

            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `🔁 The model went silent for ${Math.round(STALL_TIMEOUT_MS / 1000)}s — restarting with ${existingFiles.length} files already saved (attempt ${builderEmptyRetries}/${MAX_BUILDER_EMPTY_RETRIES})…`,
              { reason: 'stall_retry', attempt: builderEmptyRetries, existingFiles: existingFiles.length },
            ).catch(() => undefined);
            agentResults.push({ role, success: false, text: '', duration: Date.now() - agentStart });
            agentQueue.unshift(role);
            continue;
          }

          logger.warn(`[orchestrator] Stream aborted for ${config.name} (timeout or loop detection)`);

          /*
           * Preserve session continuity even on aborted turns: record the
           * user message + a synthetic note so the NEXT turn still knows this
           * exchange happened (the files it produced are in the workspace).
           * Without this, an aborted-but-salvaged edit leaves a hole in the
           * session (observed on job a1ac463b).
           */
          if (role === 'brain') {
            const abortedFiles = Object.keys(getProjectFiles(jobId) as Record<string, string>);
            await appendToSession(
              projectId,
              session.messages,
              session.turns,
              [
                { role: 'user', content: agentPrompt },
                {
                  role: 'assistant',
                  content: `(This turn was cut short by a safety limit, but the work landed: the workspace now has ${abortedFiles.length} files — ${abortedFiles.slice(0, 12).join(', ')}. Use read_file to inspect current contents.)`,
                },
              ],
              supabase,
              userId,
            ).catch(() => undefined);
          }

          /*
           * Tell the user honestly — a silent abort used to masquerade as a
           * normal completion ("Build complete" with missing files).
           */
          await emitEvent(
            supabase,
            jobId,
            'file_chunk',
            `⏱️ ${config.name} hit the build time limit and was stopped — checking what was completed…`,
            { agent: config.name, kind: 'agent_aborted' },
          ).catch(() => undefined);

          /*
           * Don't rethrow — just stop this agent's loop.
           * The job_processor will see 0 files and fail the job cleanly.
           */
          streamError = null;

          // Mark this agent as failed in results so the failure path triggers
          agentResults.push({
            role,
            success: false,
            text: '',
            duration: Date.now() - agentStart,
          });
          break; // exit the for-await loop
        }

        streamError = streamErr instanceof Error ? streamErr : new Error(String(streamErr));
      }

      // Normal completion path — stop the watchdog and detach the propagator.
      clearInterval(stallTimer);
      abortController.signal.removeEventListener('abort', onJobAbort);

      if (streamError) {
        // CONTEXT OVERFLOW — never retry, fail immediately with clear message
        const isContextOverflow =
          /context_length|too many tokens|token limit|input too large|max.?token|prompt too long|exceeds.*context/i.test(
            streamError.message,
          );

        if (isContextOverflow) {
          logger.error(`[orchestrator] Context overflow detected: ${streamError.message.slice(0, 200)}`);
          await emitEvent(
            supabase,
            jobId,
            'file_chunk',
            `❌ Your prompt is too large for this model's context window. The system prompt + your request + project context exceeds the limit. ` +
              `Please: (1) shorten your prompt, (2) use a model with a larger context (128K+), or (3) start a fresh chat. ` +
              `Error: ${streamError.message.slice(0, 200)}`,
            { kind: 'context_overflow', error: streamError.message.slice(0, 500) },
          );
          throw streamError; // Don't retry context overflow errors
        }

        /*
         * A Builder/Brain that ERRORED (flaky provider / bad tool-call — seen
         * with GLM-4.7, GLM-5.2) must not kill the whole build if we can still
         * retry. Previously this only checked role === 'builder' — but with
         * DEFAULT_AGENT_FLOW = ['brain'], the brain IS the builder. Now we
         * also cover 'brain' role.
         *
         * Also: the old check required 0 files written. But a flaky model may
         * write 2-3 config files BEFORE erroring. If it wrote partial files,
         * we should still retry (the retry gate below will check if entry
         * points are missing and re-prompt if needed). Only skip retry if the
         * error is clearly unrecoverable (auth failure).
         */
        const isRecoverable =
          !streamError.message.includes('401') &&
          !streamError.message.includes('authentication') &&
          !streamError.message.includes('API key');

        const canRetry = builderEmptyRetries < MAX_BUILDER_EMPTY_RETRIES && isRecoverable;

        /*
         * SALVAGE GATE — a late tool-argument error (e.g. a malformed
         * analyze_screenshot call AFTER the app was written and verified)
         * must never kill a finished build. If the workspace already holds
         * files AND the last real build command passed, accept the build
         * with a note instead of retrying/failing. Observed live on job
         * 88bdfbd4: app built, `npm run build` exit 0, then a broken
         * screenshot call failed the whole job three times in a row.
         */
        {
          const salvageFiles = getProjectFiles(jobId) as Record<string, string>;
          const salvageCount = Object.keys(salvageFiles).length;
          const salvageBuild = getBuildResult(jobId);

          if (salvageCount > 0 && salvageBuild?.passed) {
            logger.warn(
              `[orchestrator] ${config.name} errored late (${streamError.message.slice(0, 120)}) but the build already passed with ${salvageCount} files — salvaging as success.`,
            );
            await emitEvent(
              supabase,
              jobId,
              'file_chunk',
              `✅ Build completed and verified (${salvageCount} files). A non-essential final step failed and was skipped.`,
              { kind: 'salvaged_success', error: streamError.message.slice(0, 200) },
            );

            // Keep session continuity for the salvaged turn too.
            if (role === 'brain') {
              await appendToSession(
                projectId,
                session.messages,
                session.turns,
                [
                  { role: 'user', content: agentPrompt },
                  {
                    role: 'assistant',
                    content: `(Turn finished early after a tool error, but the build succeeded: ${salvageCount} files in the workspace, build verified. Use read_file to inspect current contents.)`,
                  },
                ],
                supabase,
                userId,
              ).catch(() => undefined);
            }

            agentResults.push({ role, success: true, text: builderContext || '', duration: Date.now() - agentStart });
            streamError = null;
            break; // exit the agent queue — finalize with what was built
          }
        }

        if (canRetry) {
          const writtenFiles = Object.keys(getProjectFiles(jobId)).length;
          logger.warn(
            `[orchestrator] ${config.name} errored (${streamError.message.slice(0, 150)}) — retrying (attempt ${builderEmptyRetries + 1}/${MAX_BUILDER_EMPTY_RETRIES}, ${writtenFiles} files on disk).`,
          );
          await emitEvent(
            supabase,
            jobId,
            'file_chunk',
            `⚠️ ${config.name} hit an error (${streamError.message.slice(0, 120)}) — retrying…`,
            { reason: 'builder_error_retry', error: streamError.message.slice(0, 300) },
          );
          agentResults.push({ role, success: false, text: '', duration: Date.now() - agentStart });
          streamError = null;
          builderEmptyRetries++;
          forceBuild = true;
          agentQueue.unshift('brain');
          continue; // skip the (unavailable) stream results; run the agent again
        }

        throw streamError;
      }

      /*
       * After the stream completes, access the final values.
       * These are Promises in streamText (unlike generateText where they're
       * synchronous). Await them to get the actual values.
       */
      const agentText = await streamResult.text;
      const finishReason = await streamResult.finishReason;
      const steps = await streamResult.steps;

      /*
       * Context-pressure sampling. Each step carries its own usage; the LAST
       * step of a multi-step agent has the largest input (accumulated tool
       * results), so the per-step max is the true peak this agent pushed toward
       * the context window. Fall back to the aggregate usage when there are no
       * discrete steps (a single-shot response).
       */
      try {
        const stepPromptTokens = (steps ?? [])
          .map((s: any) => s?.usage?.promptTokens ?? 0)
          .filter((n: number) => Number.isFinite(n) && n > 0);
        const aggUsage = await streamResult.usage;
        const agentPeak = stepPromptTokens.length ? Math.max(...stepPromptTokens) : (aggUsage?.promptTokens ?? 0);

        if (agentPeak > peakPromptTokens) {
          peakPromptTokens = agentPeak;
        }
      } catch {
        /* usage is best-effort telemetry — never fail a build over it */
      }

      if (finishReason === 'length') {
        truncated = true;
      }

      const agentDuration = Date.now() - agentStart;

      /*
       * Success criteria — only true when the LLM finished cleanly AND made at
       * least one tool call. The old code (result.finishReason !== 'error')
       * treated 'length' (token-cap truncation) and 'tool-calls' (maxSteps hit)
       * as success — so a builder that hit maxSteps=30 mid-way through file 8
       * was reported as "succeeded" even though the project was incomplete.
       *
       * Now we explicitly fail on 'length' (truncated mid-file) and 'tool-calls'
       * (hit step limit, didn't reach done()). The orchestrator's overallSuccess
       * check still requires fileCount > 0.
       */
      const madeToolCalls = (steps?.length ?? 0) > 0;
      const agentSuccess = finishReason !== 'error' && finishReason !== 'length' && (finishReason !== 'tool-calls' || madeToolCalls);

      if (finishReason === 'length') {
        logger.warn(
          `[orchestrator] ${config.name} hit token cap (finishReason=length) — output truncated. Consider raising maxTokens.`,
        );
        await emitEvent(
          supabase,
          jobId,
          'file_chunk',
          `⚠️ ${config.name} hit token cap — output may be truncated.`,
        );
      } else if (finishReason === 'tool-calls') {
        logger.warn(`[orchestrator] ${config.name} hit maxSteps (${config.maxSteps}) — agent did not call done().`);

        /*
         * Only surface this warning when it is USER-ACTIONABLE.
         *
         * For the TESTER it never is: the Tester is a QA agent that spends its
         * last steps ticking todos, and the build's REAL outcome is reported
         * separately ("build verified ✓" or the unified failure card). Showing
         * a red "reached step limit" banner for the Tester made verified builds
         * look broken (confirmed in live testing — a build that verified fine
         * still carried the scary banner). So we stay quiet for the Tester and
         * only warn for the Builder, where hitting the cap means the file set
         * may genuinely be incomplete.
         */
        {
          await emitEvent(
            supabase,
            jobId,
            'file_chunk',
            `⚠️ ${config.name} reached step limit (${config.maxSteps}) — continuing with what was built.`,
          );
        }
      }

      agentResults.push({
        role,
        success: agentSuccess,
        text: agentText,
        duration: agentDuration,
      });

      logger.info(
        `[orchestrator] ${config.name} finished: finishReason=${finishReason}, steps=${steps?.length ?? 0}, ${agentText.length} chars text, ${agentDuration}ms, madeToolCalls=${madeToolCalls}, agentSuccess=${agentSuccess}`,
      );

      /*
       * ENTRY-POINT VERIFICATION (radical fix for incomplete builds).
       *
       * The done() tool has an entry-point gate, but it only fires if the
       * model CALLS done(). When the model ends with finishReason='unknown'
       * or 'stop' without calling done() (observed live on a complex
       * e-commerce build: 12 files written but NO App.jsx — the main.jsx
       * imports './App' which doesn't exist → Vite fails → broken preview),
       * the orchestrator accepted it as success because agentSuccess only
       * checked finishReason !== 'error'.
       *
       * Now: AFTER the agent finishes, verify the project has a valid entry
       * point. If not, mark agentSuccess=false so the build is treated as
       * incomplete (salvage gate will still save files, but the user sees
       * a clear "incomplete" status, not a false "success").
       *
       * This is the difference between a "code generator" and a "vibe coding
       * CLI" — a real CLI verifies the project actually runs.
       */
      if (role === 'brain' && agentSuccess) {
        const files = getProjectFiles(jobId);
        const filePaths = Object.keys(files);
        const hasIndexHtml = filePaths.some((p) => /^index\.html$/i.test(p));
        const hasSourceFile = filePaths.some((p) => /^src\/.*(jsx|tsx|vue|js|ts)$/i.test(p));
        const hasPyEntry = filePaths.some((p) => /^(app|main|server|run)\.py$/i.test(p));

        // Check: if main.jsx exists and imports './App', does App.jsx exist?
        const mainFile = filePaths.find((p) => /^src\/main\.(jsx|tsx|js|ts)$/i.test(p));
        const mainContent = mainFile ? (files[mainFile] ?? '') : '';
        const importsApp = /from\s+['"]\.\/App['"]/i.test(mainContent) || /from\s+['"]\.\/App\.(jsx|tsx|js|ts)['"]/i.test(mainContent);
        const hasAppFile = filePaths.some((p) => /^src\/App\.(jsx|tsx|js|ts)$/i.test(p));
        const missingAppFile = importsApp && !hasAppFile;

        const hasAnyEntryPoint = hasIndexHtml || hasSourceFile || hasPyEntry;

        if ((!hasAnyEntryPoint && filePaths.length > 0) || missingAppFile) {
          logger.warn(
            `[orchestrator] ${config.name} finished but project has NO valid entry point! ` +
            `Files: ${filePaths.join(', ')}. ` +
            `missingAppFile=${missingAppFile}, hasIndexHtml=${hasIndexHtml}, hasSourceFile=${hasSourceFile}`,
          );
          // Mark as FAILURE — the build is incomplete
          agentResults[agentResults.length - 1].success = false;

          await emitEvent(
            supabase,
            jobId,
            'file_chunk',
            `⚠️ Build incomplete: ${missingAppFile ? 'src/App.jsx is missing (main.jsx imports it)' : 'no entry point found'}. ` +
            `The model wrote ${filePaths.length} files but didn't finish the project. ` +
            `Try sending the request again, or add the missing files manually.`,
            { agent: 'Palmkit', kind: 'build_incomplete', missingAppFile, filePaths },
          );
        }
      }

      /*
       * Persist this exchange into the project session. response.messages
       * carries the assistant + tool messages exactly as the SDK produced
       * them, so the next build replays real history (compacted) instead of
       * reconstructed prompt blocks. Best-effort: memory must never fail a
       * build.
       */
      if (role === 'brain') {
        try {
          const resp: any = await (streamResult as any).response;
          const respMessages = (resp?.messages ?? []) as SessionMessage[];

          await appendToSession(
            projectId,
            session.messages,
            session.turns,
            [{ role: 'user', content: agentPrompt }, ...respMessages],
            supabase,
            userId,
          );
        } catch (e) {
          logger.warn(`[orchestrator] Failed to persist session for ${projectId}: ${e}`);
        }
      }

      // Capture the agent's narration for the final summary + rawText.
      {
        builderContext = agentText;

        /*
         * RADICAL STREAM IMPROVEMENT — emit a dedicated build_summary event
         * carrying the Builder's FINAL step narration only (not the full
         * agentText, which includes per-file planning commentary like
         * "I'll build X. Let me start by...").
         *
         * The frontend uses this text as the assistant's final response
         * message (replacing the generic "Build complete — N files" stub),
         * so the user sees a model-generated explanation of what was built,
         * the files created, key features, and tech stack — exactly like
         * Claude Code / Cursor / Super Z summarize their work at the end
         * of a build.
         *
         * We extract ONLY the last step's text because:
         *   - Step 1's text is the intro/planning ("I'll build X...")
         *   - Intermediate steps' text is per-file commentary ("Now the config...")
         *   - The LAST step's text is the final summary ("I've built X!
         *     What was created: ... Features: ... Tech stack: ...")
         *
         * Emitted as a file_chunk with kind='build_summary' + isBuildSummary
         * flag so it flows through the existing dispatch logic without
         * needing a new event type, and the frontend can detect it via
         * payload.isBuildSummary.
         */
        try {
          /*
           * Extract the last step's text. The AI SDK's StepResult.text is
           * a Promise<string> — we await it. We scan backwards to find the
           * last step with non-empty text (the final step might be just a
           * tool call like done() with no narration).
           */
          let summaryText = '';
          const allSteps = (await streamResult.steps) ?? [];

          for (let i = allSteps.length - 1; i >= 0; i--) {
            try {
              const stepText = await allSteps[i].text;

              if (stepText && stepText.trim().length >= 50) {
                summaryText = stepText.trim();
                break;
              }
            } catch {
              // best-effort — try the next step
            }
          }

          // Fall back to the full agentText if no step text was extractable
          if (!summaryText && agentText.trim().length > 30) {
            summaryText = agentText.trim();
          }

          if (summaryText.length > 30) {
            await emitEvent(supabase, jobId, 'file_chunk', `📋 Build summary ready`, {
              agent: config.name,
              role,
              kind: 'build_summary',
              text: summaryText,
              isBuildSummary: true,
            });
          }
        } catch (e) {
          logger.warn(`[orchestrator] Failed to emit build_summary: ${e}`);
        }
      }

      // Emit agent_completed — closes the activity stream group for this agent.
      await emitEvent(
        supabase,
        jobId,
        'agent_completed',
        `✅ ${config.name} agent completed (${(agentDuration / 1000).toFixed(1)}s)`,
        { agent: config.name, role, durationMs: agentDuration, success: agentSuccess },
      );

      // With maxSteps=50, the model handles multi-step tool calling naturally.
      // No re-queue needed — the AI SDK manages the conversation loop internally.
      // Each step sees the full conversation including previous tool results.

      /*
       * ═══════════════════════════════════════════════════════════════════
       * PHASE BOUNDARY CHECK (root fix for small files + context overflow)
       *
       * PROBLEM: GLM-4.7 tries to write 40+ files in one streamText call.
       * After ~12 files, context window fills up → model writes SHORT files
       * (76 lines avg) to fit → calls done() prematurely → 3.8K lines total
       * instead of 60-70K.
       *
       * ROOT FIX: After the brain agent finishes WITHOUT calling done(), if
       * 12+ files exist, FORCE a new phase. The new phase gets a FRESH context
       * window with the file list injected, so the model can write LARGER,
       * more complete files for the remaining work.
       *
       * This mirrors how Z.ai Code works: each phase = separate streamText
       * with clean context. The model never tries to fit everything in one
       * context window.
       * ═══════════════════════════════════════════════════════════════════
       */
      if (role === 'brain' && !getDoneSummary(jobId) && builderEmptyRetries < MAX_BUILDER_EMPTY_RETRIES) {
        const phaseFiles = getProjectFiles(jobId) as Record<string, string>;
        const phaseFileCount = Object.keys(phaseFiles).length;

        if (phaseFileCount >= 12 && phaseFileCount < 80) {
          // Check if the project seems complete (has entry + package.json)
          const phasePaths = Object.keys(phaseFiles);
          const hasPkg = phasePaths.some(p => /(^|\/)package\.json$/i.test(p));
          const hasEntry = phasePaths.some(p => /^src\/(main|App)\.(jsx|tsx|js|ts)$/i.test(p));
          const hasIndex = phasePaths.some(p => /^index\.html$/i.test(p));
          const hasBackend = phasePaths.some(p => p.startsWith('server/'));

          // If project has frontend entry but NO backend, and user asked for
          // full-stack, force continuation to write backend files
          const askedFullStack = /backend|server|api|full-stack|fullstack/i.test(prompt || '');
          const needsBackend = askedFullStack && !hasBackend;

          // Force a new phase if: many files written but model didn't call done()
          builderEmptyRetries++;
          forceBuild = true;
          incompleteBuild = true; // inject file list into continuation prompt

          logger.info(
            `[orchestrator] PHASE BOUNDARY: ${phaseFileCount} files written, model didn't call done() — starting new phase ${builderEmptyRetries}/${MAX_BUILDER_EMPTY_RETRIES}`,
          );

          await emitEvent(
            supabase,
            jobId,
            'file_chunk',
            `📐 Phase ${builderEmptyRetries}: ${phaseFileCount} files written — starting fresh context for remaining files`,
            { reason: 'phase_boundary', fileCount: phaseFileCount, phase: builderEmptyRetries },
          ).catch(() => undefined);

          agentResults.push({ role, success: false, text: '', duration: Date.now() - agentStart });
          agentQueue.unshift('brain');
          continue;
        }
      }

      /*
       * Empty-Builder gate. If the Builder finished but the project still has
       * ZERO files, the model planned without acting. Re-queue the Builder once
       * with a force-build directive (runs BEFORE the Tester) instead of failing.
       */
      if (builderEmptyRetries < MAX_BUILDER_EMPTY_RETRIES) {
        const curFiles = getProjectFiles(jobId) as Record<string, string>;
        const curPaths = Object.keys(curFiles);        /*
         * A deliberate done() with zero files = the model ANSWERED (question
         * intent). Never force-build over a conscious reply.
         */
        const zeroFiles = curPaths.length === 0 && !getDoneSummary(jobId);

        /*
         * Under-generation gate. A Vite app (react/vue/nextjs) that finished
         * WITHOUT package.json cannot install deps or build — the model called
         * done() before writing the scaffolding (observed: a "react" build that
         * shipped only index.html + App.jsx and rendered a broken preview).
         * Treat it like an empty build and give it one completion round.
         */
        const builtType = detectAppTypeFromFiles(curFiles);
        const isViteType = builtType === 'react' || builtType === 'vue' || builtType === 'nextjs';
        const missingPkg = isViteType && !curPaths.some((p) => /(^|\/)package\.json$/i.test(p));

        /*
         * NO-ENTRY-POINT gate (RADICAL REBUILD fix). The model was writing
         * ONLY config files (package.json, vite.config.js, etc.) without
         * index.html or src/App.jsx — producing a 404 preview. This gate
         * catches that case and re-prompts the Builder to write the missing
         * entry files BEFORE moving on to the Tester.
         */
        const hasIndexHtml = curPaths.some((p) => /^index\.html$/i.test(p));
        const hasSourceFile = curPaths.some((p) => /^src\/.*(jsx|tsx|vue|js|ts)$/i.test(p));
        const hasPyEntry = curPaths.some((p) => /^(app|main|server|run)\.py$/i);
        const hasFlutterEntry = curPaths.some((p) => /^lib\/(main|app)\.dart$/i);

        /*
         * App-type-aware entry point check. For React/Vue apps, having
         * ONLY index.html without a source file is still broken (Vite 404s).
         * The old hasAnyEntryPoint was too loose — it accepted index.html
         * alone as a valid entry point for React apps, so the retry never
         * triggered when the model wrote config + index.html but no src/App.
         */
        const detectedType = detectAppTypeFromFiles(curFiles);
        const isViteApp = detectedType === 'react' || detectedType === 'vue' || isViteType;
        const hasSufficientEntryPoint = isViteApp
          ? hasIndexHtml && hasSourceFile
          : hasIndexHtml || hasSourceFile || hasPyEntry || hasFlutterEntry;

        const missingEntryPoint = !zeroFiles && !missingPkg && curPaths.length > 0 && !hasSufficientEntryPoint;

        /*
         * MISSING APP FILE check (radical fix for incomplete builds).
         * If main.jsx imports './App' but App.jsx doesn't exist, the build
         * will fail at runtime (Vite can't resolve the import). This is
         * different from missingEntryPoint — the entry point EXISTS
         * (main.jsx), but it references a file that doesn't.
         */
        const mainFile = curPaths.find((p) => /^src\/main\.(jsx|tsx|js|ts)$/i.test(p));
        const mainContent = mainFile ? (curFiles[mainFile] ?? '') : '';
        const importsApp = /from\s+['"]\.\/App['"]/i.test(mainContent) || /from\s+['"]\.\/App\.(jsx|tsx|js|ts)['"]/i.test(mainContent);
        const hasAppFile = curPaths.some((p) => /^src\/App\.(jsx|tsx|js|ts)$/i.test(p));
        const missingAppFile = importsApp && !hasAppFile;

        if (zeroFiles || missingPkg || missingEntryPoint || missingAppFile) {
          builderEmptyRetries++;
          forceBuild = true;
          incompleteBuild = !zeroFiles && (missingPkg || missingEntryPoint || missingAppFile);
          agentQueue.unshift('brain'); // re-run the agent

          const reason = zeroFiles
            ? 'empty_builder_retry'
            : missingPkg
              ? 'incomplete_build_retry'
              : missingAppFile
                ? 'missing_app_file_retry'
                : 'no_entry_point_retry';

          const agentName = 'Palmkit';
          const msg = zeroFiles
            ? `⚠️ No files written yet — re-prompting ${agentName} to build now (attempt ${builderEmptyRetries}/${MAX_BUILDER_EMPTY_RETRIES}).`
            : missingPkg
              ? `⚠️ Build is missing package.json — a Vite app can't run without it. Asking ${agentName} to finish the scaffolding (attempt ${builderEmptyRetries}/${MAX_BUILDER_EMPTY_RETRIES}).`
              : missingAppFile
                ? `⚠️ main.jsx imports './App' but App.jsx does NOT exist! Vite will fail. Re-prompting ${agentName} to write src/App.jsx NOW (attempt ${builderEmptyRetries}/${MAX_BUILDER_EMPTY_RETRIES}).`
                : `⚠️ Build has ${curPaths.length} files but NO entry point (no index.html, no src/App.jsx). The preview will 404. Re-prompting ${agentName} to write the missing entry files (attempt ${builderEmptyRetries}/${MAX_BUILDER_EMPTY_RETRIES}).`;

          await emitEvent(supabase, jobId, 'file_chunk', msg, {
            reason,
            attempt: builderEmptyRetries,
            currentFiles: curPaths,
          });
        }
      }
    }

    // Check final result
    const files = getProjectFiles(jobId) as Record<string, string>;
    const fileCount = Object.keys(files).length;

    /*
     * Use the app type implied by the ACTUAL generated files for the
     * entry-point check (falls back to the prompt-based guess). Prevents a
     * wrong keyword guess (e.g. "static" for a project the model built with
     * React) from failing an otherwise-valid build on the entry-point rule.
     */
    const effectiveAppType = detectAppTypeFromFiles(files) ?? appType;

    /*
     * ENTRY POINT CHECK — prevent "successful" builds with no entry point.
     *
     * The previous MIN_FILES check forced a minimum file count per app type
     * (react: 5, static: 3, etc.). This was WRONG — it constrained the model
     * to an arbitrary number. A real project might have 3 files or 30 files
     * depending on complexity. The model should decide how many files to
     * create.
     *
     * The REAL problem was builds producing ONLY config files (package.json
     * + vite.config.js) without an entry point (index.html / src/App.jsx).
     * Vite returns 404 → blank preview.
     *
     * Fix: check for the PRESENCE of an entry point, not a file count.
     *   - Web apps (react/vue/nextjs/static): need index.html or src/App.* or src/main.* or src/index.*
     *   - Python: need app.py or main.py or server.py
     *   - Flutter: need lib/main.dart
     *   - React Native: need App.tsx or App.js or app/_layout.tsx
     *
     * If the entry point is missing → fail with a clear message.
     * If the entry point exists → accept regardless of file count.
     */
    const ENTRY_POINT_PATTERNS: Record<string, RegExp[]> = {
      static: [/^index\.html$/i, /^src\/.*\.(js|ts)$/i],
      react: [
        /^index\.html$/i,
        /^src\/(App|Main|main|app)\.(jsx|tsx|js|ts)$/i,
        /^src\/(main|index)\.(jsx|tsx|js|ts)$/i,
      ],
      nextjs: [/^(app|pages)\/(page|index)\.(jsx|tsx|js|ts)$/i, /^src\/(app|pages)\//i],
      vue: [/^index\.html$/i, /^src\/(App|main)\.(vue|js|ts)$/i],
      python: [/^(app|main|server|run)\.py$/i],
      flutter: [/^lib\/(main|app)\.dart$/i],
      'react-native': [/^(App|app)\.(tsx|jsx|ts|js)$/i, /^app\/(app|_layout)\.(tsx|ts)$/i],
    };

    const patterns = (effectiveAppType && ENTRY_POINT_PATTERNS[effectiveAppType]) || [];
    const filePaths = Object.keys(files);

    /*
     * CRITICAL FIX: if the model wrote config files (package.json, vite.config.js,
     * etc.) but NO source files, detectAppTypeFromFiles returns null (no entry
     * point exists to detect from). The old code treated null as "patterns.length
     * === 0 → hasEntryPoint = true" — which meant a build with ONLY 4 config files
     * and ZERO source code was falsely marked "complete". The preview 404'd.
     *
     * Now: if fileCount > 0 but we couldn't detect an app type, that means the
     * model wrote config-only files without any entry point. FAIL the build.
     */
    const hasEntryPoint =
      patterns.length === 0
        ? false // ← was true; null app type with files = no entry point = FAIL
        : (() => {
            if (effectiveAppType === 'react' || effectiveAppType === 'vue') {
              // Need BOTH index.html AND a source file in src/
              const hasIndexHtml = filePaths.some((p) => /^index\.html$/i.test(p));
              const hasSourceFile = filePaths.some((p) => /^src\/.*(jsx|tsx|vue|js|ts)$/i.test(p));

              return hasIndexHtml && hasSourceFile;
            }

            // For other app types, any single pattern match is enough
            return filePaths.some((p) => patterns.some((re) => re.test(p)));
          })();

    /*
     * IMPORT-INTEGRITY GATE. The entry-point check above verifies files EXIST,
     * but a build can still ship broken: observed live — src/main.jsx imports
     * './App.jsx' while App.jsx was deleted mid-build (write-lock + delete_file
     * interplay) and the job was STILL marked ready_for_preview. The preview
     * then dies on Vite's "Failed to resolve import". Verify the main entry's
     * relative imports resolve against the final file set before declaring
     * success.
     */
    const missingImports: string[] = [];

    if (effectiveAppType === 'react' || effectiveAppType === 'vue') {
      const mainPath = filePaths.find((p) => /^src\/main\.(jsx|tsx|js|ts)$/i.test(p));
      const mainSrc = mainPath ? (files as Record<string, string>)[mainPath] : '';

      for (const m of (mainSrc || '').matchAll(/from\s+['"]\.\/([\w./-]+)['"]/g)) {
        const rel = m[1].replace(/\.(jsx|tsx|js|ts|vue|css)$/i, '');
        const satisfied = filePaths.some((p) =>
          new RegExp(`^src/${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.(jsx|tsx|js|ts|vue|css))?$`, 'i').test(p),
        );

        if (!satisfied) {
          missingImports.push(`src/${m[1]}`);
        }
      }
    }

    if (fileCount > 0 && (!hasEntryPoint || missingImports.length > 0)) {
      logger.error(
        `[orchestrator] Build produced ${fileCount} files but is broken for ${appType} app. ` +
          `hasEntryPoint=${hasEntryPoint}, missingImports=[${missingImports.join(', ')}]. Files: ${filePaths.join(', ')}. Failing.`,
      );

      const errorMsg = !hasEntryPoint
        ? `Build produced ${fileCount} file${fileCount !== 1 ? 's' : ''} but is missing required entry point files. ` +
          `Files written: ${filePaths.join(', ')}. ` +
          `For a ${appType} app, you need BOTH index.html AND source files (src/App.jsx, src/main.jsx). ` +
          `Please try again — the model called done() before writing the main application files.`
        : `Build finished but is incomplete: the entry file imports ${missingImports.join(', ')} which ${
            missingImports.length === 1 ? 'was' : 'were'
          } never written (or got deleted during the build). The preview would fail to start. ` +
          `Please try again or send a follow-up message asking to recreate the missing file${missingImports.length === 1 ? '' : 's'}.`;

      await emitEvent(supabase, jobId, 'job_failed', errorMsg);
      overallSuccess = false;
    } else {
      overallSuccess = fileCount > 0;
    }

    /*
     * ANSWER MODE — zero files + a deliberate done() = the model replied to
     * a question/discussion. That is a successful turn, not a failed build.
     */
    const answered = fileCount === 0 && !!getDoneSummary(jobId) && agentResults.some((a) => a.success);

    if (answered) {
      overallSuccess = true;
      logger.info(`[orchestrator] Answer mode: the agent replied without file changes.`);
    }

    /*
     * Build verification check — if npm run build was run and FAILED,
     * the build is NOT successful. Files are saved but preview is blocked.
     * This is the ROOT FIX for the "white page" issue: builds that fail
     * npm run build were still marked as ready_for_preview, showing the
     * user a broken preview.
     */
    const finalBuild = getBuildResult(jobId);
    const buildVerified = finalBuild ? finalBuild.passed : null;

    if (overallSuccess && finalBuild && !finalBuild.passed) {
      logger.warn(
        `[orchestrator] Build produced ${fileCount} files but npm run build FAILED (exit non-zero). ` +
        `Marking as NOT successful — preview will be blocked until the user fixes the errors.`,
      );
      overallSuccess = false;

      await emitEvent(
        supabase,
        jobId,
        'file_chunk',
        `⚠️ Build verification failed: npm run build exited with errors. ` +
        `${fileCount} files are saved — you can view them and fix the errors, ` +
        `then send a follow-up message to retry the build.`,
        { buildVerified: false, fileCount },
      );
    } else if (overallSuccess && buildVerified === true) {
      await emitEvent(
        supabase,
        jobId,
        'file_chunk',
        `✅ Build verified — npm run build passed successfully.`,
        { buildVerified: true, fileCount },
      );
    }

    logger.info(
      `[orchestrator] Build finished: ${fileCount} files, ${agentResults.length} agent runs, buildVerified=${buildVerified}`,
    );

    /*
     * Write worklog + manifest + .palmkit/ memory
     * Write EVEN on partial/failed builds if files were written — the next
     * "edit" message needs this memory to know what exists. Without it, the
     * model thinks the project is empty and rebuilds from scratch.
     */
    const hasFiles = fileCount > 0;

    if (hasFiles) {
      const totalSize = Object.values(files).reduce((s: number, c: string) => s + c.length, 0);
      const duration = Date.now() - startTime;
      const summary = builderContext.slice(-500) || undefined;

      if (overallSuccess) {
        await emitEvent(
          supabase,
          jobId,
          'file_generation_completed',
          `🚀 Orchestrated build complete: ${fileCount} files, ${totalSize} chars, ${agentResults.length} agents${
            buildVerified === true ? ' — build verified ✓' : buildVerified === false ? ' — build has errors ⚠️' : ''
          }`,
          { fileCount, agents: agentResults.map((a) => a.role), buildVerified },
        );
      } else {
        await emitEvent(
          supabase,
          jobId,
          'file_generation_completed',
          `⚠️ Build incomplete: ${fileCount} files written, but agent didn't finish cleanly. Memory saved so next edit can continue.`,
          { fileCount, partial: true },
        );
      }

      try {
        // 1. Worklog
        const worklogEntry = generateWorklogEntry({
          prompt,
          fileCount,
          totalSize,
          summary,
          appType,
          duration,
        });
        await appendToWorklog(projectId, worklogEntry, supabase, userId);

        // 1b. current-task.md — write the ACTIVE task for the next turn.
        // This was a DEAD POINTER (agent-instructions.md told the brain to
        // read it, but no code wrote it). Now it's a real feature: the brain
        // sees what the user asked for last + what was done, so it can
        // continue intelligently instead of rebuilding from scratch.
        const currentTaskContent = [
          '# Current Task',
          '',
          `**Last request:** ${prompt.slice(0, 500)}`,
          '',
          `**Status:** ${overallSuccess ? (buildVerified ? 'completed and verified' : 'completed') : 'partial — needs follow-up'}`,
          '',
          `**Files:** ${fileCount} files (${totalSize} chars total)`,
          '',
          `**App type:** ${appType ?? 'unknown'}`,
          '',
          summary ? `**Summary:** ${summary.slice(0, 1000)}` : '**Summary:** (no summary provided)',
          '',
          '---',
          '',
          '## What to do next',
          'If the user sends a new message, you are CONTINUING this project.',
          'Read the files that exist (use list_files), make targeted edits,',
          'and verify with `npm install && npm run build` before calling done().',
        ].join('\n');

        await writePalmkitFile(projectId, 'current-task.md', currentTaskContent, supabase, userId);

        // 2. Smart manifest
        const smartManifest = generateSmartManifest({
          projectId,
          appType: appType ?? null,
          files,
          prompt,
          summary,
        });

        const manifest = await readManifest(projectId);
        manifest.lastBuildAt = new Date().toISOString();
        manifest.lastBuildSummary = summary?.slice(0, 200) || null;
        manifest.fileCount = fileCount;
        manifest.appType = appType ?? manifest.appType;
        manifest.schemaVersion = smartManifest.schemaVersion;
        manifest.projectType = smartManifest.projectType;
        manifest.stack = smartManifest.stack;
        manifest.entrypoints = smartManifest.entrypoints;
        manifest.importantFiles = smartManifest.importantFiles;
        manifest.commands = smartManifest.commands;
        manifest.apiRoutes = smartManifest.apiRoutes;
        manifest.qualityGates = smartManifest.qualityGates;
        manifest.lastKnownStatus = overallSuccess
          ? buildVerified === true
            ? 'build_passed'
            : 'build_unknown'
          : 'partial';
        manifest.knownIssues = smartManifest.knownIssues;
        await writeManifest(manifest, supabase, userId);

        // 3. .palmkit/ memory layer
        await writePalmkitMemory(
          projectId,
          { prompt, files, appType: appType ?? null, summary, manifest: smartManifest },
          supabase,
          userId,
        );

        /*
         * 4. Palmkit.md — the project's primary memory file (injected at
         *    session start on the next build).
         */
        await writePalmkitProjectMemory(
          projectId,
          {
            prompt,
            files,
            appType: appType ?? null,
            summary,
            manifest: smartManifest,
            buildVerified,
            success: overallSuccess,
          },
          supabase,
          userId,
        );

        /*
         * 5. Git checkpoint (M1) — flush the full file set to the project's
         *    disk dir and commit this turn. Exports .palmkit/history.json
         *    (hash + date + message, last 20) for the version-history UI.
         */
        const checkpoint = await commitProjectTurn(projectId, files, prompt, supabase, userId);

        if (checkpoint) {
          await emitEvent(supabase, jobId, 'file_chunk', `🕘 Checkpoint saved (${checkpoint.hash})`, {
            kind: 'checkpoint',
            hash: checkpoint.hash,
            message: checkpoint.message,
          }).catch(() => undefined);
        }

        logger.info(
          `[orchestrator] Worklog + manifest + .palmkit/ memory updated for ${projectId} (${overallSuccess ? 'success' : 'partial'})`,
        );
      } catch (e) {
        logger.warn(`[orchestrator] Failed to update memory: ${e}`);
      }
    }

    // Convert files to FileOperation[] format
    const fileOps: FileOperation[] = Object.entries(getProjectFiles(jobId)).map(([path, content]) => ({
      op: 'write_file' as const,
      path,
      content,
    }));

    return {
      success: overallSuccess,
      answered,
      files: fileOps,
      rawText: agentResults.map((a) => `[${a.role}]: ${a.text.slice(0, 200)}`).join('\n\n'),
      totalDuration: Date.now() - startTime,
      agentResults,
      contextTokens: peakPromptTokens,
      contextWindow: effectiveContextWindow,
      contextRatio: effectiveContextWindow > 0 ? peakPromptTokens / effectiveContextWindow : 0,
      truncated,
      buildVerified, // NEW: pass to job-processor so it can block ready_for_preview on failure
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[orchestrator] Build failed: ${errMsg}`);

    const errFiles = getProjectFiles(jobId) as Record<string, string>;
    const errFileOps: FileOperation[] = Object.entries(errFiles).map(([path, content]) => ({
      op: 'write_file' as const,
      path,
      content,
    }));

    /*
     * FIX: Always report failure — never mask an LLM/stream error as success.
     * Before this fix, if the LLM wrote ANY files before crashing (e.g. 3 of
     * 10 files), the build was reported as successful with a partial, broken
     * project. Now we return success:false so the job-processor's else branch
     * fires and surfaces a clear, actionable error to the user.
     */
    return {
      success: false,
      answered: false,
      files: errFileOps,
      rawText: `orchestrator-error: ${err instanceof Error ? err.message : String(err)}`,
      totalDuration: Date.now() - startTime,
      agentResults,
      contextTokens: peakPromptTokens,
      contextWindow: effectiveContextWindow,
      contextRatio: effectiveContextWindow > 0 ? peakPromptTokens / effectiveContextWindow : 0,
      truncated,
    };
  } finally {
    clearInterval(keepAlive);
    clearTimeout(hardTimeout);

    /*
     * M2: close the live-stream bus and record its stats as a durable
     * marker. `stream_stats` is the remote-verification hook: chunksSent>0
     * with failures=0 proves the broadcast path worked for this build even
     * without a browser attached.
     */
    try {
      const stats = await closeJobStream(jobId);
      await emitEvent(
        supabase,
        jobId,
        'file_chunk',
        `📡 Live stream: ${stats.chunksSent} chunks in ${stats.batchesSent} batches${stats.failures ? ` (${stats.failures} failed)` : ''}`,
        { kind: 'stream_stats', ...stats },
      );
    } catch {
      /* telemetry only */
    }

    /*
     * Release this job's isolated file map (the result already holds a
     * detached copy of the files, so this is safe and prevents the registry
     * from growing without bound on the long-running worker).
     */
    disposeProjectFiles(jobId);
    disposeBuildResult(jobId);
    disposeDoneSummary(jobId);

    /*
     * Kill the job's persistent E2B sandbox (created lazily on the first
     * run_shell). This is the ONLY place it's torn down, so it must run on
     * every exit path — success, failure, timeout, or abort.
     *
     * The frontend creates its OWN sandbox for preview (remotePreview.ts),
     * so killing this one is safe — the preview doesn't depend on it.
     */
    await disposeSandbox(jobId);

    // Remove from the abort registry — the job is no longer cancellable.
    unregisterJobAbort(jobId);
  }
}
