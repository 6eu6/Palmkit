/**
 * Palmkit Sandbox Server
 *
 * Runs AI-generated projects server-side (install + dev server) and proxies a
 * live preview, so a full preview works on memory-constrained devices
 * (notably mobile Safari). See README.md for architecture and security.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import httpProxy from 'http-proxy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SandboxDriver, SandboxHandle, StartOptions } from './drivers/types.js';

const PORT = parseInt(process.env.PORT || '8787', 10);
const TOKEN = process.env.SANDBOX_API_TOKEN || '';
const TTL_MS = parseInt(process.env.SANDBOX_TTL_MS || '900000', 10);
const MAX = parseInt(process.env.SANDBOX_MAX || '8', 10);
const DEV_PORT = 3000;

const DEFAULTS: StartOptions = {
  install: 'npm install',
  dev: `npm run dev -- --host 0.0.0.0 --port ${DEV_PORT}`,
  port: DEV_PORT,
};

async function loadDriver(): Promise<SandboxDriver> {
  if ((process.env.SANDBOX_DRIVER || 'docker') === 'e2b') {
    return (await import('./drivers/e2b.js')).e2bDriver;
  }

  return (await import('./drivers/docker.js')).dockerDriver;
}

const driver = await loadDriver();
const sessions = new Map<string, SandboxHandle>();
const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
proxy.on('error', (_e, _req, res) => {
  // dev server may not be ready yet
  if (res && 'writeHead' in res) {
    (res as ServerResponse).writeHead(502);
    (res as ServerResponse).end('preview not ready');
  }
});

function touch(id: string) {
  const s = sessions.get(id);

  if (s) {
    s.lastActiveAt = Date.now();
  }
}

// --- idle reaper: keeps a small/free host healthy ---
setInterval(() => {
  const now = Date.now();

  for (const [id, s] of sessions) {
    if (now - s.lastActiveAt > TTL_MS) {
      sessions.delete(id);
      driver.destroy(id).catch(() => {});
    }
  }
}, 30_000).unref();

const app = new Hono();
app.use('*', cors());

// auth on the JSON API (the preview path is guarded by an unguessable id)
app.use('/sandboxes/*', async (c, next) => {
  if (TOKEN && c.req.header('x-sandbox-token') !== TOKEN) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  return next();
});

app.get('/health', (c) => c.json({ ok: true, driver: driver.name, sessions: sessions.size }));

app.post('/sandboxes', async (c) => {
  if (sessions.size >= MAX) {
    return c.json({ error: 'capacity reached, try again shortly' }, 429);
  }

  const handle = await driver.create();
  sessions.set(handle.id, handle);

  return c.json({ id: handle.id, previewPath: `/preview/${handle.id}/` });
});

app.post('/sandboxes/:id/files', async (c) => {
  const id = c.req.param('id');

  if (!sessions.has(id)) {
    return c.json({ error: 'not found' }, 404);
  }

  const { files } = await c.req.json<{ files: Record<string, string> }>();
  await driver.writeFiles(id, files || {});
  touch(id);

  return c.json({ ok: true });
});

app.post('/sandboxes/:id/start', async (c) => {
  const id = c.req.param('id');
  const s = sessions.get(id);

  if (!s) {
    return c.json({ error: 'not found' }, 404);
  }

  const body = await c.req.json<Partial<StartOptions>>().catch(() => ({}));
  const opts: StartOptions = { ...DEFAULTS, ...body };
  const { upstream } = await driver.start(id, opts);
  s.upstream = upstream;
  touch(id);

  return c.json({ ok: true, port: opts.port });
});

app.delete('/sandboxes/:id', async (c) => {
  const id = c.req.param('id');
  sessions.delete(id);
  await driver.destroy(id);

  return c.json({ ok: true });
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[sandbox] ${driver.name} driver listening on :${info.port}`);
});

// --- preview proxy (raw http, supports WebSocket/HMR) ---
// Hono runs on the same node server; intercept /preview/:id/* before Hono.
const nodeServer = server as unknown as {
  on: (ev: string, cb: (...a: unknown[]) => void) => void;
  prependListener: (ev: string, cb: (...a: unknown[]) => void) => void;
};

function previewTarget(url: string): { id: string; rest: string } | null {
  const m = /^\/preview\/([^/]+)(\/.*)?$/.exec(url);

  if (!m) {
    return null;
  }

  return { id: m[1], rest: m[2] || '/' };
}

nodeServer.prependListener('request', (...args: unknown[]) => {
  const req = args[0] as IncomingMessage;
  const res = args[1] as ServerResponse;
  const t = previewTarget(req.url || '');

  if (!t) {
    return;
  }

  const s = sessions.get(t.id);

  if (!s || !s.upstream) {
    res.writeHead(503);
    res.end('sandbox not started');

    return;
  }

  touch(t.id);
  req.url = t.rest; // strip /preview/:id prefix
  proxy.web(req, res, { target: s.upstream });
});

nodeServer.on('upgrade', (...args: unknown[]) => {
  const req = args[0] as IncomingMessage;
  const socket = args[1] as import('node:net').Socket;
  const head = args[2] as Buffer;
  const t = previewTarget(req.url || '');

  if (!t) {
    return;
  }

  const s = sessions.get(t.id);

  if (!s || !s.upstream) {
    socket.destroy();

    return;
  }

  touch(t.id);
  req.url = t.rest;
  proxy.ws(req, socket, head, { target: s.upstream });
});
