/**
 * Remote (server-side) sandbox client.
 *
 * Talks to the same-origin `/api/sb` route (see app/routes/api.sb.ts),
 * which runs AI-generated projects in a managed E2B cloud sandbox and returns a
 * public preview URL. This is the reliable execution tier for memory-constrained
 * devices (mobile Safari), where the in-browser WebContainer cannot run real
 * dev servers.
 *
 * Activation is server-side: set the `E2B_API_KEY` secret in Cloudflare. The
 * client discovers availability via `GET /api/sb`. When E2B is not
 * configured, the app keeps using the in-browser WebContainer unchanged.
 */

const BASE = '/api/sb';

export interface RemoteSandbox {
  id: string;
  previewUrl?: string;

  /** Whether this sandbox was created from a cached snapshot. */
  cached?: boolean;
}

/** Whether the device is a phone where WebContainer dev servers struggle. */
export function isMemoryConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent;

  /*
   * Detect phones only (not tablets, not desktop).
   * iPad and iPadOS masquerade as macOS in newer Safari — detect via touch + screen.
   */
  const isIPhone = /iPhone/i.test(ua);
  const isAndroidPhone = /Android(?!.*Tablet|.*Mobile.*Tablet)/i.test(ua);

  /*
   * iPad detection: iPadOS 13+ reports as Mac, so also check touch capability
   * combined with screen size to distinguish from iPhone.
   */
  const isIPad =
    (/iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) && window.screen.width >= 768;

  /*
   * Small-screen Android tablets are rare but exist — treat tablets as non-constrained
   * since they have enough RAM for WebContainer.
   */
  const isAndroidTablet = /Android.*Tablet/i.test(ua) || (/Android/i.test(ua) && window.screen.width >= 768);

  const isPhone = isIPhone || (isAndroidPhone && !isAndroidTablet);

  /*
   * Explicitly exclude desktop Safari — it has plenty of memory for WebContainer.
   * Only phones are memory-constrained.
   */
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

/**
 * Reset the availability cache so the next check hits the server again.
 * Useful after a network change or when retrying after a failure.
 */
export function resetAvailabilityCache(): void {
  availabilityCache = undefined;
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
  const constrained = isMemoryConstrainedDevice();
  console.info(`[E2B] device init: constrained=${constrained}, UA=${navigator.userAgent.substring(0, 80)}`);
  void isRemoteSandboxAvailable().then((ok) => console.info(`[E2B] availability resolved: ${ok}`));
}

/**
 * Retry helper for E2B API calls.
 * E2B sandboxes can be flaky on first create (cold start) — retry transient
 * failures with exponential back-off.
 */
async function callWithRetry<T>(payload: Record<string, unknown>, retries = 2, baseDelayMs = 1500): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000), // 120s per attempt (mobile networks can be slow)
      });

      const data = (await res.json().catch(() => ({}))) as T & { error?: string };

      if (!res.ok) {
        // 501 = API key not configured — never retry
        if (res.status === 501) {
          throw new Error(data.error || 'E2B not configured');
        }

        // 400 = bad request — retrying won't help
        if (res.status === 400) {
          throw new Error(data.error || `Bad request: ${payload.op}`);
        }

        // 5xx or other — might be transient, retry
        lastError = new Error(data.error || `sandbox ${String(payload.op)} -> ${res.status}`);

        if (attempt < retries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.warn(`[E2B] ${payload.op} failed (${res.status}), retry ${attempt + 1}/${retries} in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        throw lastError;
      }

      return data as T;
    } catch (err) {
      // Don't retry client-side aborts or timeouts on the last attempt
      if (err instanceof DOMException && err.name === 'TimeoutError' && attempt < retries) {
        lastError = err as Error;

        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[E2B] ${payload.op} timed out, retry ${attempt + 1}/${retries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (attempt === retries) {
        throw err instanceof Error ? err : new Error(String(err));
      }

      lastError = err instanceof Error ? err : new Error(String(err));

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[E2B] ${payload.op} error: ${lastError.message}, retry ${attempt + 1}/${retries} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError || new Error('E2B operation failed after retries');
}

/**
 * Create a sandbox session (with retry).
 * @param framework Framework type from the Project Analyzer (vite/nextjs/node/python).
 *                  If provided, the server will try to use a cached snapshot
 *                  with pre-installed node_modules for that framework.
 */
export async function createRemoteSandbox(framework?: string): Promise<RemoteSandbox> {
  const { id, cached } = await callWithRetry<{ id: string; cached?: boolean }>({
    op: 'create',
    framework,
  });

  return { id, cached: cached ?? false };
}

/** Upload project files (path -> contents) (with retry). */
export async function pushFiles(id: string, files: Record<string, string>): Promise<void> {
  const entries = Object.entries(files);

  if (entries.length === 0) {
    return;
  }

  /*
   * Chunk the upload into batches of 10 files to avoid:
   * 1. Cloudflare Workers 100 MB body size limit (rare but possible on huge projects)
   * 2. Mobile network timeouts on large payloads
   * 3. E2B API request size limits
   */
  const BATCH_SIZE = 10;
  const totalFiles = entries.length;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(entries.length / BATCH_SIZE);
    const batchFiles = Object.fromEntries(batch);

    console.info(
      `[E2B] uploading batch ${batchNum}/${totalBatches} (${batch.length} files, ${Object.values(batchFiles).reduce((s, c) => s + c.length, 0)} bytes)`,
    );

    await callWithRetry({ op: 'files', id, files: batchFiles }, 2, 2000);
  }

  console.info(`[E2B] all ${totalFiles} files uploaded successfully`);
}

/** Install dependencies + start the dev server; returns the public preview URL (with retry). */
export async function startRemoteSandbox(
  id: string,
  opts?: { install?: string; dev?: string; port?: number },
): Promise<string> {
  const { url } = await callWithRetry<{ url: string }>({ op: 'start', id, ...(opts || {}) });

  return url;
}

/** Whether the dev server inside the sandbox is responding on its port yet. */
export async function checkRemoteStatus(id: string, port?: number): Promise<boolean> {
  try {
    const { ready } = await callWithRetry<{ ready: boolean }>({ op: 'status', id, port }, 0);

    return Boolean(ready);
  } catch {
    return false;
  }
}

/** Fetch the tail of the dev-server log (best-effort, never throws). */
export async function getRemoteLogs(id: string): Promise<string> {
  try {
    const { logs } = await callWithRetry<{ logs: string }>({ op: 'logs', id }, 0);

    return logs || '';
  } catch {
    return '';
  }
}

/** Tear down the sandbox (also auto-reaped after inactivity). */
export async function destroyRemoteSandbox(id: string): Promise<void> {
  await callWithRetry({ op: 'destroy', id }, 0).catch(() => undefined);
}

/**
 * Take a snapshot of the sandbox for future caching.
 * Called AFTER the dev server is confirmed ready — the snapshot includes
 * node_modules + installed deps so the next sandbox for this framework
 * can skip the full npm install.
 *
 * Best-effort: if it fails, we just continue without cache (no error thrown).
 */
export async function cacheRemoteSandbox(id: string, framework: string): Promise<void> {
  try {
    await callWithRetry({ op: 'cache', id, framework }, 0);
    console.info(`[E2B] snapshot cached for framework=${framework}`);
  } catch {
    // Best-effort — don't fail if caching fails
  }
}
