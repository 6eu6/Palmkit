/**
 * Workspace Manager — Unified per-project workspace in R2
 *
 * Each project gets a single workspace at:
 *   projects/{projectId}/workspace/
 *
 * The workspace contains:
 *   - worklog.md      : Agent memory (read at start of every build)
 *   - manifest.json   : Project metadata (appType, framework, lastBuild)
 *   - src/...         : Source files (the project itself)
 *   - uploads/        : User-uploaded files
 *   - downloads/      : Generated outputs (ZIP, PDF, etc.)
 *   - data/           : Database files (schema.prisma, db.sqlite)
 *
 * The worklog is the KEY innovation: it's the project's long-term memory.
 * Every build reads the worklog first (to understand context) and appends
 * to it at the end (to record what was done).
 */

import { putFile, getFileText, buildWorkspaceKey, buildWorklogKey, buildManifestKey, listObjects } from './r2-client';
import { logger } from './logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/*
 * ── M1: DISK-FIRST WORKSPACE ────────────────────────────────────────────
 *
 * Every project lives as a REAL directory on the worker's disk:
 *
 *   ~/palmkit-projects/{projectId}/
 *     ├── .git/            ← per-project version history (git-manager.ts)
 *     ├── Palmkit.md       ← project memory
 *     ├── .palmkit/        ← session.json, history.json, briefs
 *     └── src/…            ← the user's actual app
 *
 * The DISK is the source of truth for the agent (fast, atomic, git-able).
 * R2 stays as the DELIVERY + BACKUP layer — the Cloudflare app reads files
 * from R2, and a project claimed by a different worker box hydrates its
 * disk copy from R2 on first read. Writes go disk-first, then R2.
 */
const PROJECTS_DIR = process.env.PALMKIT_PROJECTS_DIR || path.join(os.homedir(), 'palmkit-projects');

/** Sanitized absolute directory for a project. */
export function projectDiskDir(projectId: string): string {
  const safe = String(projectId).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(PROJECTS_DIR, safe);
}

/** Resolve a relative file path inside the project dir, refusing escapes. */
function diskFilePath(projectId: string, relPath: string): string {
  const dir = projectDiskDir(projectId);
  const full = path.resolve(dir, relPath);

  if (full !== dir && !full.startsWith(dir + path.sep)) {
    throw new Error(`path escapes project dir: ${relPath}`);
  }

  return full;
}

