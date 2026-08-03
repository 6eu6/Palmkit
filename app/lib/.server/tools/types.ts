/**
 * Tool Type System — Phase 1 of Agentic Tools Architecture
 * ========================================================
 *
 * This file defines the foundational types for the entire tool system.
 * Every tool in app/lib/.server/tools/ implements these interfaces.
 *
 * Design principles:
 * ------------------
 * 1. **Composable**: Each tool is a self-contained unit that can be registered,
 *    filtered by mode, and chained inside custom agents later.
 * 2. **Schema-first**: Every input is validated by Zod before execute() runs.
 *    This eliminates the "try-blind" anti-pattern (calling execute with
 *    unvalidated args and hoping for the best).
 * 3. **Context-aware**: Tools receive a ToolContext that carries shared
 *    state (files, sandboxId, apiKeys, userId, mode). No more ad-hoc
 *    `(options as any)?.files` casts scattered across the codebase.
 * 4. **Mode-scoped**: Each tool declares which modes it belongs to. The
 *    registry enforces this — the LLM literally cannot see tools outside
 *    the current mode.
 * 5. **Result-structured**: Every tool returns a JSON-serializable object,
 *    never a raw string. This lets agents chain tool outputs.
 *
 * The interface is compatible with Vercel AI SDK v4 `tool()` so we can
 * pass the registry output directly into `streamText({ tools })`.
 */

import { z, type ZodTypeAny } from 'zod';
import type { Tool as AiSdkTool } from 'ai';
import type { Capability, Route } from '~/lib/.server/llm/model-router';

/**
 * The three sidebar modes. `chatMode` (discuss/build) is orthogonal:
 *   - chat  → chatMode='discuss', sidebarMode='chat'
 *   - work  → chatMode='discuss', sidebarMode='work'
 *   - code  → chatMode='build',   sidebarMode='code'
 *
 * Tools care about the *combined* mode because some tools (e.g. read_url)
 * are useful everywhere, while others (e.g. run_shell) only make sense
 * in code mode.
 */
export type SidebarMode = 'chat' | 'work' | 'code';

/**
 * Internal mode identifier used by the registry. Derived from the
 * (chatMode, sidebarMode) tuple. The registry receives this already
 * resolved so it doesn't need to know about chatMode at all.
 */
export type ToolMode = 'chat' | 'work' | 'code';

/**
 * Shared context injected into every tool's execute() call.
 *
 * The registry builds this once per request and threads it through.
 * Tools read only what they need; missing fields produce a clean error
 * rather than a runtime crash.
 */
export interface ToolContext {
  /** Project file map (FileMap from constants). Only present in code/work mode. */
  files?: Record<string, any>;

  /** Active sandbox ID. Only present in code mode after the sandbox starts. */
  sandboxId?: string;

  /**
   * The user's own provider keys, by provider name.
   *
   * `openRouterApiKey` used to be the only one, read from the deployment's
   * environment — so image generation was dead for every user who had their
   * own key and no server-wide one, which is everyone on the hosted app.
   */
  apiKeys?: Record<string, string>;

  /**
   * Pick a model for a job the chat model cannot do itself — drawing an
   * image, generating a video. Resolved from the catalog, so the tool does
   * not carry a list of model names that goes stale.
   */
  routeModel?: (capability: Capability) => Promise<Route | undefined>;

  /** Tavily/SerpApi key (for web_search / deep_search). */
  searchApiKey?: string;

  /** Authenticated user ID (for memory / personalization). */
  userId?: string;

  /** Resolved mode — same value the registry used to filter tools. */
  mode: ToolMode;

  /** Original request trace id (for logging / debugging). */
  requestId?: string;
}

/**
 * Standard success envelope. Tools that succeed MUST return an object
 * containing `ok: true` plus tool-specific fields.
 *
 * Why a discriminated union instead of throwing?
 *   - The LLM consumes tool results as JSON. Exceptions break the stream
 *     and force the SDK into recovery mode.
 *   - A consistent `ok` field lets the LLM write generic reasoning like
 *     "if ok is false, surface the error to the user".
 */
/**
 * Standard success envelope. Tools that succeed MUST return an object
 * containing `ok: true` plus tool-specific fields.
 *
 * Why a discriminated union instead of throwing?
 *   - The LLM consumes tool results as JSON. Exceptions break the stream
 *     and force the SDK into recovery mode.
 *   - A consistent `ok` field lets the LLM write generic reasoning like
 *     "if ok is false, surface the error to the user".
 *
 * Note: This is a *marker* interface — tools can return any concrete
 * object that has `ok: true`. We deliberately avoid an index signature
 * (`[key: string]: unknown`) because that would force every concrete
 * success type (e.g. ScrapePageSuccess) to also declare an index
 * signature, which is noisy and breaks type narrowing.
 *
 * The discriminated union with ToolFailure still works because `ok`
 * is a literal discriminant.
 */
export interface ToolSuccess {
  ok: true;

  /**
   * Index signature: allows tool implementations to attach any
   * serializable fields (url, content, results, etc.) without
   * having to redeclare them on every concrete success type.
   *
   * Concrete types that want stricter typing (e.g. ScrapePageSuccess)
   * should `extends ToolSuccess` and add their named fields. TypeScript
   * allows named properties on top of an index signature as long as
   * the named property types are assignable to the index type (unknown).
   */
  [key: string]: unknown;
}

/**
 * Standard error envelope. Tools that fail MUST return `ok: false` with
 * a human-readable error message and (optionally) a hint on how to fix it.
 */
export interface ToolFailure {
  ok: false;
  error: string;
  hint?: string;
}

