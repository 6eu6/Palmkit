import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from '@remix-run/cloudflare';

/*
 * STATIC import of the E2B SDK.
 *
 * The old code used dynamic `import('e2b')` inside action handlers, claiming
 * it was to avoid crashing the GET loader if the SDK failed to load. In
 * practice, Cloudflare's esbuild bundler mis-resolves the dynamic import of
 * this CJS/ESM hybrid package on cold Worker starts — `mod.Sandbox` comes
 * back undefined even though the package clearly exports it. curl requests
 * (which hit a warm Worker) worked; browser requests after a cold start
 * failed with "E2B SDK import failed: Sandbox class not found".
 *
 * A static top-level import lets esbuild analyze the dependency graph at
 * build time and bundle the SDK correctly. The SDK's Node.js deps (ws,
 * crypto, buffer) are polyfilled by the `nodejs_compat` flag (already set
 * in wrangler.toml) + vite-plugin-node-polyfills, so a static import is
 * safe. The GET loader stays healthy because if the SDK truly can't load,
 * the whole module fails to build (caught at deploy time, not runtime).
 */
import { Sandbox as E2BSandbox } from 'e2b';

/**
 * Server-side sandbox proxy (E2B).
 *
 * Runs AI-generated projects in a managed cloud sandbox — full `npm install` +
 * dev server — and returns a public preview URL. This is the reliable
 * execution tier for mobile Safari, where the in-browser WebContainer cannot
 * run real dev servers.
 *
 * The E2B API key lives only here (Cloudflare env `E2B_API_KEY`) and is never
 * exposed to the browser. The client talks to this route via /api/sb.
 */

const PROJECT_DIR = '/home/user/project';
const DEFAULT_PORT = 3000;
const SANDBOX_TIMEOUT_MS = 1000 * 60 * 7; // auto-close after 7 min idle (cost control)

