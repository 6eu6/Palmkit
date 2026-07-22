/**
 * Global middleware — runs on EVERY request before any route.
 *
 * ROOT FIX for the "white screen on returning users" bug:
 *
 * The old LogStore wrote ALL debug logs as a JSON cookie ('eventLogs').
 * With 500+ entries, this cookie could reach 100-200KB. When the browser
 * sends this giant cookie with every request, it can cause issues.
 *
 * This middleware does ONE thing: on every response, it adds a Set-Cookie
 * header to delete the 'eventLogs' cookie. This is non-destructive — it
 * doesn't modify the request or the response body, so streaming works
 * normally. The cookie is deleted on the browser side, and the client-side
 * logs.ts handles the migration to localStorage.
 *
 * Why not strip the cookie from the request? Because modifying the request
 * body/headers in a Pages Function can break streaming responses (Remix
 * uses streaming for SSR). The simpler approach is to just delete the
 * cookie on the response side — the browser stops sending it after the
 * first load.
 */

export const onRequest: PagesFunction = async (context) => {
  /*
   * Pass through the request normally — don't modify it.
   * This preserves streaming, headers, and body integrity.
   */
  const response = await context.next();

  /*
   * On every response, add a Set-Cookie header to delete eventLogs.
   * This is idempotent — if the cookie doesn't exist, this is a no-op.
   * If it does exist (oversized), the browser deletes it immediately.
   *
   * We use headers.append (not set) to avoid overwriting other Set-Cookie
   * headers that the app might have added (like auth tokens).
   */
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  newResponse.headers.append(
    'Set-Cookie',
    'eventLogs=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0',
  );

  return newResponse;
};
