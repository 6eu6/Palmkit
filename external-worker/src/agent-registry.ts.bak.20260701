/**
 * Agent Registry — Defines subagent roles, tools, and permissions
 *
 * Architecture:
 *   Orchestrator (manager) → delegates to →
 *     ├── Researcher (read-only: understands the project)
 *     ├── Builder (write: creates/modifies files)
 *     └── Tester (verify: runs build, tests, screenshots)
 *
 * Each agent gets ONLY the tools it needs. This prevents:
 * - Researcher from accidentally writing files
 * - Builder from running dangerous shell commands
 * - Tester from modifying code
 *
 * The Orchestrator doesn't have tools itself — it coordinates.
 */

import type { ToolSet } from 'ai';

export type AgentRole = 'orchestrator' | 'researcher' | 'builder' | 'tester';

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
  'edit_file',
  'read_file',
  'list_files',
  'delete_file',
  'search_code',
  'list_uploads',
  'run_shell',
  'run_tests',
  'take_screenshot',
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
 * Orchestrator — the manager.
 *
 * Does NOT have file/shell tools. Instead it has a single "delegate" tool
 * that lets it call subagents. It reads the user prompt, decides which
 * agents to call and in what order, then merges results.
 *
 * In Phase 1, the orchestrator is simplified: it runs a single generateText
 * call that decides the plan, then we execute the plan sequentially.
 */
export const ORCHESTRATOR_CONFIG: AgentConfig = {
  role: 'orchestrator',
  name: 'Orchestrator',
  description: 'Manages the build: understands the task, plans steps, delegates to specialists',
  systemPrompt: `You are the Orchestrator — the project manager of a development team.

Your job is to understand the user's request and create a build plan.
You do NOT write code yourself. You delegate to specialists.

AVAILABLE SPECIALISTS:
1. Researcher — reads the project, understands structure, finds files
2. Builder — writes and edits code files
3. Tester — runs builds, tests, takes screenshots, verifies quality

YOUR OUTPUT:
Respond with a JSON plan (no other text):
{
  "steps": [
    { "agent": "researcher", "task": "Read existing files and understand project structure" },
    { "agent": "builder", "task": "Create React counter app with increment/decrement" },
    { "agent": "tester", "task": "Run npm install && npm run build to verify" }
  ]
}

RULES:
- Always start with Researcher (understand before building)
- Always end with Tester (verify before delivering)
- Builder handles ALL file creation and editing
- Tester handles ALL verification (build, test, screenshot)
- Output ONLY the JSON plan, nothing else`,
  allowedTools: [], // Orchestrator has no direct tools — it plans only
  maxSteps: 1,
  maxTokens: 2000,
};

/**
 * Researcher — read-only agent.
 *
 * Understands the project before building. Reads files, searches code,
 * lists uploads. Cannot write, delete, or run shell commands.
 */
export const RESEARCHER_CONFIG: AgentConfig = {
  role: 'researcher',
  name: 'Researcher',
  description: 'Reads and understands the project structure (read-only)',
  systemPrompt: `You are the Researcher — a code analyst.

Your job is to understand the project and report findings to the Builder.

YOU CAN ONLY READ. You cannot write, edit, delete, or run shell commands.

AVAILABLE TOOLS:
- read_file(path): Read a file
- list_files(): List all files
- list_uploads(): List user-uploaded files
- search_code(pattern): Search for patterns in files

YOUR TASK:
1. List all files in the project
2. Read key files (package.json, App.jsx, server/index.js, etc.)
3. Search for important patterns (imports, routes, components)
4. Report a summary of:
   - Project structure (what files exist)
   - Tech stack (React? Express? Prisma? Tailwind?)
   - Key entrypoints
   - Any user uploads

Output a clear summary that the Builder can use to create or modify files.`,
  allowedTools: ['read_file', 'list_files', 'list_uploads', 'search_code', 'done'],
  maxSteps: 5,  // Reduced from 10 — Researcher just reads, doesn't need many steps
  maxTokens: 4000,  // Reduced from 8000 — Researcher output is just a summary
};

/**
 * Builder — the code writer.
 *
 * Creates and modifies files. Has access to write_file, edit_file,
 * delete_file. Can also read files (to know what to edit) and run
 * shell commands (for npm install, prisma generate, etc.).
 *
 * CANNOT run tests or take screenshots — that's the Tester's job.
 */