export type ToolResult = ToolSuccess | ToolFailure;

/**
 * Core tool definition. Each tool is a plain object (no class hierarchy)
 * implementing this interface. The registry converts it to an AI SDK
 * `tool()` instance at registration time.
 *
 * Type parameters:
 *   TInput  — Zod schema describing the tool's parameters
 *   TResult — The success payload shape (for editor autocomplete)
 */
export interface ToolDefinition<TInput extends ZodTypeAny = ZodTypeAny, TResult extends ToolResult = ToolResult> {
  /** Unique, snake_case identifier. Used by the LLM to call the tool. */
  name: string;

  /**
   * Rich description. This is the LLM's *only* signal for when to use the
   * tool. MUST cover:
   *   - What the tool does (one sentence)
   *   - When to use it (specific triggers)
   *   - When NOT to use it (common confusions)
   *   - What it returns (so the LLM can plan chains)
   *
   * The registry injects this verbatim into the AI SDK `tool()` call.
   */
  description: string;

  /** Zod schema for input validation. Runs BEFORE execute(). */
  inputSchema: TInput;

  /** Modes this tool is available in. Empty array = disabled. */
  availableIn: ReadonlyArray<ToolMode>;

  /**
   * Execute the tool. Receives:
   *   - input: validated by inputSchema (typed by Zod inference)
   *   - ctx:   shared ToolContext
   *
   * MUST return a ToolResult (never throw). Network errors, parse errors,
   * and timeouts are caught by the registry wrapper and converted to
   * ToolFailure, but tools should also handle their own expected failure
   * modes for better error messages.
   */
  execute: (input: z.infer<TInput>, ctx: ToolContext) => Promise<TResult> | TResult;
}

/**
 * Helper: convert a ToolDefinition into an AI SDK v4 `tool()` object,
 * pre-bound to a specific ToolContext.
 *
 * The AI SDK v4 expects `parameters` (a Zod schema) and `execute` with
 * the signature `(args, options) => Promise<any>`. AI SDK v4 does NOT
 * support `toolContext` (that's v5), so we close over the context at
 * registration time. This matches the existing pattern in api.chat.ts
 * (line ~346: `execute: (args, opts) => builtInTools.read_file.execute(args, { ...opts, files })`).
 *
 * Why a wrapper instead of native tool() calls?
 *   - Centralized error handling: any thrown error becomes a ToolFailure.
 *   - Centralized logging: every tool call is logged with name + duration.
 *   - Future hooks: we can add rate-limiting, audit logging, or tracing
 *     here without touching every tool.
 *
 * @param def  The ToolDefinition to convert.
 * @param ctx  The ToolContext to bind. The same ctx is shared by all
 *             tools returned from a single getToolsForMode() call.
 */
export function toAiSdkTool<TInput extends ZodTypeAny, TResult extends ToolResult>(
  def: ToolDefinition<TInput, TResult>,
  ctx: ToolContext,
): AiSdkTool<TInput, TResult> {
  return {
    description: def.description,
    parameters: def.inputSchema,
    execute: async (input: z.infer<TInput>, _options: any): Promise<TResult> => {
      const startTime = Date.now();

      try {
        const result = await def.execute(input, ctx);
        const durationMs = Date.now() - startTime;

        /*
         * Structured log (server-side only; never reaches the client).
         * console.* works in both CF Workers and Node — the logger module
         * adds import weight we don't want in the 3 MiB CF Pages bundle.
         */
        if (durationMs > 5000) {
          console.warn(
            `[tool] ${def.name} took ${durationMs}ms (slow) — mode=${ctx.mode} reqId=${ctx.requestId ?? 'n/a'}`,
          );
        } else {
          console.log(`[tool] ${def.name} ok=${(result as any).ok} ${durationMs}ms`);
        }

        return result;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);

        console.error(
          `[tool] ${def.name} threw after ${durationMs}ms: ${message}`,
          err instanceof Error ? err.stack : undefined,
        );

        return {
          ok: false,
          error: `Tool "${def.name}" failed unexpectedly: ${message}`,
          hint: 'This is likely a transient issue. Retry, or rephrase the request.',
        } as TResult;
      }
    },
  } as AiSdkTool<TInput, TResult>;
}

/**
 * Helper: check whether a tool should be available in a given mode.
 * Pure function — used by both the registry and tests.
 */
export function isToolAvailableInMode(def: Pick<ToolDefinition, 'availableIn'>, mode: ToolMode): boolean {
  return def.availableIn.includes(mode);
}

/**
 * Helper: resolve (chatMode, sidebarMode) → ToolMode.
 *
 * Centralizing this here means tools and the registry never have to
 * duplicate the mode-resolution logic. The API chat layer calls this
 * once and passes the result down.
 *
 * Rules:
 *   - chatMode='build' → always 'code' (regardless of sidebarMode)
 *   - chatMode='discuss' + sidebarMode='work' → 'work'
 *   - chatMode='discuss' + sidebarMode='chat' or undefined → 'chat'
 *   - chatMode='discuss' + sidebarMode='code' → 'code' (user in code tab but discussing)
 *
 * Edge case: if sidebarMode is 'code' but chatMode is 'discuss', we
 * still return 'code' — the user is in the code tab and should see
 * code tools even when just chatting.
 */
export function resolveToolMode(chatMode: 'discuss' | 'build', sidebarMode?: SidebarMode): ToolMode {
  if (chatMode === 'build') {
    return 'code';
  }

  if (sidebarMode === 'work') {
    return 'work';
  }

  if (sidebarMode === 'code') {
    return 'code';
  }

  return 'chat';
}