/** Write a file to the project's disk dir (creates parent dirs). */
export async function writeProjectFileToDisk(projectId: string, relPath: string, content: string): Promise<void> {
  const full = diskFilePath(projectId, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
}

/** Read a file from the project's disk dir. Returns null when missing. */
export async function readProjectFileFromDisk(projectId: string, relPath: string): Promise<string | null> {
  try {
    return await fs.readFile(diskFilePath(projectId, relPath), 'utf8');
  } catch {
    return null;
  }
}

export interface ProjectManifest {
  projectId: string;
  appType: string | null;
  framework: string | null;
  createdAt: string;
  lastBuildAt: string | null;
  lastBuildSummary: string | null;
  fileCount: number;
  sandboxId: string | null;
  sandboxState: 'running' | 'paused' | null;
  /*
   * Smart manifest fields (2026-06-30 upgrade).
   * These give the agent a "map" of the project so it doesn't
   * have to read every file to understand the project.
   */
  schemaVersion?: number;
  projectType?: string; // e.g. "fullstack", "frontend", "static"
  stack?: {
    frontend?: string;
    backend?: string;
    database?: string;
    styling?: string;
  };
  entrypoints?: {
    frontend?: string;
    backend?: string;
    html?: string;
  };
  importantFiles?: string[];
  commands?: {
    install?: string;
    dev?: string;
    build?: string;
    test?: string;
    lint?: string;
  };
  apiRoutes?: string[];
  qualityGates?: {
    mustBuild?: boolean;
    mustPassTests?: boolean;
    mustAvoidPlaceholders?: boolean;
  };
  lastKnownStatus?: string; // "build_passed", "build_failed", "tests_passed", etc.
  knownIssues?: string[];
}

/**
 * .palmkit/ memory layer files.
 * These give the agent structured memory instead of just a short worklog.
 */
export interface PalmkitMemory {
  projectMd: string;        // Human-readable project description
  currentTask: string;      // What the agent should do now
  decisions: string;        // Why certain choices were made
  agentInstructions: string; // How the agent should work on this project
  apiMap: object | null;    // API routes and contracts
  fileMap: object | null;   // File → purpose mapping
  testResults: object | null; // Last test run results
  errors: string[];         // Recent errors
}

/**
 * Mirror a file to Supabase Storage so /api/workspace (which reads from
 * Supabase Storage, not R2 directly) can access it.
 *
 * The Supabase Storage key is: {userId}/projects/{projectId}/workspace/{path}
 * This matches what /api/workspace expects.
 */
async function mirrorToSupabaseStorage(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  filePath: string,
  content: string,
  contentType: string = 'text/plain',
): Promise<void> {
  try {
    const storageKey = `${userId}/projects/${projectId}/workspace/${filePath}`;
    const { error } = await supabase.storage.from('palmkit-files').upload(storageKey, content, {
      contentType,
      upsert: true,
    });

    if (error) {
      logger.warn(`[workspace] Supabase Storage mirror failed for ${filePath}: ${error.message}`);
    }
  } catch (e) {
    logger.warn(`[workspace] Supabase Storage mirror exception for ${filePath}: ${e}`);
  }
}

/**
 * Read the worklog for a project. Returns null if not found.
 * The worklog is markdown text — the agent reads it as context.
 */
export async function readWorklog(projectId: string): Promise<string | null> {
  // Disk-first via the workspace layer (worklog.md lives at the project root).
  return readWorkspaceFile(projectId, 'worklog.md');
}

/**
 * Append to the worklog. Used after each build to record what was done.
 * If the worklog doesn't exist, create it with a header.
 *
 * Also mirrors to Supabase Storage so /api/workspace can read it.
 */
export async function appendToWorklog(
  projectId: string,
  entry: string,
  supabase?: SupabaseClient,
  userId?: string,
): Promise<void> {
  try {
    const existing = (await readWorkspaceFile(projectId, 'worklog.md')) || '';

    const timestamp = new Date().toISOString();
    const newEntry = `\n## ${timestamp}\n\n${entry}\n`;

    let updated = existing
      ? existing + newEntry
      : `# Project Worklog\n\nThis file is the project's memory. The AI agent reads it at the start of every build to understand context.\n${newEntry}`;

    /*
     * MEMORY COMPACTION — when the worklog exceeds 12KB, compact the oldest
     * entries into a one-line summary each. This keeps the worklog useful for
     * long conversations (20+ edits) without overflowing the edit path's
     * context budget (6000 chars). Only the most recent 3 entries keep their
     * full text; everything older is reduced to a single line.
     *
     * Without this, a 20-edit conversation would produce a ~30KB worklog,
     * and the edit path (which slices the last 6000 chars) would lose ALL
     * early context. With compaction, the edit sees a one-line summary of
     * every past edit + full text of the last 3.
     */
    const COMPACTION_THRESHOLD = 12 * 1024;

    if (updated.length > COMPACTION_THRESHOLD) {
      updated = compactWorklog(updated);
    }

    await writeWorkspaceFile(projectId, 'worklog.md', updated);

    // Mirror to Supabase Storage so /api/workspace can read it
    if (supabase && userId) {
      await mirrorToSupabaseStorage(supabase, userId, projectId, 'worklog.md', updated, 'text/markdown');
    }

    logger.info(`[workspace] Appended to worklog for ${projectId} (${entry.length} chars, total ${updated.length})`);
  } catch (e) {
    logger.warn(`[workspace] Failed to append to worklog for ${projectId}: ${e}`);
  }
}

/*
 * Compact a worklog: keep the header + the last 3 entries in full, reduce
 * every older entry to its first non-empty line (the summary). This preserves
 * the "what was done" for every turn while dropping the verbose details that
 * only mattered at the time.
 */
function compactWorklog(worklog: string): string {
  const sections = worklog.split(/\n(?=## )/);

  if (sections.length <= 4) {
    return worklog; // header + 3 entries — nothing to compact
  }

  const header = sections[0];
  const entries = sections.slice(1);
  const keepFull = entries.slice(-3);
  const toCompact = entries.slice(0, -3);

  const compacted = toCompact
    .map((entry) => {
      const lines = entry.split('\n').filter((l) => l.trim().length > 0);
      const summary = lines.find((l) => !l.startsWith('## ')) || lines[0] || '(no summary)';

      return summary.slice(0, 120);
    })
    .join('\n');

  return `${header}\n\n## Compacted history (one line per edit):\n${compacted}\n\n${keepFull.join('\n\n')}`;
}

/**
 * Read the manifest for a project. Returns a default manifest if not found.
 */
export async function readManifest(projectId: string): Promise<ProjectManifest> {
  try {
    const key = buildManifestKey(projectId);
    const text = await getFileText(key);

    if (text) {
      return JSON.parse(text) as ProjectManifest;
    }
  } catch (e) {
    logger.warn(`[workspace] Failed to read manifest for ${projectId}: ${e}`);
  }

  return {
    projectId,
    appType: null,
    framework: null,
    createdAt: new Date().toISOString(),
    lastBuildAt: null,
    lastBuildSummary: null,
    fileCount: 0,
    sandboxId: null,
    sandboxState: null,
  };
}

/**
 * Write the manifest for a project.
 *
 * Also mirrors to Supabase Storage so /api/workspace can read it.
 */
export async function writeManifest(
  manifest: ProjectManifest,
  supabase?: SupabaseClient,
  userId?: string,
): Promise<void> {
  try {
    const key = buildManifestKey(manifest.projectId);
    const content = JSON.stringify(manifest, null, 2);
    await putFile(key, content);

    // Mirror to Supabase Storage so /api/workspace can read it
    if (supabase && userId) {
      await mirrorToSupabaseStorage(supabase, userId, manifest.projectId, 'manifest.json', content, 'application/json');
    }

    logger.info(`[workspace] Wrote manifest for ${manifest.projectId}`);
  } catch (e) {
    logger.warn(`[workspace] Failed to write manifest for ${manifest.projectId}: ${e}`);
  }
}

/**
 * List all files in a project's workspace.
 * Returns relative paths (e.g. "src/App.tsx", "worklog.md").
 */
export async function listWorkspaceFiles(projectId: string): Promise<string[]> {
  try {
    const prefix = `projects/${projectId}/workspace/`;
    const keys = await listObjects(prefix);
    // Strip the prefix to get relative paths
    return keys.map((k) => k.slice(prefix.length));
  } catch (e) {
    logger.warn(`[workspace] Failed to list workspace files for ${projectId}: ${e}`);
    return [];
  }
}

/**
 * Recursively list every file (relative path) under a Supabase Storage prefix.
 *
 * Supabase Storage's `list()` is single-level: folders come back as entries
 * whose `id` is null. We recurse into those to enumerate the whole tree.
 */
async function listStorageRecursive(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const { data, error } = await supabase.storage.from(bucket).list(dir, { limit: 1000 });

    if (error || !data) {
      return;
    }

    for (const entry of data) {
      const full = dir ? `${dir}/${entry.name}` : entry.name;
      const e = entry as { id: string | null; metadata: unknown };

      // A folder placeholder has null id/metadata — recurse into it.
      if (e.id === null || e.metadata === null) {
        await walk(full);
      } else {
        out.push(full);
      }
    }
  };

  await walk(prefix);

  // Return paths relative to the prefix.
  return out.map((p) => (p.startsWith(prefix + '/') ? p.slice(prefix.length + 1) : p));
}

/**
 * Hydrate a project's R2 workspace from its Supabase Storage mirror.
 *
 * The Oracle worker reads project files from R2 (via read_file's fallback and
 * readWorklog). But a *forked* project's workspace is created by the Cloudflare
 * `/api/fork-chat` route, which can only write to Supabase Storage — it has no
 * R2 credentials. So when the forked project's first build starts, R2 is empty
 * and the worker would treat it as a brand-new project (losing the copied files
 * and the handoff memory).
 *
 * This bridges that gap: if the project has NO worklog in R2 but DOES have a
 * workspace mirror in Supabase Storage, copy the whole mirror into R2 so the
 * normal continuation path (worklog present → Researcher runs; read_file finds
 * files; handoff.md injected) works exactly as it does for an in-place edit.
 *
 * Short-circuits (no-op) when:
 *   - R2 already has a worklog (normal edit / already hydrated), or
 *   - Supabase Storage has no mirror (genuinely new project).
 *
 * Returns the number of files hydrated.
 */
export async function hydrateWorkspaceFromStorage(
  projectId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<number> {
  try {
    // If R2 already has this project's worklog, it's not a cold forked workspace.
    const existingWorklog = await getFileText(buildWorklogKey(projectId));

    if (existingWorklog) {
      return 0;
    }

    const bucket = 'palmkit-files';
    const prefix = `${userId}/projects/${projectId}/workspace`;
    const relPaths = await listStorageRecursive(supabase, bucket, prefix);

    if (relPaths.length === 0) {
      return 0;
    }

    logger.info(`[workspace] Hydrating R2 from Supabase Storage for ${projectId}: ${relPaths.length} files`);

    let hydrated = 0;

    for (const rel of relPaths) {
      try {
        const { data, error } = await supabase.storage.from(bucket).download(`${prefix}/${rel}`);

        if (error || !data) {
          continue;
        }

        const text = await data.text();
        await putFile(buildWorkspaceKey(projectId, rel), text);
        hydrated++;
      } catch (e) {
        logger.warn(`[workspace] Hydrate failed for ${rel}: ${e}`);
      }
    }

    logger.info(`[workspace] Hydrated ${hydrated}/${relPaths.length} files into R2 for ${projectId}`);

    return hydrated;
  } catch (e) {
    logger.warn(`[workspace] hydrateWorkspaceFromStorage failed for ${projectId}: ${e}`);
    return 0;
  }
}

/**
 * Read a file from the workspace by relative path.
 *
 * M1: DISK-FIRST. The local project dir is the source of truth; R2 is the
 * fallback for projects that were built before M1 or on another worker box.
 * An R2 hit hydrates the disk copy so subsequent reads (and git) see it.
 */
export async function readWorkspaceFile(projectId: string, filePath: string): Promise<string | null> {
  const fromDisk = await readProjectFileFromDisk(projectId, filePath);

  if (fromDisk !== null) {
    return fromDisk;
  }

  try {
    const key = buildWorkspaceKey(projectId, filePath);
    const fromR2 = await getFileText(key);

    if (fromR2 !== null) {
      // Hydrate the disk copy (best-effort) so this box owns the file now.
      writeProjectFileToDisk(projectId, filePath, fromR2).catch(() => undefined);
    }

    return fromR2;
  } catch (e) {
    logger.warn(`[workspace] Failed to read ${filePath} for ${projectId}: ${e}`);
    return null;
  }
}

/**
 * Write a file to the workspace by relative path.
 *
 * M1: writes land on DISK first (source of truth), then R2 (delivery +
 * backup — the Cloudflare app serves files from R2). A disk failure does
 * not block the R2 write, and vice versa: memory + at least one layer is
 * always enough to finish a build.
 */
export async function writeWorkspaceFile(projectId: string, filePath: string, content: string): Promise<void> {
  try {
    await writeProjectFileToDisk(projectId, filePath, content);
  } catch (e) {
    logger.warn(`[workspace] Disk write failed for ${filePath} (${projectId}): ${e}`);
  }

  try {
    const key = buildWorkspaceKey(projectId, filePath);
    await putFile(key, content);
  } catch (e) {
    logger.warn(`[workspace] Failed to write ${filePath} for ${projectId}: ${e}`);
  }
}

/**
 * Generate the worklog entry for a completed build.
 * This is called after the agent finishes building.
 */
export function generateWorklogEntry(params: {
  prompt: string;
  fileCount: number;
  totalSize: number;
  summary?: string;
  appType?: string | null;
  duration: number;
}): string {
  const { prompt, fileCount, totalSize, summary, appType, duration } = params;

  const lines: string[] = [];
  lines.push(`**Build completed** (${(duration / 1000).toFixed(1)}s)`);
  lines.push('');
  lines.push(`- **Prompt**: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}`);
  lines.push(`- **Files**: ${fileCount}`);
  lines.push(`- **Size**: ${(totalSize / 1024).toFixed(1)} KB`);

  if (appType) {
    lines.push(`- **App type**: ${appType}`);
  }

  if (summary) {
    lines.push(`- **Summary**: ${summary}`);
  }

  return lines.join('\n');
}

// ═════════════════════════════════════════════════════════════════════
// .palmkit/ Memory Layer
// ═════════════════════════════════════════════════════════════════════

const PALMKIT_PREFIX = '.palmkit';

function buildPalmkitKey(projectId: string, filename: string): string {
  return buildWorkspaceKey(projectId, `${PALMKIT_PREFIX}/${filename}`);
}

/**
 * Read all .palmkit/ memory files for a project.
 * Returns null for any file that doesn't exist.
 */
export async function readPalmkitMemory(projectId: string): Promise<PalmkitMemory> {
  const read = async (filename: string): Promise<string> => {
    try {
      return (await readWorkspaceFile(projectId, `${PALMKIT_PREFIX}/${filename}`)) || '';
    } catch {
      return '';
    }
  };

  const readJson = async (filename: string): Promise<object | null> => {
    try {
      const text = await read(filename);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };

  const [projectMd, currentTask, decisions, agentInstructions, apiMap, fileMap, testResults, errorsText] =
    await Promise.all([
      read('project.md'),
      read('current-task.md'),
      read('decisions.md'),
      read('agent-instructions.md'),
      readJson('api-map.json'),
      readJson('file-map.json'),
      readJson('test-results.json'),
      read('errors.json'),
    ]);

  let errors: string[] = [];

  try {
    errors = errorsText ? JSON.parse(errorsText) : [];
  } catch {
    errors = [];
  }

  return { projectMd, currentTask, decisions, agentInstructions, apiMap, fileMap, testResults, errors };
}

/**
 * Write a .palmkit/ memory file.
 */
export async function writePalmkitFile(
  projectId: string,
  filename: string,
  content: string,
  supabase?: SupabaseClient,
  userId?: string,
): Promise<void> {
  try {
    await writeWorkspaceFile(projectId, `${PALMKIT_PREFIX}/${filename}`, content);

    if (supabase && userId) {
      await mirrorToSupabaseStorage(supabase, userId, projectId, `${PALMKIT_PREFIX}/${filename}`, content);
    }
  } catch (e) {
    logger.warn(`[workspace] Failed to write .palmkit/${filename}: ${e}`);
  }
}

/**
 * Generate a smart manifest from the build results.
 * This gives the agent a "map" of the project.
 */
export function generateSmartManifest(params: {
  projectId: string;
  appType: string | null;
  files: Record<string, string>;
  prompt: string;
  summary?: string;
}): Partial<ProjectManifest> {
  const { projectId, appType, files, prompt, summary } = params;
  const filePaths = Object.keys(files);

  // Detect stack from files
  const hasReact = filePaths.some((p) => p.endsWith('.jsx') || p.endsWith('.tsx'));
  const hasVue = filePaths.some((p) => p.endsWith('.vue'));
  const hasExpress = filePaths.some((p) => p.includes('server/') || p.includes('express'));
  const hasPrisma = filePaths.some((p) => p.endsWith('.prisma') || p.includes('prisma'));
  const hasTailwind = filePaths.some((p) => p.includes('tailwind'));
  const hasVite = filePaths.some((p) => p.includes('vite.config'));

  // Detect entrypoints
  const frontendEntry = filePaths.find((p) => p.match(/src\/main\.(jsx|tsx|js|ts)$/));
  const backendEntry = filePaths.find((p) => p.match(/server\/index\.(js|ts)$/));
  const htmlEntry = filePaths.find((p) => p === 'index.html' || p === 'public/index.html');

  // Detect API routes from server code
  const apiRoutes: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (path.includes('server/') && path.endsWith('.js')) {
      const routeMatches = content.matchAll(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/gi);
      for (const match of routeMatches) {
        apiRoutes.push(`${match[1].toUpperCase()} ${match[2]}`);
      }
    }
  }

  // Detect commands from package.json
  const packageJson = files['package.json'];

  let commands: ProjectManifest['commands'] = { install: 'npm install' };

  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const scripts = pkg.scripts || {};
      commands = {
        install: 'npm install',
        dev: scripts.dev || undefined,
        build: scripts.build || undefined,
        test: scripts.test || undefined,
        lint: scripts.lint || undefined,
      };
    } catch {
      // best-effort
    }
  }

  // Determine project type
  const projectType = hasExpress && hasReact ? 'fullstack' : hasReact ? 'frontend' : 'static';

  return {
    schemaVersion: 1,
    projectId,
    appType,
    projectType,
    stack: {
      frontend: hasReact ? 'React' : hasVue ? 'Vue' : undefined,
      backend: hasExpress ? 'Express' : undefined,
      database: hasPrisma ? 'Prisma + SQLite' : undefined,
      styling: hasTailwind ? 'Tailwind CSS' : undefined,
    },
    entrypoints: {
      frontend: frontendEntry,
      backend: backendEntry,
      html: htmlEntry,
    },
    importantFiles: filePaths
      .filter((p) => p.match(/(App|index|server|schema|package\.json|vite\.config)/i))
      .slice(0, 10),
    commands,
    apiRoutes: apiRoutes.length > 0 ? apiRoutes : undefined,
    qualityGates: {
      mustBuild: hasVite,
      mustPassTests: false,
      mustAvoidPlaceholders: true,
    },
    lastKnownStatus: 'build_passed',
    knownIssues: [],
    fileCount: filePaths.length,
    lastBuildSummary: summary?.slice(0, 200) || null,
  };
}

/**
 * Generate .palmkit/ memory files from the build results.
 * Called after the agent finishes building.
 */
export async function writePalmkitMemory(
  projectId: string,
  params: {
    prompt: string;
    files: Record<string, string>;
    appType: string | null;
    summary?: string;
    manifest: Partial<ProjectManifest>;
  },
  supabase?: SupabaseClient,
  userId?: string,
): Promise<void> {
  const { prompt, files, appType, summary, manifest } = params;

  // project.md — human-readable project description
  const projectMd = [
    `# Project: ${manifest.projectType || 'Unknown'}`,
    '',
    `**Type**: ${manifest.projectType || 'N/A'}`,
    `**Stack**: ${manifest.stack?.frontend || ''} ${manifest.stack?.backend || ''} ${manifest.stack?.database || ''}`.trim(),
    `**App Type**: ${appType || 'N/A'}`,
    `**Files**: ${Object.keys(files).length}`,
    '',
    '## Entrypoints',
    `- Frontend: ${manifest.entrypoints?.frontend || 'N/A'}`,
    `- Backend: ${manifest.entrypoints?.backend || 'N/A'}`,
    `- HTML: ${manifest.entrypoints?.html || 'N/A'}`,
    '',
    '## Commands',
    Object.entries(manifest.commands || {})
      .map(([k, v]) => `- ${k}: \`${v}\``)
      .join('\n'),
    '',
    '## API Routes',
    (manifest.apiRoutes || []).map((r) => `- ${r}`).join('\n'),
    '',
    '## Original Prompt',
    prompt.slice(0, 500),
  ].join('\n');

  await writePalmkitFile(projectId, 'project.md', projectMd, supabase, userId);

  // decisions.md — why certain choices were made
  const decisionsMd = [
    '# Decisions Log',
    '',
    `## ${new Date().toISOString()}`,
    `- **Framework**: ${manifest.stack?.frontend || 'N/A'} — chosen based on user prompt`,
    `- **Backend**: ${manifest.stack?.backend || 'None'} — ${hasExpress(files) ? 'needed for API' : 'not required'}`,
    `- **Database**: ${manifest.stack?.database || 'None'} — ${hasPrisma(files) ? 'user requested persistence' : 'not required'}`,
    `- **Styling**: ${manifest.stack?.styling || 'CSS'} — standard choice for this stack`,
  ].join('\n');

  await writePalmkitFile(projectId, 'decisions.md', decisionsMd, supabase, userId);

  // agent-instructions.md — how the agent should work on this project
  const agentInstructions = [
    '# Agent Instructions',
    '',
    '## Work Cycle (MANDATORY)',
    '1. Read .palmkit/current-task.md to understand what to do',
    '2. Read .palmkit/manifest.json for project map',
    '3. Read only the files you need to modify (use importantFiles list)',
    '4. Write a brief plan before editing',
    '5. Apply changes with write_file',
    '6. Run tests/build with run_shell to verify',
    '7. Update .palmkit/test-results.json with results',
    '8. Update .palmkit/current-task.md with what was done',
    '',
    '## Project Rules',
    `- This is a ${manifest.projectType || 'unknown'} project`,
    `- Entry point: ${manifest.entrypoints?.frontend || manifest.entrypoints?.html || 'unknown'}`,
    `- Build command: ${manifest.commands?.build || 'npm run build'}`,
    `- Test command: ${manifest.commands?.test || 'npm test'}`,
    '',
    '## Quality Gates',
    `- Must build: ${manifest.qualityGates?.mustBuild ? 'YES' : 'NO'}`,
    `- Must pass tests: ${manifest.qualityGates?.mustPassTests ? 'YES' : 'NO'}`,
    `- Must avoid placeholders: YES`,
  ].join('\n');

  await writePalmkitFile(projectId, 'agent-instructions.md', agentInstructions, supabase, userId);

  // api-map.json — API routes and contracts
  if (manifest.apiRoutes && manifest.apiRoutes.length > 0) {
    const apiMap: Record<string, { method: string; path: string }> = {};
    for (const route of manifest.apiRoutes) {
      const [method, path] = route.split(' ');
      apiMap[route] = { method, path };
    }
    await writePalmkitFile(projectId, 'api-map.json', JSON.stringify(apiMap, null, 2), supabase, userId);
  }

  // file-map.json — file → purpose mapping
  const fileMap: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    let purpose = 'unknown';
    if (path.endsWith('.jsx') || path.endsWith('.tsx')) {
      purpose = content.includes('export default') ? 'React component' : 'React module';
    } else if (path.endsWith('.prisma')) {
      purpose = 'Prisma database schema';
    } else if (path.includes('server/')) {
      purpose = 'Backend server code';
    } else if (path === 'package.json') {
      purpose = 'Project dependencies and scripts';
    } else if (path.endsWith('.css')) {
      purpose = 'Stylesheet';
    } else if (path.endsWith('.html')) {
      purpose = 'HTML entry point';
    } else if (path.includes('vite.config')) {
      purpose = 'Vite build configuration';
    }
    fileMap[path] = purpose;
  }
  await writePalmkitFile(projectId, 'file-map.json', JSON.stringify(fileMap, null, 2), supabase, userId);

  // errors.json — empty initially
  await writePalmkitFile(projectId, 'errors.json', JSON.stringify([], null, 2), supabase, userId);

  // test-results.json — empty initially
  await writePalmkitFile(projectId, 'test-results.json', JSON.stringify({ ran: false, passed: 0, failed: 0 }, null, 2), supabase, userId);

  logger.info(`[workspace] .palmkit/ memory layer written for ${projectId}`);
}

