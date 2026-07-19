/**
 * Agent Registry — ONE agent, one constitution.
 *
 * The old registry carried four scripted roles (Researcher → Planner →
 * Builder → Tester) with numbered-ritual prompts and a hardcoded pipeline.
 * None of it survived contact with reality: the flow has been ['brain']
 * for a long time, and the role branches were dead weight steering the
 * model with rails instead of trusting it.
 *
 * What remains is the Palmkit agent and a principles-based system prompt:
 * context and constraints the model can't infer, not step-by-step scripts.
 * Intent (question vs build vs edit) is the MODEL's judgment — nothing is
 * pre-classified. Mechanical safety lives in the runtime, not in prose.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * RADICAL REBUILD — mirrors how Z.ai Code's own agent works:
 *   • Principles, not scripts. The model decides batch size, strategy,
 *     when to use sub-agents, when to verify.
 *   • Full tool freedom. No tool is "disabled". spawn_subagent is a
 *     first-class tool the model uses whenever it wants.
 *   • Active worklog. The model reads the worklog at the start and
 *     appends to it after each phase — exactly like Z.ai Code's
 *     /home/z/my-project/worklog.md pattern.
 *   • No micro-management. No forced "minimal App.jsx first", no forced
 *     "3-4 files per batch". The model is trusted to judge.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { ToolSet } from 'ai';

export type AgentRole = 'brain';

export interface AgentConfig {
  role: AgentRole;
  name: string;
  description: string;
  systemPrompt: string;

  /** Tools this agent is allowed to use (subset of all tools) */
  allowedTools: string[];

  /** Max steps for this agent's LLM call */
  maxSteps: number;

  /** Max tokens per step */
  maxTokens: number;
}

/**
 * All available tool names (must match agent-tools.ts)
 */
export const ALL_TOOL_NAMES = [
  'write_file',
  'write_files',
  'edit_file',
  'edit_files',
  'read_file',
  'list_files',
  'delete_file',
  'search_code',
  'grep_files',
  'glob_files',
  'read_worklog',
  'append_worklog',
  'list_uploads',
  'generate_image',
  'generate_video',
  'analyze_screenshot',
  'run_shell',
  'run_tests',
  'update_todos',
  'ask_user',
  'spawn_subagent',
  'done',
] as const;

/**
 * Filter a toolset to only include allowed tools for an agent.
 */
export function filterTools(allTools: ToolSet, allowedNames: string[]): ToolSet {
  const filtered: ToolSet = {};

  for (const name of allowedNames) {
    if (allTools[name]) {
      filtered[name] = allTools[name];
    }
  }

  return filtered;
}

/**
 * Palmkit — the agent. A principles prompt: who it is, what it can trust,
 * what the platform guarantees, and the few constraints that are real.
 *
 * This mirrors Z.ai Code's approach: the model gets context + tools +
 * principles, then decides everything itself. No step-by-step scripts,
 * no forced batch sizes, no disabled tools.
 */
export const BRAIN_CONFIG: AgentConfig = {
  role: 'brain',
  name: 'Palmkit',
  description: 'The Palmkit development agent — direct, fast, ships working code',
  systemPrompt: `You are Palmkit, the AI development agent. You build complete, working web apps.

# HOW YOU WORK

1. Plan briefly with update_todos (1 call, then move on)
2. Write ALL files in ONE write_files call — config, entry points, components, everything
3. Run npm install && npm run build to verify
4. If build fails, read the error, fix the file, rebuild
5. Call done() when the build passes

# RULES

- File content is ALWAYS a raw string (never JSON)
- Every file is COMPLETE and working — no placeholders
- For React: ALWAYS create src/main.jsx, src/App.jsx, and index.html
- package.json MUST have: react, react-dom, vite, @vitejs/plugin-react, tailwindcss
- vite.config.js MUST have React plugin
- After writing files, ALWAYS run "npm install && npm run build"
- Call done() ONLY after build passes — never claim success without verifying

# STACK

Default: React 18 + Vite + Tailwind. Match the user's request if they specify otherwise.
Dark theme by default. Use the user's color scheme if provided.

Ship working code. Nothing else matters.`,

  allowedTools: [
    'write_file', 'write_files', 'edit_file', 'edit_files',
    'read_file', 'list_files', 'delete_file',
    'search_code', 'grep_files', 'glob_files',
    'read_worklog', 'append_worklog', 'list_uploads',
    'generate_image', 'generate_video', 'analyze_screenshot',
    'run_shell', 'run_tests', 'update_todos', 'ask_user',
    'done',
    // spawn_subagent REMOVED — direct writing is faster and more reliable
  ],
  maxSteps: 50, // Natural multi-step: todos + write_files(all) + npm install + done = ~4 steps
  maxTokens: 64000, // Full context for large projects
};

/**
 * Get agent config by role. One agent — kept as a function so call sites
 * stay stable.
 */
export function getAgentConfig(role: AgentRole): AgentConfig {
  if (role === 'brain') {
    return BRAIN_CONFIG;
  }

  throw new Error(`Unknown agent role: ${role}`);
}

/**
 * The agent flow: the Palmkit agent, alone. It decides everything else.
 */
export const DEFAULT_AGENT_FLOW: AgentRole[] = ['brain'];
