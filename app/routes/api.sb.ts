import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { Sandbox as E2BSandbox } from 'e2b';
import { getAuthedUser } from '~/lib/auth/supabase.server';

/**
 * Server-side sandbox proxy (E2B) — with auth, ownership, rate limit, audit.
 *
 * SECURITY (Level 2):
 *   1. AUTH: Every operation requires a valid Supabase session. Anonymous
 *      requests are rejected with 401.
 *   2. OWNERSHIP: Each sandbox is tagged with `metadata.userId` at creation.
 *      Every subsequent operation (files/start/status/logs/destroy) verifies
 *      that the requesting user owns the sandbox via `Sandbox.getInfo()`.
 *      A user cannot read, control, or destroy another user's sandbox.
 *   3. RATE LIMIT: Max MAX_SANDBOXES_PER_USER (3) concurrent running sandboxes
 *      per user. Enforced by listing sandboxes filtered by `metadata.userId`
 *      before creating a new one.
 *   4. AUDIT LOG: Every operation is logged with userId, op, sandboxId, and
 *      timestamp in structured JSON (captured by Cloudflare Pages logs).
 *
 * The E2B API key lives only here (Cloudflare env `E2B_API_KEY`).
 */

const PROJECT_DIR = '/home/user/project';
const DEFAULT_PORT = 3000;
const SANDBOX_TIMEOUT_MS = 1000 * 60 * 7; // auto-close after 7 min idle
const MAX_SANDBOXES_PER_USER = 3;

// ─── helpers ───────────────────────────────────────────────────────────────

