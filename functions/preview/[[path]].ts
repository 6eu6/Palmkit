/**
 * Same-origin reverse proxy for the E2B cloud preview + Supabase static preview.
 *
 * The worker uploads dist files to BOTH Cloudflare R2 (for source/metadata)
 * AND Supabase Storage (for serving via this Function). R2 buckets aren't
 * publicly readable without AWS SDK credentials, so we read from Supabase
 * Storage here and rewrite the Content-Type so HTML previews render as real
 * pages (Supabase Storage forces text/plain natively).
 */
interface Env { [key: string]: unknown; }
const HOP_BY_HOP = new Set(['content-encoding','content-length','transfer-encoding','connection','keep-alive','content-security-policy','x-frame-options']);

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(path: string): string {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function readCookie(cookieHeader: string, name: string): string | undefined {
  const m = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const session = readCookie(request.headers.get('Cookie') || '', 'pf_preview');
  if (!session) return new Response('No active preview session', { status: 404 });
  const isOracle = session.startsWith('oracle:');
  if (isOracle) {
    const [, projectId] = session.split(':');
    const subPath = url.pathname.replace(/^\/preview\/?/, '') || 'index.html';
    const contentType = contentTypeFor(subPath);

    // Supabase Storage — dist files are uploaded here by the worker (P4 fix:
    // upload to both R2 and Supabase so this Function can serve with correct
    // Content-Type. Supabase forces text/plain natively, this Function fixes it).
    const SUPABASE_URL = (context.env as Record<string, string>)?.SUPABASE_URL || 'https://ijbosijtfxehmnfhnnuq.supabase.co';
    try {
      const sbUrl = `${SUPABASE_URL}/storage/v1/object/public/palmkit-files/projects/${projectId}/dist/${subPath}`;
      const sbResp = await fetch(sbUrl, { redirect: 'manual' });
      if (sbResp.status === 200) {
        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Cache-Control', 'no-cache');
        if (subPath.endsWith('.html')) {
          let html = await sbResp.text();
          const tag = '<script src="/inspector-script.js"></script>';
          if (html.includes('</head>')) html = html.replace('</head>', `${tag}</head>`);
          else html = `${tag}${html}`;
          return new Response(html, { status: 200, headers });
        }
        return new Response(sbResp.body, { status: 200, headers });
      }
    } catch {}
    try {
      const oracleTarget = `https://blacks-drawing-dallas-interface.trycloudflare.com/preview-dist/${projectId}/${subPath}${url.search}`;
      const oracleResp = await fetch(oracleTarget, { method: request.method, headers: { 'Accept': 'text/html' }, redirect: 'manual' });
      const headers = new Headers();
      oracleResp.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value); });
      const contentType = oracleResp.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        let html = await oracleResp.text();
        const tag = '<script src="/inspector-script.js"></script>';
        if (html.includes('</head>')) html = html.replace('</head>', `${tag}</head>`);
        else html = `${tag}${html}`;
        return new Response(html, { status: oracleResp.status, headers });
      }
      return new Response(oracleResp.body, { status: oracleResp.status, headers });
    } catch { return new Response('Preview server unreachable', { status: 502 }); }
  }
  const [sandboxId, port = '3000'] = session.split(':');
  const target = `https://${port}-${sandboxId}.e2b.app${url.pathname}${url.search}`;
  const upgradeHeader = request.headers.get('Upgrade') || '';
  if (upgradeHeader.toLowerCase().includes('websocket')) {
    const wsReq = new Request(target, request); wsReq.headers.delete('cookie'); wsReq.headers.delete('host');
    let wsResp: Response; try { wsResp = await fetch(wsReq); } catch { return new Response('Preview WebSocket unreachable', { status: 502 }); }
    const upstreamWs = (wsResp as Response & { webSocket?: WebSocket }).webSocket;
    if (!upstreamWs) return new Response(wsResp.body, { status: wsResp.status, headers: wsResp.headers });
    const pair = new WebSocketPair(); const clientWs = pair[0]; const serverWs = pair[1];
    serverWs.accept(); upstreamWs.accept();
    const sanitizeCode = (code?: number) => (code === 1000 || (code && code >= 3000 && code < 5000) ? code : 1000);
    const closeBoth = (code?: number, reason?: string) => { try { serverWs.close(sanitizeCode(code), (reason||'').slice(0,120)); } catch {} try { upstreamWs.close(sanitizeCode(code), (reason||'').slice(0,120)); } catch {} };
    upstreamWs.addEventListener('message', (e: MessageEvent) => { try { serverWs.send(e.data as string | ArrayBuffer); } catch { closeBoth(); } });
    serverWs.addEventListener('message', (e: MessageEvent) => { try { upstreamWs.send(e.data as string | ArrayBuffer); } catch { closeBoth(); } });
    upstreamWs.addEventListener('close', (e: CloseEvent) => closeBoth(e.code, e.reason)); serverWs.addEventListener('close', (e: CloseEvent) => closeBoth(e.code, e.reason));
    upstreamWs.addEventListener('error', () => closeBoth(1000, 'upstream error')); serverWs.addEventListener('error', () => closeBoth(1000, 'client error'));
    const respHeaders = new Headers(); const negotiated = wsResp.headers.get('Sec-WebSocket-Protocol') || request.headers.get('Sec-WebSocket-Protocol');
    if (negotiated) respHeaders.set('Sec-WebSocket-Protocol', negotiated.split(',')[0].trim());
    return new Response(null, { status: 101, webSocket: clientWs, headers: respHeaders } as ResponseInit) as Response;
  }
  const fwdHeaders = new Headers(request.headers); fwdHeaders.delete('cookie'); fwdHeaders.delete('host');
  let upstream: Response; try { upstream = await fetch(target, { method: request.method, headers: fwdHeaders, body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body, redirect: 'manual' }); } catch { return new Response('Preview server unreachable', { status: 502 }); }
  const headers = new Headers(); upstream.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value); });
  const nullBody = upstream.status === 101 || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  if (nullBody) return new Response(null, { status: upstream.status, headers });
  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    let html = await upstream.text(); const tag = '<script src="/inspector-script.js"></script>';
    if (html.includes('</head>')) html = html.replace('</head>', `${tag}</head>`); else html = `${tag}${html}`;
    return new Response(html, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
};
