/**
 * Static Preview Engine — generates instant iframe previews for static
 * HTML/CSS/JS projects (no package.json, no build step needed).
 *
 * Instead of spinning up an E2B sandbox or WebContainer, we:
 *   1. Collect all project files from the workbench
 *   2. Inline CSS/JS/SVG references into the index.html
 *   3. Create a Blob URL from the resulting HTML
 *   4. Inject it into workbenchStore.previews
 *
 * The existing Preview component renders it in an iframe — zero changes
 * to the preview UI, zero infrastructure cost, instant load on every
 * device (mobile + desktop).
 */

import { workbenchStore } from '~/lib/stores/workbench';
import { buildStaticPreviewHtml } from './project-analyzer';
import type { FileMap } from '~/lib/common/llm/constants';

/** Track the active blob URL so we can revoke it when the project changes. */
let currentBlobUrl: string | null = null;

/**
 * Generate a static preview and inject it into the workbench preview store.
 *
 * Called by RemotePreviewTrigger when the project analyzer detects a
 * 'static' project type. This completely bypasses E2B/WebContainer.
 *
 * Returns true if a static preview was successfully injected, false if
 * the project is not static or the HTML file is missing.
 */
export function showStaticPreview(files: FileMap, entryHtmlPath?: string): boolean {
  try {
    // Revoke previous blob URL to avoid memory leaks
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }

    // Build self-contained HTML with inlined CSS/JS
    const html = buildStaticPreviewHtml(files, entryHtmlPath);

    if (!html || html.length < 50) {
      console.warn('[StaticPreview] HTML too short or empty, skipping');
      return false;
    }

    // Create a Blob URL — the iframe will load this directly
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    currentBlobUrl = url;

    /*
     * Inject into the preview store — the Preview component picks this up
     * automatically and renders it in the iframe.
     */
    const port = 5173; // Use a fixed port number for static previews

    workbenchStore.previews.set([
      {
        port,
        ready: true,
        baseUrl: url,
      },
    ]);

    console.log('[StaticPreview] Injected blob URL preview (zero-cost, instant)', {
      htmlSize: html.length,
      url: url.slice(0, 50) + '...',
    });

    return true;
  } catch (err) {
    console.error('[StaticPreview] Failed to create static preview:', err);
    return false;
  }
}

/**
 * Clear the static preview (revoke blob URL + clear previews store).
 * Called when switching chats, deleting chats, or when the project type
 * changes from static to something that needs E2B.
 */
export function clearStaticPreview(): void {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  /*
   * Don't clear the previews store here — the caller is responsible for
   * that (RemotePreviewTrigger or resetForChat handles it).
   */
}