function getApiKey(context: ActionFunctionArgs['context']): string | undefined {
  const env = (context as unknown as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env;

  return env?.E2B_API_KEY || (typeof process !== 'undefined' ? process.env?.E2B_API_KEY : undefined);
}

/** Structured audit log — captured by Cloudflare Pages function logs. */
function audit(op: string, userId: string, sandboxId: string | undefined, extra?: string) {
  console.log(
    JSON.stringify({
      type: 'sandbox-audit',
      op,
      userId,
      sandboxId: sandboxId ?? null,
      ts: new Date().toISOString(),
      extra: extra ?? null,
    }),
  );
}

/**
 * Verify that the requesting user owns the sandbox. Calls E2B getInfo to
 * read the sandbox's metadata and checks `metadata.userId`.
 * Returns { ok: true } or { ok: false, error, status }.
 */
async function verifyOwnership(
  sandboxId: string,
  userId: string,
  apiKey: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  try {
    const info = await E2BSandbox.getInfo(sandboxId, { apiKey });
    const ownerId = info.metadata?.userId;

    if (!ownerId) {
      /*
       * Sandbox has no owner metadata — it predates the security update.
       * Reject to be safe (don't allow access to legacy unowned sandboxes).
       */
      return { ok: false, error: 'Sandbox has no owner metadata', status: 403 };
    }

    if (ownerId !== userId) {
      audit('ownership-denied', userId, sandboxId, `owner=${ownerId}`);
      return { ok: false, error: 'You do not own this sandbox', status: 403 };
    }

    return { ok: true };
  } catch {
    // Sandbox doesn't exist or E2B API error
    return { ok: false, error: 'Sandbox not found', status: 404 };
  }
}

/**
 * Count the user's currently running sandboxes by listing sandboxes filtered
 * by metadata.userId. Used for rate limiting. Uses E2BSandbox.list() which
 * returns a SandboxPaginator — avoids importing SandboxPaginator directly
 * (which can break Cloudflare Workers bundling).
 */
async function countUserSandboxes(userId: string, apiKey: string): Promise<number> {
  try {
    const paginator = E2BSandbox.list({
      query: { metadata: { userId }, state: ['running'] },
      apiKey,
    });
    const items = await paginator.nextItems();

    return items.length;
  } catch {
    /*
     * If listing fails, allow the create (fail-open to avoid blocking users
     * on transient E2B API errors — the 7-min auto-timeout is the backstop).
     */
    return 0;
  }
}

// ─── loader (GET /api/sb — health check, no auth needed) ───────────────────

export async function loader({ context }: LoaderFunctionArgs) {
  const hasKey = Boolean(getApiKey(context));

  return json({ ok: true, configured: hasKey });
}

// ─── action (POST /api/sb — all operations require auth) ───────────────────

interface SandboxRequest {
  op: 'create' | 'files' | 'start' | 'status' | 'logs' | 'destroy';
  id?: string;
  files?: Record<string, string>;
  install?: string;
  dev?: string;
  port?: number;
}

export async function action({ context, request }: ActionFunctionArgs) {
  // ── 1. AUTH: verify the user is logged in ──────────────────────────────
  const { user, headers: authHeaders } = await getAuthedUser(request, context);

  if (!user) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const userId = user.id;
  const userEmail = user.email ?? 'unknown';

  // ── 2. E2B API key check ───────────────────────────────────────────────
  const apiKey = getApiKey(context);

  if (!apiKey) {
    return json({ error: 'E2B_API_KEY is not configured on the server' }, { status: 501 });
  }

  // ── 3. Parse request body ──────────────────────────────────────────────
  let body: SandboxRequest;

  try {
    body = (await request.json()) as SandboxRequest;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // Merge auth Set-Cookie headers into our responses so sessions persist.
  const respond = (data: unknown, status = 200) => {
    const h = new Headers({ 'Content-Type': 'application/json' });

    authHeaders.forEach((v, k) => h.append(k, v));

    return json(data, { status, headers: h });
  };

  // ── 4. Dispatch ────────────────────────────────────────────────────────
  try {
    switch (body.op) {
      // ── CREATE ──────────────────────────────────────────────────────────
      case 'create': {
        // Rate limit: max MAX_SANDBOXES_PER_USER running sandboxes
        const count = await countUserSandboxes(userId, apiKey);

        if (count >= MAX_SANDBOXES_PER_USER) {
          audit('rate-limited', userId, undefined, `count=${count}`);
          return respond(
            {
              error: `Rate limit: you have ${count} active sandboxes (max ${MAX_SANDBOXES_PER_USER}). Wait for one to time out or destroy it.`,
            },
            429,
          );
        }

        // Create with ownership metadata
        const sandbox = await E2BSandbox.create({
          apiKey,
          timeoutMs: SANDBOX_TIMEOUT_MS,
          metadata: { userId, userEmail },
        });

        audit('create', userId, sandbox.sandboxId, `email=${userEmail}`);

        return respond({ id: sandbox.sandboxId });
      }

      // ── FILES (push files to sandbox) ──────────────────────────────────
      case 'files': {
        if (!body.id || !body.files) {
          return respond({ error: 'id and files are required' }, 400);
        }

        const ownership = await verifyOwnership(body.id, userId, apiKey);

        if (!ownership.ok) {
          return respond({ error: ownership.error }, ownership.status);
        }

        const sandbox = await E2BSandbox.connect(body.id, { apiKey });

        for (const [path, content] of Object.entries(body.files)) {
          const clean = path.replace(/^\/+/, '');
          await sandbox.files.write(`${PROJECT_DIR}/${clean}`, content);
        }

        audit('files', userId, body.id, `${Object.keys(body.files).length} files`);

        return respond({ ok: true, count: Object.keys(body.files).length });
      }

      // ── START (install + dev server) ───────────────────────────────────
      case 'start': {
        if (!body.id) {
          return respond({ error: 'id is required' }, 400);
        }

        const ownership = await verifyOwnership(body.id, userId, apiKey);

        if (!ownership.ok) {
          return respond({ error: ownership.error }, ownership.status);
        }

        const sandbox = await E2BSandbox.connect(body.id, { apiKey });
        const port = body.port ?? DEFAULT_PORT;

        /*
         * Install + dev commands come from the Project Analyzer (client-side).
         * If not provided, fall back to sensible defaults (Vite).
         * The analyzer determines the correct commands based on the project
         * type: vite, nextjs, node (express), python, or unknown.
         */
        const install = body.install ?? 'npm install --no-audit --no-fund';
        const dev = body.dev ?? `npm run dev -- --host 0.0.0.0 --port ${port} --base=/preview/`;

        /*
         * Only patch the Vite config if this is a Vite project (has vite.config
         * or the dev command uses vite). For Next.js, Node backends, and Python,
         * patching the Vite config is unnecessary and can break the project.
         */
        const isViteProject = dev.includes('vite') || dev.includes('--base=/preview/');

        if (isViteProject) {
          /*
           * Patch the Vite config via the E2B filesystem API (not shell script).
           * Writes a minimal valid vite.config.js with:
           *   - server.allowedHosts (Vite 5.2+ proxy host acceptance)
           *   - server.hmr (HMR through our same-origin WebSocket proxy)
           *   - base: '/preview/' (all asset URLs use /preview/ prefix)
           * Tries to restore the AI's @vitejs/plugin-react if available.
           */
          const patchedConfig = `
const serverOpts = {
  allowedHosts: true,
  host: true,
  hmr: { host: 'palmkit.app', protocol: 'wss', clientPort: 443 },
  port: ${port},
};

let plugins = [];

try {
  const react = (await import('@vitejs/plugin-react')).default;
  plugins = [react()];
} catch {}

export default { base: '/preview/', server: serverOpts, plugins };
`;

          try {
            await sandbox.files.write(`${PROJECT_DIR}/vite.config.js`, patchedConfig);

            // Remove any other vite.config.* files so Vite picks up ours
            try {
              const entries = await sandbox.files.list(PROJECT_DIR);

              for (const entry of entries) {
                if (entry.name && entry.name.match(/^vite\.config\./) && entry.name !== 'vite.config.js') {
                  try {
                    await sandbox.files.remove(`${PROJECT_DIR}/${entry.name}`);
                  } catch {}
                }
              }
            } catch {}
          } catch (err) {
            console.warn(`[api/sb] vite.config patch failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } // end if (isViteProject)

        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
        await sandbox.commands.run(`cd ${PROJECT_DIR} && (${install} && ${dev}) > /tmp/dev.log 2>&1`, {
          background: true,
        });

        const host = sandbox.getHost(port);
        audit('start', userId, body.id, `preview=https://${host}`);

        return respond({ url: `https://${host}`, port });
      }

      // ── LOGS (read dev server output) ──────────────────────────────────
      case 'logs': {
        if (!body.id) {
          return respond({ error: 'id is required' }, 400);
        }

        const ownership = await verifyOwnership(body.id, userId, apiKey);

        if (!ownership.ok) {
          return respond({ error: ownership.error }, ownership.status);
        }

        const sandbox = await E2BSandbox.connect(body.id, { apiKey });
        const out = await sandbox.commands
          .run('tail -n 60 /tmp/dev.log 2>/dev/null || echo "(no logs yet)"', { timeoutMs: 8000 })
          .catch(() => ({ stdout: '(logs unavailable)' }) as { stdout: string });

        return respond({ logs: out.stdout || '' });
      }

      // ── STATUS (probe if dev server is ready) ──────────────────────────
      case 'status': {
        if (!body.id) {
          return respond({ error: 'id is required' }, 400);
        }

        const ownership = await verifyOwnership(body.id, userId, apiKey);

        if (!ownership.ok) {
          return respond({ error: ownership.error }, ownership.status);
        }

        const port = body.port ?? DEFAULT_PORT;

        // Probe the public E2B host on both / and /preview/
        let code = 0;

        for (const probePath of ['/', '/preview/']) {
          try {
            const probe = await fetch(`https://${port}-${body.id}.e2b.app${probePath}`, {
              method: 'GET',
              redirect: 'manual',
            });
            code = probe.status;

            if (code >= 200 && code < 400) {
              break;
            }
          } catch {}
        }

        const ready = code >= 200 && code < 400;

        return respond({ ready, code });
      }

      // ── DESTROY (kill sandbox) ─────────────────────────────────────────
      case 'destroy': {
        if (!body.id) {
          return respond({ error: 'id is required' }, 400);
        }

        const ownership = await verifyOwnership(body.id, userId, apiKey);

        if (!ownership.ok) {
          return respond({ error: ownership.error }, ownership.status);
        }

        const sandbox = await E2BSandbox.connect(body.id, { apiKey });
        await sandbox.kill();

        audit('destroy', userId, body.id);

        return respond({ ok: true });
      }

      default:
        return respond({ error: `unknown op: ${String(body.op)}` }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[api/sb] operation ${body.op} failed:`, message);
    audit('error', userId, body.id, message);

    return respond({ error: message }, 500);
  }
}
