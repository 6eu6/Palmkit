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
  'update_todos',
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
  allowedTools: ['read_file', 'list_files', 'list_uploads', 'search_code', 'update_todos', 'done'],
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

Your job is to create ALL files needed for the project. A project with missing files is USELESS — the preview will not work.

AVAILABLE TOOLS:
- write_file(path, content): Write a file (creates or overwrites)
- edit_file(path, oldText, newText): Edit part of a file
- read_file(path): Read a file before modifying
- delete_file(path): Delete a file
- search_code(pattern): Find where things are used
- run_shell(command): Run npm install, prisma generate, etc.
- done(summary): Signal you're finished building

REQUIRED FILES BY PROJECT TYPE — you MUST create ALL of these before calling done():
For React + Vite projects (MOST COMMON):
  1. package.json (with react, react-dom, vite, @vitejs/plugin-react, tailwindcss)
  2. index.html (Vite entry point with <div id="root"> and <script src="/src/main.jsx">)
  3. vite.config.js (with react plugin)
  4. src/main.jsx (React entry: ReactDOM.createRoot)
  5. src/App.jsx (Main component with ALL features from the user's request)
  6. src/index.css (Tailwind directives: @tailwind base/components/utilities)
  7. tailwind.config.js (content paths)
  8. postcss.config.js (tailwindcss + autoprefixer plugins)
For TypeScript projects, use .tsx/.ts extensions instead of .jsx/.js.

CRITICAL: Do NOT call done() until you have written index.html AND the main
source file (src/App.jsx or src/App.tsx). Without these, the preview CANNOT
work. If you call done() after only writing package.json + config files,
the build will be REJECTED as incomplete.

CRITICAL RULES:
- Write COMPLETE file content — no placeholders, no truncation
- Include ALL features from the user's request
- For JSON files (package.json), pass content as a JSON object
- Use edit_file for targeted changes to existing files
- Use write_file for new files or complete rewrites

DONE() IS MANDATORY: After writing ALL files, you MUST call the done() tool
with a brief summary. Do NOT keep making tool calls forever. The pattern is:
  1. Call update_todos with your plan (all items "pending" except first "in_progress")
  2. For each file: write_file → update_todos (mark item "done", next "in_progress")
  3. After the last file: call done(summary="...")
If you have written all needed files and verified they look right, STOP and
call done(). Do not run extra verification steps you weren't asked for.

WORKFLOW WITH update_todos (IMPORTANT — call this often):
1. AT THE START: call update_todos with your full plan as a list of items, all marked "pending" except the first one which is "in_progress".
2. AFTER completing each item: call update_todos again with that item flipped to "done" and the next item flipped to "in_progress".
3. AT THE END: call update_todos one final time with all items "done".

This gives the user a live checklist of what you're working on. Without it, the user only sees file events and can't tell what phase you're in.

Example todos for a React app:
- "Set up project structure (package.json, vite config, tsconfig)"
- "Create index.html entry point"
- "Build main App component with routing"
- "Create UI components (header, footer, navigation)"
- "Implement feature: authentication flow"
- "Add styles with Tailwind CSS"
- "Verify build with npm run build"

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
    'update_todos',
    'done',
  ],
  maxSteps: 80,  // Was 50 — GLM-4.7/5.x tend to not call done() proactively,
                 // so we need more steps to let the build complete naturally.
                 // 80 is enough for 15-20 file projects with verification.
  maxTokens: 32000,  // Was 12000 — capped even 128K-token models at 12K, truncating large files. 32K is a safe floor that lets the model write complete files in a single step.
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

⚠️ CRITICAL — THE SANDBOX DOES NOT PERSIST BETWEEN run_shell CALLS.
Each run_shell starts a FRESH sandbox with your project files but WITHOUT the
node_modules from any previous call. If you run "npm install" and then
"npm run build" as TWO separate run_shell calls, the second runs in a brand-new
sandbox with no node_modules and fails with "vite: not found". You MUST chain
everything into ONE command with &&.

YOUR TASK (do it in as few steps as possible — this saves tokens):
1. Run ONE combined command to install and build:
   run_shell("cd /home/user/project && npm install && npm run build")
   If it exits 0, the build PASSES — that is your primary verification.
2. Only if the build FAILS: read the failing file to identify the exact
   error and which file/line is wrong. Do NOT retry the build more than once.
   Do NOT try to fix it — that's the Builder's job.
3. Call done() with: build pass/fail, the error (if any), and a one-line summary.

DO NOT run "npm install" and "npm run build" as separate run_shell calls.
DO NOT run exploratory commands like "ls node_modules" — they run in throwaway
sandboxes and tell you nothing. One combined build command is all you need.

WORKFLOW WITH update_todos:
1. AT THE START: call update_todos with your verification plan as items, all "pending" except the first which is "in_progress".
2. AFTER completing each verification step: call update_todos with that item "done" and next item "in_progress".
3. AT THE END: call update_todos with all items "done".

Example Tester todos (keep it short — one combined build command):
- "Run combined install+build to verify compilation"
- "Report verification results"`,
  allowedTools: [
    'run_shell',
    'run_tests',
    'take_screenshot',
    'read_file',
    'search_code',
    'update_todos',
    'done',
  ],
  /*
   * Capped at 6 (was 15). With the single combined install+build command the
   * Tester needs only: update_todos → run combined build → (optional read on
   * failure) → done. The old value of 15 let a confused Tester flail through a
   * dozen throwaway-sandbox commands (npm install, vite build, ls node_modules…)
   * burning ~125s and thousands of tokens before hitting the step limit.
   */
  maxSteps: 6,
  maxTokens: 8000, // Tester reports need space for error logs.
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
