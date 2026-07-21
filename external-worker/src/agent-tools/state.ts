/**
 * Per-job in-memory state management.
 *
 * Extracted from agent-tools.ts during P4 decomposition.
 *
 * CRITICAL: all maps MUST be keyed by jobId. They used to be a single
 * module-level Map shared by every build the long-running worker processed.
 * When two builds ran concurrently they wrote into the SAME map, so one
 * user's files leaked into another user's project. Scoping per-job fully
 * isolates concurrent builds.
 */

import type { BuildResult } from './types';

// ─── Per-job file stores ────────────────────────────────────────────
const jobFileMaps = new Map<string, Map<string, string>>();

export function getJobFiles(jobId: string): Map<string, string> {
  let m = jobFileMaps.get(jobId);
  if (!m) {
    m = new Map<string, string>();
    jobFileMaps.set(jobId, m);
  }
  return m;
}

export function resetProjectFiles(jobId: string): void {
  getJobFiles(jobId).clear();
  jobWriteCounts.delete(jobId);
  jobScreenshotCounts.delete(jobId);
}

export function getProjectFiles(jobId: string): Record<string, string> {
  return Object.fromEntries(getJobFiles(jobId));
}

export function getProjectFile(jobId: string, path: string): string | undefined {
  return getJobFiles(jobId).get(path);
}

/** Release a job's file map once its build is finished (prevents unbounded growth). */
export function disposeProjectFiles(jobId: string): void {
  jobFileMaps.delete(jobId);
  jobWriteCounts.delete(jobId);
}

// ─── Done summary (answer-mode signal) ──────────────────────────────
const jobDoneSummaries = new Map<string, string>();

export function getDoneSummary(jobId: string): string | undefined {
  return jobDoneSummaries.get(jobId);
}

export function disposeDoneSummary(jobId: string): void {
  jobDoneSummaries.delete(jobId);
}

export function setDoneSummary(jobId: string, summary: string): void {
  jobDoneSummaries.set(jobId, summary);
}

// ─── Write count (per-path, nudges looping models) ──────────────────
const jobWriteCounts = new Map<string, Map<string, number>>();

export function bumpWriteCount(jobId: string, path: string): number {
  let m = jobWriteCounts.get(jobId);
  if (!m) {
    m = new Map<string, number>();
    jobWriteCounts.set(jobId, m);
  }
  const n = (m.get(path) ?? 0) + 1;
  m.set(path, n);
  return n;
}

export function getWriteCount(jobId: string, path: string): number {
  return jobWriteCounts.get(jobId)?.get(path) ?? 0;
}

// ─── Screenshot counter (limits analyze_screenshot calls) ──────────
const jobScreenshotCounts = new Map<string, number>();

export function bumpScreenshotCount(jobId: string): number {
  const n = (jobScreenshotCounts.get(jobId) ?? 0) + 1;
  jobScreenshotCounts.set(jobId, n);
  return n;
}

/**
 * Decrement a path's write count to 3 — used after a delete to grant exactly
 * one more write (prevents the loop-nudge from blocking a legitimate re-create).
 */
export function rewindWriteCount(jobId: string, path: string): void {
  const m = jobWriteCounts.get(jobId);
  if (m && (m.get(path) ?? 0) >= 4) {
    m.set(path, 3);
  }
}

// ─── Build results (per-job) ────────────────────────────────────────
const jobBuildResults = new Map<string, BuildResult>();

/** True if a command actually compiles the project (so its exit code is meaningful). */
export function isBuildCommand(command: string): boolean {
  return /(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|vite\s+build\b|next\s+build\b|tsc\b|expo\s+export\b|flutter\s+build\b/i.test(
    command,
  );
}

export function getBuildResult(jobId: string): BuildResult | undefined {
  return jobBuildResults.get(jobId);
}

export function setBuildResult(jobId: string, result: BuildResult): void {
  jobBuildResults.set(jobId, result);
}

export function disposeBuildResult(jobId: string): void {
  jobBuildResults.delete(jobId);
}
