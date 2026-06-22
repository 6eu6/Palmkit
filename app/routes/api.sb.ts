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
         * OLD APPROACH (sed — BROKEN): prepended a new `server: {...}` block
         * before the existing one, creating a duplicate key. JS uses the LAST
         * value, so our injected `allowedHosts: true` was silently ignored →
         * Vite returned 403 for all proxy requests → "No preview available".
         *
         * NEW APPROACH (Node.js script — ROBUST): a small Node script that:
         *   1. Finds all vite.config.* files
         *   2. If `allowedHosts` is already present → skip (idempotent)
         *   3. If `server: {` exists → inject our keys INSIDE it (no dup)
         *   4. If no `server:` block → add one inside defineConfig({}) or {}
         *   5. If no vite.config at all → create a minimal one
         *
         * This avoids the duplicate-key problem and works with any config
         * shape the AI generates (defineConfig, export default, with/without
         * existing server block, TS/JS/MJS).
         */
        const patchHosts = `node -e "
const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.match(/^vite\\.config\\./));
const inject = 'allowedHosts: true, host: true, hmr: { host: \"palmkit.app\", protocol: \"wss\", clientPort: 443 },';
if (files.length === 0) {
  fs.writeFileSync('vite.config.js', 'export default { server: { ' + inject + ' } }\\n');
} else {
  for (const f of files) {
    let c = fs.readFileSync(f, 'utf-8');
    if (c.includes('allowedHosts')) continue;
    if (c.match(/server\\s*:\\s*\\{/)) {
      // Existing server block — inject inside it
      c = c.replace(/(server\\s*:\\s*\\{)/, '$1 ' + inject);
    } else if (c.match(/defineConfig\\s*\\(\\s*\\{/)) {
      // defineConfig({ ... }) — add server block inside
      c = c.replace(/(defineConfig\\s*\\(\\s*\\{)/, '$1 server: { ' + inject + ' },');
    } else if (c.match(/export\\s+default\\s*\\{/)) {
      // export default { ... } — add server block inside
      c = c.replace(/(export\\s+default\\s*\\{)/, '$1 server: { ' + inject + ' },');
    } else if (c.match(/export\\s+default\\s+defineConfig/)) {
      // export default defineConfig({...}) — handle the defineConfig case
      c = c.replace(/(defineConfig\\s*\\(\\s*\\{)/, '$1 server: { ' + inject + ' },');
    } else if (c.match(/export\\s+default\\s/)) {
      // export default <something> — overwrite with a minimal working config.
      // This handles AI-generated configs like export default server: {...}
      // (missing braces) or export default someVar. The AI's plugins (react,
      // etc.) will be missing but Vite still serves the HTML for preview.
      c = 'export default { server: { ' + inject + ' } }' + '\\n';
    } else {
      // Unknown shape — overwrite with a minimal working config
      c = 'export default { server: { ' + inject + ' } }\\n';
    }
    fs.writeFileSync(f, c);
  }
}
"`;

        /*
         * Keep the sandbox alive while the dev server runs, then patch hosts +
         * install + run the dev server in the background so this returns fast.
         */
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
        await sandbox.commands.run(`cd ${PROJECT_DIR} && (${patchHosts}; ${install} && ${dev}) > /tmp/dev.log 2>&1`, {
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
