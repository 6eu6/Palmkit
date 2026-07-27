/**
 * Output Validator — Phase 1 Safety Gate
 *
 * After the LLM stream finishes (or cuts off), this module inspects the raw
 * accumulated text and decides whether the build is:
 *   - `complete`      → safe to show in preview
 *   - `incomplete`    → stream cut mid-content, worth one bounded retry
 *   - `garbage`       → no artifact tags at all, retry won't help
 *   - `invalid`       → tags closed but content fails checks (placeholders, etc.)
 *
 * The validator is intentionally PURE (no I/O, no side effects) so it can be
 * unit-tested and called from both the message parser (finalization) and the
 * API route (post-stream gate).
 *
 * See ROADMAP.md → Phase 1 for the design constraints.
 */

import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('OutputValidator');

export const PALMKIT_DONE_MARKER = '__PALMKIT_DONE__';

export type BuildCompleteness =
  | 'complete' // marker present + tags balanced + no placeholders → show preview
  | 'incomplete' // stream cut mid-artifact → retry once
  | 'garbage' // no artifact tags at all → fail clean, no retry
  | 'invalid'; // tags balanced but placeholders/empty files → fail clean

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  filePath?: string;
}

export interface ValidationResult {
  completeness: BuildCompleteness;
  hasCompletionMarker: boolean;
  artifactTagsBalanced: boolean;
  fileActionsBalanced: boolean;
  fileCount: number;
  issues: ValidationIssue[];

  /** True if a bounded retry is worthwhile (incomplete only). */
  retryable: boolean;
}

interface ParsedFile {
  path: string;
  content: string;
  closed: boolean;
}

/**
 * Extract every <palmkitAction type="file" filePath="...">...</palmkitAction>
 * pair from the text. Returns unclosed files separately so the validator can
 * flag them.
 *
 * This is a streaming-tolerant parser: it does NOT use regex on the whole
 * text (which would fail on partial tags). It scans character-by-character.
 */
export function extractFileActions(text: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const openTag = '<palmkitAction type="file"';
  const closeTag = '</palmkitAction>';

  let i = 0;

  while (i < text.length) {
    const openIdx = text.indexOf(openTag, i);

    if (openIdx === -1) {
      break;
    }

    // Find the end of the opening tag (the closing >)
    const tagEnd = text.indexOf('>', openIdx);

    if (tagEnd === -1) {
      // Opening tag itself is truncated — stop.
      break;
    }

    const openTagContent = text.slice(openIdx, tagEnd + 1);

    // Extract filePath attribute
    const pathMatch = openTagContent.match(/filePath="([^"]+)"/);
    const filePath = pathMatch ? pathMatch[1] : '<unknown>';

    // Find the closing tag
    const closeIdx = text.indexOf(closeTag, tagEnd + 1);

    if (closeIdx === -1) {
      // File action was opened but never closed — stream cut mid-file.
      const content = text.slice(tagEnd + 1);
      files.push({ path: filePath, content, closed: false });
      break;
    }

    const content = text.slice(tagEnd + 1, closeIdx);
    files.push({ path: filePath, content, closed: true });
    i = closeIdx + closeTag.length;
  }

  return files;
}

const PLACEHOLDER_PATTERNS = [
  /\/\/\s*TODO/i,
  /\/\/\s*FIXME/i,
  /\/\/\s*rest of (the )?code/i,
  /\/\/\s*\.\.\./,
  /\/\*\s*COMPLETE\s+\w+\s*\*\//i,
  /<!--\s*COMPLETE[^>]*-->/i,
  /<!--\s*add (content|styling|logic)\s+here\s*-->/i,
  /\.\.\.\/\*\s*rest/i,
];

/**
 * Detect placeholder content that violates the <completeness_rules> section
 * of the system prompt. Returns the first matching pattern's description.
 */
export function detectPlaceholder(content: string): string | null {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(content)) {
      return pattern.source;
    }
  }

  // Empty file (whitespace only) is also a placeholder violation.
  if (content.trim().length === 0) {
    return 'empty-file';
  }

  return null;
}

/**
 * Validate the raw LLM output. Pure function — safe to call multiple times.
 *
 * @param text The FULL accumulated assistant text (all streamed segments joined).
 */
