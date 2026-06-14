/**
 * Remote (server-side) sandbox client.
 *
 * Talks to the same-origin `/api/sandbox` route (see app/routes/api.sandbox.ts),
 * which runs AI-generated projects in a managed E2B cloud sandbox and returns a
 * public preview URL. This is the reliable execution tier for memory-constrained
 * devices (mobile Safari), where the in-browser WebContainer cannot run real
 * dev servers.
 *
 * Activation is server-side: set the `E2B_API_KEY` secret in Cloudflare. The
 * client discovers availability via `GET /api/sandbox`. When E2B is not
 * configured, the app keeps using the in-browser WebContainer unchanged.
 */

const BASE = '/api/sandbox';

export interface RemoteSandbox {
  id: string;
  previewUrl?: string;
}

/** Whether the device is the kind where WebContainer dev servers struggle. */
export function isMemoryConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent;
  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

  return isMobile || isSafari;
}

/** Server-side availability check (E2B key configured). Cached after first call. */
let availabilityCache: boolean | undefined;

export async function isRemoteSandboxAvailable(): Promise<boolean> {
  if (availabilityCache !== undefined) {
    return availabilityCache;
  }

  try {
    const res = await fetch(BASE, { method: 'GET' });

    if (!res.ok) {
      availabilityCache = false;
      return false;
    }

    const data = (await res.json()) as { configured?: boolean };
    availabilityCache = Boolean(data.configured);
  } catch {
    availabilityCache = false;
  }

  return availabilityCache;
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };

  if (!res.ok) {
    throw new Error(data.error || `sandbox ${String(payload.op)} -> ${res.status}`);
  }

  return data as T;
}

/** Create a sandbox session. */
export async function createRemoteSandbox(): Promise<RemoteSandbox> {
  const { id } = await call<{ id: string }>({ op: 'create' });

  return { id };
}

/** Upload project files (path -> contents). */
export async function pushFiles(id: string, files: Record<string, string>): Promise<void> {
  await call({ op: 'files', id, files });
}

/** Install dependencies + start the dev server; returns the public preview URL. */
export async function startRemoteSandbox(
  id: string,
  opts?: { install?: string; dev?: string; port?: number },
): Promise<string> {
  const { url } = await call<{ url: string }>({ op: 'start', id, ...(opts || {}) });

  return url;
}

/** Tear down the sandbox (also auto-reaped after inactivity). */
export async function destroyRemoteSandbox(id: string): Promise<void> {
  await call({ op: 'destroy', id }).catch(() => undefined);
}