function getApiKey(context: ActionFunctionArgs['context']): string | undefined {
  const env = (context as unknown as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env;

  const key = env?.E2B_API_KEY;

  if (key) {
    console.log('[api/sandbox] E2B_API_KEY found in cloudflare env');
  } else {
    console.warn('[api/sandbox] E2B_API_KEY is NOT set in cloudflare env');
  }

  return key || (typeof process !== 'undefined' ? process.env?.E2B_API_KEY : undefined);
}

// GET /api/sandbox — health/config check
export async function loader({ context }: LoaderFunctionArgs) {
  const hasKey = Boolean(getApiKey(context));
  console.log(`[api/sandbox] health check: configured=${hasKey}`);

  return json({ ok: true, configured: hasKey });
}

interface SandboxRequest {
  op: 'create' | 'files' | 'start' | 'status' | 'logs' | 'destroy';
  id?: string;
  files?: Record<string, string>;
  install?: string;
  dev?: string;
  port?: number;
}

export async function action({ context, request }: ActionFunctionArgs) {
  const apiKey = getApiKey(context);

  if (!apiKey) {
    return json({ error: 'E2B_API_KEY is not configured on the server' }, { status: 501 });
  }

  let body: SandboxRequest;

  try {
    body = (await request.json()) as SandboxRequest;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    switch (body.op) {
      case 'create': {
        /*
         * Dynamic import — isolated to this code path so a failure here
         * doesn't crash the GET loader.
         */
        const sandboxClass = E2BSandbox;
        const sandbox = await sandboxClass.create({ apiKey, timeoutMs: SANDBOX_TIMEOUT_MS });

        console.log(`[api/sandbox] created sandbox: ${sandbox.sandboxId}`);

        return json({ id: sandbox.sandboxId });
      }

      case 'files': {
        if (!body.id || !body.files) {
          return json({ error: 'id and files are required' }, { status: 400 });
        }

        const sandboxClass = E2BSandbox;
        const sandbox = await sandboxClass.connect(body.id, { apiKey });

        for (const [path, content] of Object.entries(body.files)) {
          const clean = path.replace(/^\/+/, '');
          await sandbox.files.write(`${PROJECT_DIR}/${clean}`, content);
        }

        return json({ ok: true, count: Object.keys(body.files).length });
      }

      case 'start': {
        if (!body.id) {
          return json({ error: 'id is required' }, { status: 400 });
        }

        const sandboxClass = E2BSandbox;
        const sandbox = await sandboxClass.connect(body.id, { apiKey });
        const port = body.port ?? DEFAULT_PORT;
        const install = body.install ?? 'npm install --no-audit --no-fund';
        const dev = body.dev ?? `npm run dev -- --host 0.0.0.0 --port ${port} --base=/preview/`;

        /*
         * Patch the Vite config so the dev server accepts requests from the
         * E2B proxy host (Vite 5.2+ blocks unknown hosts by default) and HMR
         * connects through our same-origin proxy.
         *
         * APPROACH: write the vite.config directly via the E2B filesystem API
         * from the server side. This is more reliable than running a Node.js
         * script in the sandbox (which can fail silently due to shell escaping
         * or missing node binary). We OVERWRITE the AI's vite.config with a
         * minimal valid one that:
         *   - Re-exports the AI's plugins (best-effort: try common import paths)
         *   - Sets server.allowedHosts, server.host, server.hmr for the proxy
         *
         * If the AI's config used @vitejs/plugin-react, we import it.
         * Otherwise we just use a bare config (the app still serves HTML).
         *
         * We try to read the AI's vite.config first to detect the plugin, then
         * write our patched version. This avoids all shell escaping issues.
         */
        const patchedConfig = `
const serverOpts = {
  allowedHosts: true,
  host: true,
  hmr: { host: 'palmkit.app', protocol: 'wss', clientPort: 443 },
  port: ${port},
  base: '/preview/',
};

let plugins = [];
try {
  const react = require('@vitejs/plugin-react');
  plugins = [react()];
} catch {}

module.exports = { server: serverOpts, plugins };
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
          console.warn(`[api/sandbox] vite.config patch failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        /*
         * Keep the sandbox alive while the dev server runs, then patch hosts +
         * install + run the dev server in the background so this returns fast.
         */
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
        await sandbox.commands.run(`cd ${PROJECT_DIR} && (${install} && ${dev}) > /tmp/dev.log 2>&1`, {
          background: true,
        });

        const host = sandbox.getHost(port);
        console.log(`[api/sandbox] sandbox ${body.id} started, preview at https://${host}`);

        return json({ url: `https://${host}`, port });
      }

      case 'logs': {
        if (!body.id) {
          return json({ error: 'id is required' }, { status: 400 });
        }

        const sandboxClass = E2BSandbox;
        const sandbox = await sandboxClass.connect(body.id, { apiKey });
        const out = await sandbox.commands
          .run('tail -n 60 /tmp/dev.log 2>/dev/null || echo "(no logs yet)"', { timeoutMs: 8000 })
          .catch(() => ({ stdout: '(logs unavailable)' }) as { stdout: string });

        return json({ logs: out.stdout || '' });
      }

      case 'status': {
        if (!body.id) {
          return json({ error: 'id is required' }, { status: 400 });
        }

        const port = body.port ?? DEFAULT_PORT;

        /*
         * Probe the PUBLIC e2b host to verify the dev server is up and serving.
         *
         * We try BOTH / and /preview/ because:
         *  - Vite 5+ with --base=/preview/ serves HTML at /preview/
         *  - Vite 4 and earlier with --base=/preview/ serves HTML at / (the
         *    base only affects asset URLs, not the serving path)
         *  - Other dev servers (Next.js, Astro, etc.) serve at /
         *
         * If EITHER path returns a 2xx/3xx, the sandbox is ready.
         */
        let code = 0;

        for (const probePath of ['/', '/preview/']) {
          try {
            const probe = await fetch(`https://${port}-${body.id}.e2b.app${probePath}`, {
              method: 'GET',
              redirect: 'manual',
            });
            code = probe.status;

            if (code >= 200 && code < 400) {
              break; // ready!
            }
          } catch {
            // try next path
          }
        }

        const ready = code >= 200 && code < 400;

        return json({ ready, code });
      }

      case 'destroy': {
        if (!body.id) {
          return json({ error: 'id is required' }, { status: 400 });
        }

        const sandboxClass = E2BSandbox;
        const sandbox = await sandboxClass.connect(body.id, { apiKey });
        await sandbox.kill();

        console.log(`[api/sandbox] destroyed sandbox: ${body.id}`);

        return json({ ok: true });
      }

      default:
        return json({ error: `unknown op: ${String(body.op)}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[api/sandbox] operation ${body.op} failed:`, message);

    return json({ error: message }, { status: 500 });
  }
}