export function validateBuildOutput(text: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Completion marker — must be the last non-whitespace token.
  const trimmed = text.replace(/\s+$/, '');
  const hasCompletionMarker = trimmed.endsWith(PALMKIT_DONE_MARKER);

  // 2. Artifact tag balance.
  const openArtifactCount = (text.match(/<palmkitArtifact[\s>]/g) || []).length;
  const closeArtifactCount = (text.match(/<\/palmkitArtifact>/g) || []).length;
  const artifactTagsBalanced = openArtifactCount > 0 && openArtifactCount === closeArtifactCount;

  // 3. File action extraction.
  const files = extractFileActions(text);
  const fileCount = files.length;
  const closedFiles = files.filter((f) => f.closed);
  const fileActionsBalanced = fileCount > 0 && closedFiles.length === fileCount;

  // 4. Garbage check — no artifact tags at all.
  if (openArtifactCount === 0 && fileCount === 0) {
    issues.push({
      code: 'NO_ARTIFACT_TAGS',
      message: 'Response contains no <palmkitArtifact> tags — model returned raw text.',
      severity: 'error',
    });

    return {
      completeness: 'garbage',
      hasCompletionMarker: false,
      artifactTagsBalanced: false,
      fileActionsBalanced: false,
      fileCount: 0,
      issues,
      retryable: false,
    };
  }

  // 5. Incomplete — file action opened but not closed, or artifact not closed.
  if (!fileActionsBalanced || !artifactTagsBalanced) {
    const unclosedFiles = files.filter((f) => !f.closed).map((f) => f.path);

    issues.push({
      code: 'STREAM_CUT_MID_FILE',
      message: `Stream cut before closing tag. Unclosed files: ${unclosedFiles.join(', ') || 'none'}`,
      severity: 'error',
      filePath: unclosedFiles[0],
    });

    return {
      completeness: 'incomplete',
      hasCompletionMarker,
      artifactTagsBalanced,
      fileActionsBalanced,
      fileCount,
      issues,
      retryable: true, // bounded retry worthwhile
    };
  }

  // 6. Invalid — tags balanced but content has placeholders/empty files.
  for (const file of closedFiles) {
    const placeholder = detectPlaceholder(file.content);

    if (placeholder) {
      issues.push({
        code: placeholder === 'empty-file' ? 'EMPTY_FILE' : 'PLACEHOLDER_DETECTED',
        message: `File ${file.path} contains placeholder pattern: ${placeholder}`,
        severity: 'error',
        filePath: file.path,
      });
    }
  }

  if (issues.length > 0) {
    return {
      completeness: 'invalid',
      hasCompletionMarker,
      artifactTagsBalanced,
      fileActionsBalanced,
      fileCount,
      issues,
      retryable: false, // placeholder pattern won't change with retry
    };
  }

  // 7. Missing completion marker on otherwise-balanced output.
  if (!hasCompletionMarker) {
    issues.push({
      code: 'MISSING_COMPLETION_MARKER',
      message: `Response did not end with ${PALMKIT_DONE_MARKER}. Treating as incomplete.`,
      severity: 'warning',
    });

    /*
     * Marker missing on balanced output is suspicious — treat as incomplete
     * so we retry once. If the retry still lacks the marker, the api.chat.ts
     * hard-stop will catch it.
     */
    return {
      completeness: 'incomplete',
      hasCompletionMarker: false,
      artifactTagsBalanced,
      fileActionsBalanced,
      fileCount,
      issues,
      retryable: true,
    };
  }

  // 8. Complete — all checks passed.
  logger.debug(`Build output validated: complete, ${fileCount} files`);

  return {
    completeness: 'complete',
    hasCompletionMarker: true,
    artifactTagsBalanced: true,
    fileActionsBalanced: true,
    fileCount,
    issues: [],
    retryable: false,
  };
}

/**
 * Map a ValidationResult to a build_jobs.status value (see migration 0006).
 */
export function completenessToJobStatus(
  result: ValidationResult,
): 'generating' | 'incomplete_retrying' | 'failed_clean' | 'ready_for_preview' {
  switch (result.completeness) {
    case 'complete':
      return 'ready_for_preview';
    case 'incomplete':
      return 'incomplete_retrying';
    case 'garbage':
    case 'invalid':
      return 'failed_clean';
    default:
      return 'failed_clean';
  }
}
