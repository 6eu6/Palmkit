/**
 * Sandbox API client
 * ==================
 * Shared helper for sandbox-based tools (run_shell, screenshot, read_sandbox_file).
 *
 * All three tools call POST /api/sb with different `op` values. This module
 * centralizes:
 *   - The endpoint URL (configurable via env for dev/prod)
 *   - Auth/session handling (delegated to /api/sb which reads cookies)
 *   - Error normalization (network errors → clean ToolFailure)
 *   - Timeout handling (CF Workers-compatible AbortController)
 *
 * The /api/sb endpoint enforces:
 *   - User owns the sandbox (auth + ownership check via Supabase session)
 *   - Rate limiting (max 3 concurrent sandboxes per user)
 *   - Audit logging
 *
 * We don't duplicate those checks here — they're enforced server-side.
 */

import { fetchWithTimeout } from '~/lib/.server/tools/schemas/_network';
import type { ToolResult } from '~/lib/.server/tools/types';

/**
 * The sandbox API endpoint.
 *
 * In production: same-origin /api/sb (Cloudflare Pages handles routing).
 * In development: configurable via SANDBOX_API_URL env (e.g. for local testing).
 */
function getSandboxEndpoint(): string {
  // Check for explicit override (e.g. tests, local dev)
  if (typeof process !== 'undefined' && process.env?.SANDBOX_API_URL) {
    return process.env.SANDBOX_API_URL;
  }

  /*
   * Production: same-origin
   * (Cloudflare Pages rewrites /api/sb to the route handler)
   */
  return 'https://palmkit.app/api/sb';
}

/**
 * Response shape from POST /api/sb. Different ops return different fields:
 *   - run: { exitCode, stdout, stderr }
 *   - read: { path, content, size }
 *   - screenshot: { url, image (base64), mimeType, size }
 */
export interface SandboxResponse {
  [key: string]: unknown;
}

/**
 * Call the sandbox API with a given op + parameters.
 *
 * Returns the parsed JSON response on success, or a ToolFailure on error.
 *
 * The caller is responsible for shaping the response into its tool-specific
 * ToolResult (this helper returns raw data).
 */
export async function callSandbox(
  sandboxId: string,
  op: 'run' | 'read' | 'screenshot',
  params: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<{ ok: true; data: SandboxResponse } | ToolResult> {
  if (!sandboxId) {
    return {
      ok: false,
      error: 'No sandbox available. The sandbox starts after files are written.',
      hint: 'Generate the <palmkitArtifact> first, then the sandbox will be available for verification.',
    };
  }

  try {
    const resp = await fetchWithTimeout(getSandboxEndpoint(), {
      method: 'POST',
      timeoutMs: timeoutMs + 5000, // network timeout > command timeout
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op,
        id: sandboxId,
        ...params,
      }),
    });

    if (!resp.ok) {
      // Try to parse error message
      let errMessage = `HTTP ${resp.status} ${resp.statusText}`;
      let errHint: string | undefined;

      try {
        const errData: any = await resp.json();

        if (errData?.error) {
          errMessage = String(errData.error);
        }

        if (errData?.hint) {
          errHint = String(errData.hint);
        }
      } catch {
        // Response wasn't JSON — try as text
        try {
          const errText = await resp.text();

          if (errText) {
            errMessage = errText.slice(0, 200);
          }
        } catch {
          // Give up — keep the HTTP status message
        }
      }

      // Add hint based on status code
      if (resp.status === 401) {
        errHint = 'Authentication required. The user may need to log in.';
      } else if (resp.status === 403) {
        errHint = 'You do not own this sandbox. It may have been created by another user.';
      } else if (resp.status === 404) {
        errHint = 'Sandbox not found. It may have been paused or destroyed. Generate a new project.';
      } else if (resp.status === 429) {
        errHint = 'Rate limited. Wait a moment and retry.';
      } else if (resp.status >= 500) {
        errHint = 'Server error. The sandbox may be starting up — retry in a few seconds.';
      }

      return { ok: false, error: `Sandbox ${op} failed: ${errMessage}`, ...(errHint ? { hint: errHint } : {}) };
    }

    const data = (await resp.json()) as SandboxResponse;

    return { ok: true, data };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortTimeoutError') {
      return {
        ok: false,
        error: `Sandbox ${op} timed out after ${timeoutMs}ms.`,
        hint: 'The command may still be running. Try a longer timeout or simplify the command.',
      };
    }

    const message = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      error: `Sandbox ${op} failed: ${message}`,
      hint: 'Network error reaching the sandbox API. The sandbox may be paused — generate a new project to resume.',
    };
  }
}
