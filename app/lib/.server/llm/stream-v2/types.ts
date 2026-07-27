/**
 * Stream v2 — Event Type Definitions
 * ==================================
 *
 * Unified event types for the entire stream system. Both server and
 * client use these types — no more guessing what payload shape to expect.
 *
 * Design principles:
 *   1. Every event has a `type` discriminant + mode-specific payload
 *   2. Events are serializable (no functions, no class instances)
 *   3. The client can render ANY event without mode knowledge —
 *      mode only affects WHICH events the server sends, not HOW
 *      the client renders them
 *   4. Backward compatible: unknown event types fall back to raw JSON
 */

/**
 * The three stream modes. Determined by (chatMode, sidebarMode):
 *   chat  → chatMode='discuss', sidebarMode='chat'
 *   work  → chatMode='discuss', sidebarMode='work'
 *   code  → chatMode='build',   sidebarMode='code'
 */
export type StreamMode = 'chat' | 'work' | 'code';

/**
 * Progress annotation — tells the client what phase the stream is in.
 *
 * This is the ONLY event type that carries a `status` field. The client
 * uses it to update the progress bar / status indicator.
 *
 * Phases by mode:
 *   chat: thinking → responding → complete
 *   work: thinking → tool-calling → responding → complete
 *   code: planning → building → validating → ready_for_preview → complete
 */
export interface ProgressEvent {
  type: 'progress';
  label: string;
  status: 'in-progress' | 'complete' | 'error';
  order: number;
  message: string;
}

/**
 * Text delta — a chunk of assistant text (markdown).
 *
 * In the AI SDK data stream protocol, this is `0:"text chunk"`.
 * The client accumulates these into the assistant message content.
 */
export interface TextDeltaEvent {
  type: 'text-delta';
  text: string;
}

/**
 * Tool call — the LLM decided to call a tool.
 *
 * This is emitted BEFORE the tool executes. The client can show
 * "Calling web_search..." while waiting for the result.
 */
export interface ToolCallEvent {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Tool result — the tool finished executing.
 *
 * The client renders this using the ToolResultRenderer (which picks
 * the right rich UI component: chart, PDF preview, table, etc.).
 */
export interface ToolResultEvent {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  result: unknown;
}

/**
 * Build event — ONLY in code mode.
 *
 * These events carry structured build progress: files written, commands
 * run, screenshots taken, build status. They're emitted by the
 * orchestrator/worker and processed by the build timeline renderer.
 *
 * In chat/work modes, NO build events are emitted — the client never
 * sees them, so the build timeline doesn't render.
 */
export interface BuildEvent {
  type: 'build-event';
  subtype:
    | 'file-written'
    | 'command-run'
    | 'screenshot-taken'
    | 'build-summary'
    | 'orchestrator-task'
    | 'ready-for-preview'
    | 'build-failed';
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * Validation event — ONLY in code mode.
 *
 * After the LLM finishes generating, the validator checks completeness.
 * The client uses this to show "Build complete ✓" or "Build incomplete,
 * retrying...".
 */
export interface ValidationEvent {
  type: 'validation';
  completeness: 'complete' | 'incomplete' | 'garbage' | 'invalid';
  jobStatus: string;
  issues: Array<{ code: string; message: string }>;
  retryCount: number;
  fileCount: number;
}

/**
 * Error event — stream failed.
 *
 * The client shows a user-friendly error message and stops the stream.
 */
export interface ErrorEvent {
  type: 'error';
  message: string;
  recoverable: boolean;
  hint?: string;
}

/**
 * Complete event — stream finished successfully.
 *
 * The client stops the loading indicator and enables the input.
 */
export interface CompleteEvent {
  type: 'complete';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Union of all stream events.
 */
export type StreamEvent =
  | ProgressEvent
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | BuildEvent
  | ValidationEvent
  | ErrorEvent
  | CompleteEvent;

/**
 * Mode-specific behavior configuration.
 *
 * The server reads this to decide:
 *   - Which tools to enable (already handled by toolRegistry)
 *   - Whether to run validation (code mode only)
 *   - Whether to run the orchestrator (code mode only)
 *   - Which system prompt to use (discussPrompt for chat/work, build prompt for code)
 *   - What the "complete" state means (response done vs build done)
 */
export interface StreamModeConfig {
  mode: StreamMode;

  /** Run output validation after generation (code mode only). */
  validate: boolean;

  /** Run build orchestrator for complex prompts (code mode only). */
  orchestrate: boolean;

  /** Use discussPrompt instead of build prompt (chat/work). */
  discussMode: boolean;

  /** Enable file tools (read_file, list_files, grep) — code mode only. */
  enableFileTools: boolean;

  /** Enable sandbox tools (run_shell, screenshot) — code mode only. */
  enableSandboxTools: boolean;

  /** Max LLM steps (tool calls). Work=15, code=15, chat=5. */
  maxSteps: number;
}

/**
 * Resolve (chatMode, sidebarMode) → StreamModeConfig.
 *
 * Centralizes ALL mode-specific behavior in one place. The stream
 * orchestration code reads this config — no scattered if/else checks.
 */
export function resolveStreamModeConfig(
  chatMode: 'discuss' | 'build',
  sidebarMode?: 'chat' | 'work' | 'code',
): StreamModeConfig {
  if (chatMode === 'build') {
    return {
      mode: 'code',
      validate: true,
      orchestrate: true,
      discussMode: false,
      enableFileTools: true,
      enableSandboxTools: true,
      maxSteps: 15,
    };
  }

  if (sidebarMode === 'work') {
    return {
      mode: 'work',
      validate: false,
      orchestrate: false,
      discussMode: true,
      enableFileTools: false,
      enableSandboxTools: false,
      maxSteps: 15,
    };
  }

  // chat mode (default)
  return {
    mode: 'chat',
    validate: false,
    orchestrate: false,
    discussMode: true,
    enableFileTools: false,
    enableSandboxTools: false,
    maxSteps: 5,
  };
}
