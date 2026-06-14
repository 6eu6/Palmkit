/**
 * Remote (server-side) sandbox client.
 *
 * Talks to the Pocketforge Sandbox Server (see /sandbox-server) which runs
 * AI-generated projects on a server and proxies a live preview. This is the
 * reliable execution tier for memory-constrained devices (mobile Safari), where
 * the in-browser WebContainer cannot run real dev servers.
 *
 * Activation: set `VITE_SANDBOX_SERVER_URL` (and optionally
 * `VITE_SANDBOX_API_TOKEN`) in the Pages environment. When unset, the app keeps
 * using the in-browser WebContainer unchanged — nothing here runs.
 *
 * This module is intentionally standalone (no imports from the workbench) so it
 * can be wired in incrementally without risking the existing runtime.
 */

const SERVER_URL = import.meta.env.VITE_SANDBOX_SERVER_URL as string | undefined;
const API_TOKEN = import.meta.env.VITE_SANDBOX_API_TOKEN as string | undefined;

export interface RemoteSandbox {
  id: string;

  /** Absolute URL of the live preview served by the sandbox server */
  previewUrl: string;
}

/** True when a sandbox server is configured. */
export function isRemoteSandboxConfigured(): boolean {
  return typeof SERVER_URL === 'string' && SERVER_URL.length > 0;
}

/**
 * Heuristic for when to prefer the server: a configured server + a
 * memory-constrained mobile browser (where WebContainer dev servers fail).
 */
export function shouldUseRemoteSandbox(): boolean {
  if (!isRemoteSandboxConfigured()) {
    return false;
  }

  if (typeof navigator === 'undefined') {
    return false;
  }

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  return isMobile || isSafari;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };

  if (API_TOKEN) {
    h['x-sandbox-token'] = API_TOKEN;
  }

  return h;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, { ...init, headers: { ...headers(), ...(init?.headers || {}) } });

  if (!res.ok) {
    throw new Error(`sandbox server ${path} -> ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/** Create a session and return its id + preview URL. */
export async function createRemoteSandbox(): Promise<RemoteSandbox> {
  const { id, previewPath } = await api<{ id: string; previewPath: string }>('/sandboxes', { method: 'POST' });

  return { id, previewUrl: `${SERVER_URL}${previewPath}` };
}

/** Upload the current project files (path -> contents). */
export async function pushFiles(id: string, files: Record<string, string>): Promise<void> {
  await api(`/sandboxes/${id}/files`, { method: 'POST', body: JSON.stringify({ files }) });
}

/** Install dependencies and start the dev server. Optional command overrides. */
export async function startRemoteSandbox(
  id: string,
  opts?: { install?: string; dev?: string; port?: number },
): Promise<void> {
  await api(`/sandboxes/${id}/start`, { method: 'POST', body: JSON.stringify(opts || {}) });
}

/** Tear down the session (also auto-reaped server-side after inactivity). */
export async function destroyRemoteSandbox(id: string): Promise<void> {
  await fetch(`${SERVER_URL}/sandboxes/${id}`, { method: 'DELETE', headers: headers() }).catch(() => {});
}