/**
 * Palmkit.md — the project's single memory file, written at the workspace
 * root after every build and injected into the agent's context at session
 * start. It is the product-branded equivalent of a repo's agent memory file:
 * one compact page that tells the agent (and the user) what this project IS —
 * stack, entrypoints, commands, state, and history.
 */
export async function writePalmkitProjectMemory(
  projectId: string,
  params: {
    prompt: string;
    files: Record<string, string>;
    appType: string | null;
    summary?: string;
    manifest: Partial<ProjectManifest>;
    buildVerified: boolean | null;
    success: boolean;
  },
  supabase?: SupabaseClient,
  userId?: string,
): Promise<void> {
  try {
    const { prompt, files, appType, summary, manifest, buildVerified, success } = params;
    const filePaths = Object.keys(files).sort();

    // Carry forward the History section from the previous Palmkit.md.
    const prev = await readWorkspaceFile(projectId, 'Palmkit.md');
    let history: string[] = [];

    if (prev) {
      const m = prev.match(/## History\n([\s\S]*?)(\n## |$)/);

      if (m) {
        history = m[1].split('\n').filter((l) => l.trim().startsWith('- '));
      }
    }

    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const status = success ? (buildVerified === true ? 'built & verified' : 'built') : 'partial';
    history.push(`- ${stamp} — ${status}: ${prompt.slice(0, 110).replace(/\n/g, ' ')}${prompt.length > 110 ? '…' : ''}`);

    // Keep the last 15 history lines.
    history = history.slice(-15);

    const stackLine = [
      manifest.stack?.frontend,
      manifest.stack?.backend,
      manifest.stack?.database,
      manifest.stack?.styling,
    ]
      .filter(Boolean)
      .join(' + ');

    const content = [
      `# Palmkit.md`,
      '',
      `> Project memory — written by the Palmkit agent after every build. Read at session start.`,
      '',
      `## Project`,
      `- Type: ${manifest.projectType || appType || 'unknown'}`,
      `- Stack: ${stackLine || 'n/a'}`,
      `- Files: ${filePaths.length}`,
      `- Last build: ${stamp} (${status})`,
      '',
      `## Entrypoints`,
      `- HTML: ${manifest.entrypoints?.html || 'n/a'}`,
      `- Frontend: ${manifest.entrypoints?.frontend || 'n/a'}`,
      `- Backend: ${manifest.entrypoints?.backend || 'n/a'}`,
      '',
      `## Commands`,
      ...Object.entries(manifest.commands || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `- ${k}: \`${v}\``),
      '',
      `## Key Files`,
      ...(manifest.importantFiles || filePaths.slice(0, 10)).map((p) => `- ${p}`),
      '',
      ...(summary ? [`## Last Build Summary`, summary.slice(0, 600), ''] : []),
      `## History`,
      ...history,
      '',
    ].join('\n');

    await writeWorkspaceFile(projectId, 'Palmkit.md', content);

    if (supabase && userId) {
      await mirrorToSupabaseStorage(supabase, userId, projectId, 'Palmkit.md', content, 'text/markdown');
    }

    logger.info(`[workspace] Palmkit.md updated for ${projectId} (${content.length} chars)`);
  } catch (e) {
    logger.warn(`[workspace] Failed to write Palmkit.md for ${projectId}: ${e}`);
  }
}

// Helper functions for manifest generation
function hasExpress(files: Record<string, string>): boolean {
  return Object.keys(files).some((p) => p.includes('server/') || p.includes('express'));
}

function hasPrisma(files: Record<string, string>): boolean {
  return Object.keys(files).some((p) => p.endsWith('.prisma') || p.includes('prisma'));
}
