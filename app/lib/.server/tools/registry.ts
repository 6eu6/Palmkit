/**
 * Tool Registry — Phase 1 of Agentic Tools Architecture
 * =====================================================
 *
 * The registry is the SINGLE SOURCE OF TRUTH for every tool in the system.
 * It exposes:
 *   - getToolsForMode(mode, ctx): returns AI SDK tool objects ready for streamText
 *   - listAllTools(): returns metadata for UI/documentation
 *   - getToolByName(name): returns a single ToolDefinition (for tests)
 *
 * Adding a new tool:
 *   1. Create app/lib/.server/tools/{category}/{name}.ts
 *   2. Export a ToolDefinition
 *   3. Import it here and add it to ALL_TOOLS
 *   4. Done — the registry handles mode filtering automatically
 *
 * The registry is intentionally a const object (not a class). This keeps
 * it tree-shakeable and prevents accidental mutation. The only way to
 * "register" a tool is to add it to ALL_TOOLS at module load time.
 */

import type { Tool as AiSdkTool } from 'ai';
import {
  type ToolContext,
  type ToolDefinition,
  type ToolMode,
  type ToolResult,
  isToolAvailableInMode,
  toAiSdkTool,
} from './types';

// ─── Investigative tools ──────────────────────────────────────────────
import { webSearchTool } from './investigative/web-search';
import { readUrlTool } from './investigative/read-url';
import { scrapePageTool } from './investigative/scrape-page';
import { deepSearchTool } from './investigative/deep-search';
import { readAndExtractTool } from './investigative/read-and-extract';

// ─── Office tools (Phase 2 — native) ──────────────────────────────────
import { createPdfTool } from './office/create-pdf';
import { createDocxTool } from './office/create-docx';
import { createXlsxTool } from './office/create-xlsx';
import { createMdTool } from './office/create-md';
import { readDocumentTool } from './office/read-document';

// ─── Analytics tools (Phase 2 + 3 — native) ───────────────────────────
import { makeChartTool } from './analytics/make-chart';
import { buildTableTool } from './analytics/build-table';
import { analyzeDataTool } from './analytics/analyze-data';

// ─── Creative tools (Phase 3 — native) ────────────────────────────────
import { generateImageTool } from './creative/generate-image';

// ─── Code-mode tools (Phase 4 — native) ───────────────────────────────
import { readFileTool } from './code/read-file';
import { listFilesTool } from './code/list-files';
import { grepTool } from './code/grep';
import { runShellTool } from './code/run-shell';
import { screenshotTool } from './code/screenshot';
import { readSandboxFileTool } from './code/read-sandbox-file';

import { z, type ZodTypeAny } from 'zod';

/**
 * Erased type for the master tool list.
 *
 * ToolDefinition<TInput, TResult> is invariant in TInput because TInput
 * appears in both inputSchema (covariant) and execute's parameter
 * (contravariant). This means ToolDefinition<ZodObject<...>, ToolResult>
 * is NOT assignable to ToolDefinition<ZodTypeAny, ToolResult>, even
 * though ZodObject<...> is a subtype of ZodTypeAny.
 *
 * Solution: use a type-erased variant where the execute signature
 * accepts `any` input. This matches the AI SDK's own Tool type, which
 * also uses `any` for execute args after schema validation.
 */
type AnyToolDefinition = ToolDefinition<ZodTypeAny, ToolResult>;

/**
 * Master list of native ToolDefinitions.
 * Tools here are written in the new style (ToolDefinition interface).
 *
 * Phase 1: investigative (web_search, read_url, scrape_page)
 * Phase 2: office (create_pdf, create_docx, create_xlsx, read_document)
 *          analytics (make_chart, build_table)
 * Phase 3: creative (generate_image)
 *          analytics (analyze_data)
 *          investigative (deep_search, read_and_extract)
 * Phase 4: code (read_file, list_files, grep, run_shell, screenshot, read_sandbox_file)
 *
 * ALL tools are native. The legacy built-in-tools.ts and work-mode-tools.ts
 * files have been DELETED (Phase 5 cleanup).
 */
const NATIVE_TOOLS: AnyToolDefinition[] = [
  // Investigative
  webSearchTool as unknown as AnyToolDefinition,
  readUrlTool as unknown as AnyToolDefinition,
  scrapePageTool as unknown as AnyToolDefinition,
  deepSearchTool as unknown as AnyToolDefinition,
  readAndExtractTool as unknown as AnyToolDefinition,

  // Office (Phase 2)
  createPdfTool as unknown as AnyToolDefinition,
  createDocxTool as unknown as AnyToolDefinition,
  createXlsxTool as unknown as AnyToolDefinition,
  createMdTool as unknown as AnyToolDefinition,
  readDocumentTool as unknown as AnyToolDefinition,

  // Analytics (Phase 2 + 3)
  makeChartTool as unknown as AnyToolDefinition,
  buildTableTool as unknown as AnyToolDefinition,
  analyzeDataTool as unknown as AnyToolDefinition,

  // Creative (Phase 3)
  generateImageTool as unknown as AnyToolDefinition,

  // Code (Phase 4)
  readFileTool as unknown as AnyToolDefinition,
  listFilesTool as unknown as AnyToolDefinition,
  grepTool as unknown as AnyToolDefinition,
  runShellTool as unknown as AnyToolDefinition,
  screenshotTool as unknown as AnyToolDefinition,
  readSandboxFileTool as unknown as AnyToolDefinition,
];

/**
 * All tools are now native — no legacy adapters.
 *
 * The adaptLegacyTool function is kept for backward compatibility (in case
 * we need to wrap an external tool in the future), but it's no longer used
 * by the master tool list. The LEGACY_ADAPTERS array is empty.
 */

