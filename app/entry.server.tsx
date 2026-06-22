import type { AppLoadContext } from '@remix-run/cloudflare';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import { renderToReadableStream } from 'react-dom/server';
import { renderHeadToString } from 'remix-island';
import { Head } from './root';
import { themeStore } from '~/lib/stores/theme';

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: any,
  _loadContext: AppLoadContext,
) {
  // await initializeModelList({});

  const readable = await renderToReadableStream(<RemixServer context={remixContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      console.error(error);
      responseStatusCode = 500;
    },
  });

  const body = new ReadableStream({
    start(controller) {
      const head = renderHeadToString({ request, remixContext, Head });

      controller.enqueue(
        new Uint8Array(
          new TextEncoder().encode(
            `<!DOCTYPE html><html lang="en" data-theme="${themeStore.value}"><head>${head}</head><body><div id="root" class="w-full h-full">`,
          ),
        ),
      );

      const reader = readable.getReader();

      function read() {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller.enqueue(new Uint8Array(new TextEncoder().encode('</div></body></html>')));
              controller.close();

              return;
            }

            controller.enqueue(value);
            read();
          })
          .catch((error) => {
            controller.error(error);
            readable.cancel();
          });
      }
      read();
    },

    cancel() {
      readable.cancel();
    },
  });

  if (isbot(request.headers.get('user-agent') || '')) {
    await readable.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');

  /*
   * Prevent Cloudflare edge cache AND Pages-internal asset cache from serving
   * stale HTML. The standard `Cache-Control: no-store` alone is NOT enough —
   * Cloudflare's CDN layer needs its own directives:
   *   - `Cloudflare-CDN-Cache-Control`: Cloudflare-specific, takes precedence
   *   - `CDN-Cache-Control`: standard RFC 9211, respected by Cloudflare and other CDNs
   *   - `Surrogate-Control`: legacy, respected by some caching layers
   *   - `Cache-Tag`: enables tag-based purging (Enterprise feature, harmless on Free plan)
   *
   * Root cause of the original bug: the old Next.js deployment set a long
   * s-maxage on `/`, Cloudflare cached the HTML, and `Cache-Control: no-store`
   * on the new Remix responses did NOT clear the existing cached entry.
   * `Cloudflare-CDN-Cache-Control: no-store` explicitly forbids Cloudflare
   * from caching, and combined with `Vary: *` ensures every request is unique.
   */
  responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store, max-age=0');
  responseHeaders.set('CDN-Cache-Control', 'no-store, max-age=0');
  responseHeaders.set('Surrogate-Control', 'no-store');
  responseHeaders.set('Vary', '*');
  responseHeaders.set('Cache-Tag', 'palmkit-html');

  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
