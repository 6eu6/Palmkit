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
}

/**
 * Read the worklog for a project. Returns null if not found.
 * The worklog is markdown text — the agent reads it as context.
 */
export async function readWorklog(projectId: string): Promise<string | null> {
  try {
    const key = buildWorklogKey(projectId);
    return await getFileText(key);
  } catch (e) {
    logger.warn(`[workspace] Failed to read worklog for ${projectId}: ${e}`);
    return null;
  }
}

/**
 * Append to the worklog. Used after each build to record what was done.
 * If the worklog doesn't exist, create it with a header.
 */
export async function appendToWorklog(projectId: string, entry: string): Promise<void> {
  try {
    const key = buildWorklogKey(projectId);
    const existing = (await getFileText(key)) || '';

    const timestamp = new Date().toISOString();
    const newEntry = `\n## ${timestamp}\n\n${entry}\n`;

    const updated = existing
      ? existing + newEntry
      : `# Project Worklog\n\nThis file is the project's memory. The AI agent reads it at the start of every build to understand context.\n${newEntry}`;

    await putFile(key, updated);
    logger.info(`[workspace] Appended to worklog for ${projectId} (${entry.length} chars)`);
  } catch (e) {
    logger.warn(`[workspace] Failed to append to worklog for ${projectId}: ${e}`);
  }
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
 */
export async function writeManifest(manifest: ProjectManifest): Promise<void> {
  try {
    const key = buildManifestKey(manifest.projectId);
    await putFile(key, JSON.stringify(manifest, null, 2));
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
 * Read a file from the workspace by relative path.
 */
export async function readWorkspaceFile(projectId: string, filePath: string): Promise<string | null> {
  try {
    const key = buildWorkspaceKey(projectId, filePath);
    return await getFileText(key);
  } catch (e) {
    logger.warn(`[workspace] Failed to read ${filePath} for ${projectId}: ${e}`);
    return null;
  }
}

/**
 * Write a file to the workspace by relative path.
 */
export async function writeWorkspaceFile(projectId: string, filePath: string, content: string): Promise<void> {
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
