import { type ActionFunctionArgs, type LoaderFunctionArgs, json } from '@remix-run/cloudflare';
import { Sandbox } from 'e2b';

/**
 * Server-side sandbox proxy (E2B).
 *
 * Runs AI-generated projects in a managed cloud sandbox — full `npm install` +
 * dev server — and returns a public preview URL. This is the reliable
 * execution tier for mobile Safari, where the in-browser WebContainer cannot
 * run real dev servers.
 *
 * The E2B API key lives only here (Cloudflare env `E2B_API_KEY`) and is never
 * exposed to the browser. The client talks to this route via /api/sandbox.
 */

const PROJECT_DIR = '/home/user/project';
const DEFAULT_PORT = 3000;
const SANDBOX_TIMEOUT_MS = 1000 * 60 * 7; // auto-close after 7 min idle (cost control)

function getApiKey(context: ActionFunctionArgs['context']): string | undefined {
  const env = (context as { cloudflare?: { env?: Record<string, string> } }).cloudflare?.env;

  return env?.E2B_API_KEY || (typeof process !== 'undefined' ? process.env?.E2B_API_KEY : undefined);
}

// GET /api/sandbox — health/config check
export async function loader({ context }: LoaderFunctionArgs) {
  return json({ ok: true, configured: Boolean(getApiKey(context)) });
}

interface SandboxRequest {
  op: 'create' | 'files' | 'start' | 'destroy';
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
        const sandbox = await Sandbox.create({ apiKey, timeoutMs: SANDBOX_TIMEOUT_MS });

        return json({ id: sandbox.sandboxId });
      }

      case 'files': {
        if (!body.id || !body.files) {
          return json({ error: 'id and files are required' }, { status: 400 });
        }

        const sandbox = await Sandbox.connect(body.id, { apiKey });

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

        const sandbox = await Sandbox.connect(body.id, { apiKey });
        const port = body.port ?? DEFAULT_PORT;
        const install = body.install ?? 'npm install';
        const dev = body.dev ?? `npm run dev -- --host 0.0.0.0 --port ${port}`;

        /*
         * Keep the sandbox alive while the dev server runs, then install + run
         * the dev server in the background so this request returns immediately.
         */
        await sandbox.setTimeout(SANDBOX_TIMEOUT_MS);
        await sandbox.commands.run(`cd ${PROJECT_DIR} && ${install} && ${dev}`, { background: true });

        const host = sandbox.getHost(port);

        return json({ url: `https://${host}`, port });
      }

      case 'destroy': {
        if (!body.id) {
          return json({ error: 'id is required' }, { status: 400 });
        }

        const sandbox = await Sandbox.connect(body.id, { apiKey });
        await sandbox.kill();

        return json({ ok: true });
      }

      default:
        return json({ error: `unknown op: ${String(body.op)}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return json({ error: message }, { status: 500 });
  }
}
