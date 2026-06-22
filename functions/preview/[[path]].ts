/**
 * Same-origin reverse proxy for the E2B cloud preview.
 *
 * Why: our app page is cross-origin-isolated (COEP: require-corp, needed for
 * WebContainer), which blocks embedding the cross-origin E2B preview in an
 * iframe. Serving the preview through THIS route makes it same-origin, so:
 *   1) the iframe is allowed under COEP, and
 *   2) the element inspector can access the preview DOM (same-origin).
 *
 * How: the running project's Vite dev server is started with `--base=/preview/`
 * so every asset URL is under `/preview/*`. The iframe loads `/preview/` on our
 * origin; this function forwards `/preview/*` to the sandbox host taken from the
 * `pf_preview=<sandboxId>:<port>` cookie. The inspector script is injected into
 * HTML responses so element selection works like the WebContainer preview.
 */

interface Env {
  [key: string]: unknown;
}

const HOP_BY_HOP = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-security-policy',
  'x-frame-options',
]);

function readCookie(cookieHeader: string, name: string): string | undefined {
  const m = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));

  return m ? decodeURIComponent(m[1]) : undefined;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);

  const session = readCookie(request.headers.get('Cookie') || '', 'pf_preview');

  if (!session) {
    return new Response('No active preview session', { status: 404 });
  }

  const [sandboxId, port = '3000'] = session.split(':');

  /*
   * Forward the /preview/* path to the sandbox. We DO NOT strip the /preview
   * prefix because Vite now runs WITHOUT --base=/preview/ (serving at /), so
   * we need to translate /preview/* → /* on the sandbox.
   *
   * The iframe loads /preview/ on our origin. Vite serves at / on the sandbox.
   * So /preview/ → /, /preview/src/main.jsx → /src/main.jsx, etc.
   *
   * This avoids the redirect loop that happened when Vite ran with
   * --base=/preview/ (Vite redirected / → /preview/, our proxy stripped
   * /preview → /, Vite redirected again → infinite loop).
   */
  const sandboxPath = url.pathname.replace(/^\/preview/, '') || '/';
  const target = `https://${port}-${sandboxId}.e2b.app${sandboxPath}${url.search}`;

  /*
   * WebSocket upgrade — Vite HMR + user app sockets.
   *
   * The iframe loads /preview/ via HTTP (proxied below), but Vite's HMR client
   * ALSO opens a WebSocket to /preview/ for live-reload. Without this branch,
   * the WS upgrade request goes through the fetch() path which silently drops
   * the upgrade → "failed to connect to websocket" errors in the console and
   * no HMR.
   *
   * Cloudflare Workers/Pages Functions support WebSocket proxying: pass the
   * upgrade request to fetch(), read the `.webSocket` property off the
   * response (server-side socket), accept() it, and return it in a 101
   * Response. The Workers runtime handles the bidirectional piping.
   *
   * We forward the original request as-is (preserving Sec-WebSocket-* headers)
   * so the upstream E2B sandbox's Vite server sees a normal upgrade handshake.
   */
  const upgradeHeader = request.headers.get('Upgrade') || '';

  if (upgradeHeader.toLowerCase().includes('websocket')) {
    const wsReq = new Request(target, request);
    wsReq.headers.delete('cookie');
    wsReq.headers.delete('host');

    let wsResp: Response;

    try {
      wsResp = await fetch(wsReq);
    } catch {
      return new Response('Preview WebSocket unreachable (still starting?)', { status: 502 });
    }

    const ws = (wsResp as Response & { webSocket?: WebSocket }).webSocket;

    if (!ws) {
      // Upstream didn't upgrade — return whatever it said (usually an error).
      return new Response(wsResp.body, { status: wsResp.status, headers: wsResp.headers });
    }

    // Accept the server-side socket so the Workers runtime starts piping.
    ws.accept();

    return new Response(null, { status: 101, webSocket: ws }) as Response;
  }

  // Forward the request to the sandbox (keep method/body/most headers).
  const fwdHeaders = new Headers(request.headers);
  fwdHeaders.delete('cookie');
  fwdHeaders.delete('host');

  let upstream: Response;

  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: fwdHeaders,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    });
  } catch {
    return new Response('Preview server unreachable (still starting?)', { status: 502 });
  }

  const headers = new Headers();

  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  /*
   * Make the proxied document embeddable inside our cross-origin-isolated page:
   * a COEP:require-corp page only embeds an iframe whose document ALSO carries a
   * COEP header (even when same-origin). Set it here, and mark every proxied
   * resource CORP same-origin so subresources load under that policy.
   */
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

  /*
   * Statuses that MUST NOT carry a body — returning one throws (→ Cloudflare 502).
   * Vite serves 304 for cached assets, so this is hit constantly.
   */
  const nullBody =
    upstream.status === 101 || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;

  if (nullBody) {
    return new Response(null, { status: upstream.status, headers });
  }

  const contentType = upstream.headers.get('content-type') || '';

  // Inject the inspector bridge into HTML so element selection works in-iframe.
  if (contentType.includes('text/html')) {
    let html = await upstream.text();
    const tag = '<script src="/inspector-script.js"></script>';

    if (html.includes('</head>')) {
      html = html.replace('</head>', `${tag}</head>`);
    } else {
      html = `${tag}${html}`;
    }

    return new Response(html, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
};
