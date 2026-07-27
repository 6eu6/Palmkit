/**
 * Orchestrator type definitions + constants.
 *
 * Extracted from orchestrator.ts during P4 decomposition.
 */

import type { AgentRole } from '../agent-registry';
import type { FileOperation } from '../project-spec';

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

  /**
   * Whether `npm run build` passed after generation. `null` when no build step
   * ran (static apps have no build). `true`/`false` for dynamic apps.
   * Drives ready_for_preview gating in job-processor.
   */
  buildVerified: boolean | null;
}

/** Fallback context window when the model's real limit isn't known. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;