/**
 * Adapter: wrap a legacy AI SDK tool as a ToolDefinition.
 *
 * Legacy tools don't have `availableIn` or our ToolContext signature.
 * We wrap them so the registry can route through them uniformly. The
 * adapter reads the legacy tool's `parameters` and `execute`, and
 * provides our standard error handling on top.
 *
 * The legacy tool's execute is called with the original (args, options)
 * signature, where we manually inject `files` / `sandboxId` from the
 * ToolContext — preserving the old API contract.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function adaptLegacyTool(
  name: string,
  availableIn: ReadonlyArray<ToolMode>,
  legacy: any,
  contextInjector?: (ctx: ToolContext) => Record<string, any>,
): ToolDefinition {
  return {
    name,
    description: legacy.description ?? `(legacy tool: ${name})`,
    inputSchema: legacy.parameters ?? z.object({}),
    availableIn,
    execute: async (input: any, ctx: ToolContext): Promise<ToolResult> => {
      try {
        const extraOptions = contextInjector ? contextInjector(ctx) : {};

        // Legacy tools read (args, options) — we pass the extra context as `options`
        const result = await legacy.execute(input, extraOptions);

        /*
         * Legacy tools return raw objects — normalize to ToolResult.
         * If the result already has `ok`, pass it through.
         */
        if (result && typeof result === 'object' && 'ok' in result) {
          return result as ToolResult;
        }

        // Legacy tools that return { error: ... } are signaling failure.
        if (result && typeof result === 'object' && 'error' in result && !('ok' in result)) {
          return { ok: false, error: String((result as any).error) };
        }

        // Otherwise wrap as success.
        return { ok: true, ...result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `Legacy tool "${name}" failed: ${message}`,
        };
      }
    },
  };
}

/**
 * Legacy adapters — EMPTY.
 *
 * All 19 tools (13 work + 6 code) are native ToolDefinitions.
 * The adaptLegacyTool function is retained for potential future use
 * (e.g. wrapping MCP server tools), but no legacy tools are registered.
 *
 * The legacy built-in-tools.ts and work-mode-tools.ts files have been
 * DELETED — they are no longer needed.
 */
const LEGACY_ADAPTERS: AnyToolDefinition[] = [];

/**
 * All tools, native + adapted. This is the master list.
 * As of Phase 4, LEGACY_ADAPTERS is empty — all tools are native.
 */
const ALL_TOOLS: AnyToolDefinition[] = [...NATIVE_TOOLS, ...LEGACY_ADAPTERS];

/**
 * Lookup map by name. Built once at module load for O(1) access.
 */
const TOOL_BY_NAME = new Map<string, AnyToolDefinition>(ALL_TOOLS.map((t) => [t.name, t]));

/**
 * Detect duplicate tool names at module load time.
 * If a duplicate is found, we throw — this is a developer error and
 * must be fixed before deploy. The check is cheap (one-time, ~30 entries).
 */
function assertNoDuplicateNames(tools: AnyToolDefinition[]): void {
  const seen = new Set<string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(
        `[tool-registry] Duplicate tool name "${tool.name}". ` +
          'Each tool must have a unique name. Check ALL_TOOLS in registry.ts.',
      );
    }

    seen.add(tool.name);
  }
}

assertNoDuplicateNames(ALL_TOOLS);

/**
 * Public registry API.
 */
export const toolRegistry = {
  /**
   * Get all tools available in a given mode, as AI SDK tool objects.
   *
   * The returned object can be spread directly into streamText({ tools }).
   * Each tool's execute() is pre-bound to the provided ToolContext via
   * closure (AI SDK v4 does not support toolContext — that's v5).
   *
   * The context is captured in each tool's closure, so all tools returned
   * from a single call share the same ctx for the duration of the request.
   */
  getToolsForMode(mode: ToolMode, ctx: ToolContext): Record<string, AiSdkTool> {
    const result: Record<string, AiSdkTool> = {};

    for (const tool of ALL_TOOLS) {
      if (!isToolAvailableInMode(tool, mode)) {
        continue;
      }

      result[tool.name] = toAiSdkTool(tool, ctx);
    }

    return result;
  },

  /**
   * Get a single ToolDefinition by name. Used by tests and by the
   * future custom-agents UI (where users compose tools into an agent).
   *
   * Returns undefined if the tool doesn't exist.
   */
  getToolByName(name: string): AnyToolDefinition | undefined {
    return TOOL_BY_NAME.get(name);
  },

  /**
   * List all tools with metadata (no execute function). Used by the
   * UI to render the tool picker for custom agents.
   */
  listAllTools(): Array<{
    name: string;
    description: string;
    availableIn: ReadonlyArray<ToolMode>;
  }> {
    return ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      availableIn: t.availableIn,
    }));
  },

  /**
   * List tools available in a given mode (metadata only).
   */
  listToolsForMode(mode: ToolMode): Array<{
    name: string;
    description: string;
  }> {
    return ALL_TOOLS.filter((t) => isToolAvailableInMode(t, mode)).map((t) => ({
      name: t.name,
      description: t.description,
    }));
  },

  /**
   * Total count of registered tools. Used in diagnostics.
   */
  get size(): number {
    return ALL_TOOLS.length;
  },
} as const;

/**
 * Re-export the resolveToolMode helper so callers can import everything
 * from the registry module without reaching into types.ts.
 */
export { resolveToolMode } from './types';
export type { ToolContext, ToolDefinition, ToolMode, ToolResult } from './types';
