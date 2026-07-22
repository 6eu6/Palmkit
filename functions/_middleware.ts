/**
 * Global middleware — runs on EVERY request before any route.
 *
 * ROOT FIX for the "white screen on returning users" bug:
 *
 * The old LogStore wrote ALL debug logs as a JSON cookie ('eventLogs').
 * With 500+ entries, this cookie could reach 100-200KB. Browsers send
 * ALL cookies with every HTTP request. When the total cookie header
 * exceeds ~8KB, Cloudflare rejects the request with a 502/400 error,
 * and the user sees a white screen.
 *
 * The client-side fix (logs.ts) migrates the cookie to localStorage
 * and deletes it — BUT if the page can't load at all (because the
 * cookie is too large), the client fix never runs. Chicken-and-egg.
 *
 * This middleware breaks the cycle: it strips the 'eventLogs' cookie
 * from the incoming request headers BEFORE the app sees it, and sets
 * a response header to delete it from the browser. The page loads
 * cleanly, then the client-side code handles the migration.
 *
 * This is a ROOT fix, not a patch — once all users have been cleaned
 * up, this middleware can be removed (though it's harmless to keep).
 */

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;

  /*
   * Check if the incoming request has an 'eventLogs' cookie.
   * If so, strip it from the request so the app never sees the
   * oversized cookie. This prevents the 502/400 from Cloudflare.
   */
  const cookieHeader = request.headers.get('Cookie') || '';

  if (cookieHeader.includes('eventLogs=')) {
    /*
     * Strip the eventLogs cookie from the request.
     * We rebuild the cookie header without it.
     */
    const cleanedCookies = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .filter((c) => !c.startsWith('eventLogs='))
      .join('; ');

    /*
     * Clone the request with cleaned cookies.
     * This is the critical step — the app receives a request
     * WITHOUT the giant cookie, so it can process normally.
     */
    const cleanedRequest = new Request(request, {
      headers: new Headers(request.headers),
    });

    if (cleanedCookies) {
      cleanedRequest.headers.set('Cookie', cleanedCookies);
    } else {
      cleanedRequest.headers.delete('Cookie');
    }

    /*
     * Pass the cleaned request to the next handler.
     * On the response, add a Set-Cookie header to delete
     * the eventLogs cookie from the browser.
     */
    const response = await context.next(cleanedRequest);
    const newResponse = new Response(response.body, response);

    // Delete the eventLogs cookie (expired + max-age=0)
    newResponse.headers.append(
      'Set-Cookie',
      'eventLogs=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0',
    );

    return newResponse;
  }

  /*
   * No eventLogs cookie — pass through normally.
   */
  return context.next();
};
