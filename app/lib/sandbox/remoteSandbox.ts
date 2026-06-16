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

/** Whether the device is a phone where WebContainer dev servers struggle. */
export function isMemoryConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent;

  // Detect phones only (not tablets, not desktop).
  // iPad and iPadOS masquerade as macOS in newer Safari — detect via touch + screen.
  const isIPhone = /iPhone/i.test(ua);
  const isAndroidPhone = /Android(?!.*Tablet|.*Mobile.*Tablet)/i.test(ua);

  // iPad detection: iPadOS 13+ reports as Mac, so also check touch capability
  // combined with screen size to distinguish from iPhone.
  const isIPad =
    (/iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) &&
    window.screen.width >= 768;

  // Small-screen Android tablets are rare but exist — treat tablets as non-constrained
  // since they have enough RAM for WebContainer.
  const isAndroidTablet = /Android.*Tablet/i.test(ua) || (/Android/i.test(ua) && window.screen.width >= 768);

  const isPhone = isIPhone || (isAndroidPhone && !isAndroidTablet);

  // Explicitly exclude desktop Safari — it has plenty of memory for WebContainer.
  // Only phones are memory-constrained.
  return isPhone && !isIPad && !isAndroidTablet;
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
      console.warn(`[E2B] GET ${BASE} returned ${res.status} — E2B disabled for this session`);
      availabilityCache = false;
      return false;
    }

    const data = (await res.json()) as { configured?: boolean };
    availabilityCache = Boolean(data.configured);
    console.info(`[E2B] availability check: configured=${availabilityCache}`);
  } catch (err) {
    console.error('[E2B] availability check failed (network error or CORS):', err);
    availabilityCache = false;
  }

  return availabilityCache;
}

/** Synchronous read of the cached availability (false until first async check). */
export function getRemoteAvailabilitySync(): boolean {
  return availabilityCache === true;
}

/*
 * Kick off discovery as soon as this module loads in the browser so callers that
 * need a synchronous answer (e.g. the action runner) have it ready quickly.
 */
if (typeof window !== 'undefined') {
  void isRemoteSandboxAvailable();
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

/** Whether the dev server inside the sandbox is responding on its port yet. */
export async function checkRemoteStatus(id: string, port?: number): Promise<boolean> {
  try {
    const { ready } = await call<{ ready: boolean }>({ op: 'status', id, port });

    return Boolean(ready);
  } catch {
    return false;
  }
}

/** Tear down the sandbox (also auto-reaped after inactivity). */
export async function destroyRemoteSandbox(id: string): Promise<void> {
  await call({ op: 'destroy', id }).catch(() => undefined);
}