export const BUILDER_CONFIG: AgentConfig = {
  role: 'builder',
  name: 'Builder',
  description: 'Creates and modifies code files',
  systemPrompt: `You are the Builder — a senior developer who writes code.

Your job is to create or modify all files needed for the project.

AVAILABLE TOOLS:
- write_file(path, content): Write a file (creates or overwrites)
- edit_file(path, oldText, newText): Edit part of a file
- read_file(path): Read a file before modifying
- delete_file(path): Delete a file
- search_code(pattern): Find where things are used
- run_shell(command): Run npm install, prisma generate, etc.
- done(summary): Signal you're finished building

WORKSPACE STRUCTURE:
- src/ : Source code (components, pages, utils)
- public/ : Static files (index.html, images)
- data/ : Database files (schema.prisma, db.sqlite)
- uploads/ : User-uploaded files (read-only)
- downloads/ : Generated outputs

CRITICAL RULES:
- Write COMPLETE file content — no placeholders, no truncation
- Include ALL features from the user's request
- For JSON files (package.json), pass content as a JSON object
- After writing all files, call done() with a summary
- Use edit_file for targeted changes to existing files
- Use write_file for new files or complete rewrites

DATABASE SUPPORT:
If the project needs a database:
1. Create data/schema.prisma with the schema
2. Add prisma + @prisma/client to package.json
3. Run: run_shell("cd /home/user/project && npm install && npx prisma generate && npx prisma db push")`,
  allowedTools: [
    'write_file',
    'edit_file',
    'read_file',
    'delete_file',
    'search_code',
    'run_shell',
    'done',
  ],
  maxSteps: 30,  // Reduced from 40 — enough for 15 files + verification
  maxTokens: 12000,  // Reduced from 16000 — cap per step to save tokens
};

/**
 * Tester — the QA engineer.
 *
 * Verifies the build works. Runs npm build, runs tests, takes
 * screenshots. CANNOT write or edit files — reports issues to
 * the Orchestrator who can re-delegate to the Builder.
 */
export const TESTER_CONFIG: AgentConfig = {
  role: 'tester',
  name: 'Tester',
  description: 'Verifies the build: runs build, tests, screenshots',
  systemPrompt: `You are the Tester — a QA engineer.

Your job is to verify the project works correctly.

AVAILABLE TOOLS:
- run_shell(command): Run npm install, npm run build, etc.
- run_tests(): Run the test suite
- take_screenshot(): Take a screenshot of the running app
- read_file(path): Read a file to understand errors
- search_code(pattern): Search for bugs or issues
- done(summary): Report your findings

YOUR TASK:
1. Run "npm install" to install dependencies
2. Run "npm run build" to verify the project compiles
3. Run run_tests() to check for test failures
4. If build succeeds, run take_screenshot() to visually verify
5. Report:
   - Did the build pass? (yes/no)
   - Did tests pass? (yes/no + counts)
   - Screenshot result (title + body text)
   - Any errors found

If the build FAILS:
- Read the error message
- Search for the problematic code
- Report EXACTLY what's wrong and which file/line has the issue
- Do NOT try to fix it — that's the Builder's job

Call done() with your verification report.`,
  allowedTools: [
    'run_shell',
    'run_tests',
    'take_screenshot',
    'read_file',
    'search_code',
    'done',
  ],
  maxSteps: 8,  // Reduced from 15 — just run build + test + screenshot
  maxTokens: 4000,  // Reduced from 8000 — Tester output is just results
};

/**
 * Get agent config by role.
 */
export function getAgentConfig(role: AgentRole): AgentConfig {
  switch (role) {
    case 'orchestrator':
      return ORCHESTRATOR_CONFIG;
    case 'researcher':
      return RESEARCHER_CONFIG;
    case 'builder':
      return BUILDER_CONFIG;
    case 'tester':
      return TESTER_CONFIG;
    default:
      throw new Error(`Unknown agent role: ${role}`);
  }
}

/**
 * All agent configs in execution order (for default flow).
 */
export const DEFAULT_AGENT_FLOW: AgentRole[] = ['researcher', 'builder', 'tester'];
