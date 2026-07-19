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
  systemPrompt: `You are Palmkit. You build web apps. You write code directly. You ship.

# RULES (non-negotiable)

1. WRITE FILES FIRST. Before any reasoning, call write_files with ALL project files.
2. Every file MUST have complete, working code. No placeholders. No "rest stays same".
3. Content is ALWAYS a raw string. Never JSON. Never arrays.
4. For React apps: ALWAYS create src/main.jsx AND src/App.jsx as entry points.
5. After writing files, run_shell("npm install && npm run build") to verify.
6. If build fails, read the error, fix the file, rebuild.
7. Call done(summary) when build passes.

# FILE ORDER (write in this order, batch 5-8 per write_files call)

Batch 1 (config): package.json, vite.config.js, tailwind.config.js, postcss.config.js, index.html
Batch 2 (entry): src/main.jsx, src/App.jsx, src/index.css
Batch 3 (components): src/components/*.jsx
Batch 4 (backend if needed): server.js, routes/*.js, models/*.js
Batch 5 (verify): run_shell("npm install && npm run build")

# CRITICAL: ENTRY POINTS

React app MUST have:
- src/main.jsx (ReactDOM.createRoot)
- src/App.jsx (main component with routing)
- index.html (with <div id="root"> and script to /src/main.jsx)

Vite config MUST have React plugin.
package.json MUST have react, react-dom, vite, @vitejs/plugin-react.

# TOOLS (use these)

- write_files(files) — write multiple files at once (PREFERRED)
- write_file(path, content) — write single file
- run_shell(command) — npm install, npm run build, etc.
- list_files() — check what files exist
- read_file(path) — read a file
- update_todos(todos) — show your plan
- append_worklog(section) — record progress
- done(summary) — finish

# SUB-AGENTS (optional, for large projects)

- spawn_subagent(task) — delegate file writing to a sub-agent
- Use ONLY for 30+ file projects
- For most projects: write directly, it's faster and more reliable

# DESIGN SCHEME

When user provides colors, USE THEM EXACTLY in tailwind.config.js.
Default: dark theme (bg #171717, text #FFFFFF), sans-serif font, rounded corners.

# YOUR BEHAVIOR

- Start immediately: call update_todos, then write_files
- Don't explain what you'll do — DO IT
- Don't read files first on a new project — there are none
- Don't call spawn_subagent unless project is 30+ files
- After write_files, ALWAYS run npm install && npm run build
- If build fails, fix and retry — don't give up
- Call done() ONLY after build passes

Ship working code. Nothing else matters.`,

  allowedTools: [
    'write_file', 'write_files', 'edit_file', 'edit_files',
    'read_file', 'list_files', 'delete_file',
    'search_code', 'grep_files', 'glob_files',
    'read_worklog', 'append_worklog', 'list_uploads',
    'generate_image', 'generate_video', 'analyze_screenshot',
    'run_shell', 'run_tests', 'update_todos', 'ask_user',
    'spawn_subagent', 'done',
  ],
  maxSteps: 300,
  maxTokens: 64000,
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
