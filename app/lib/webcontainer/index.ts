import type { WebContainer } from '@webcontainer/api';
import { createWebContainerShim } from './shim';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

/*
 * WebContainer (the in-browser runtime) has been removed. Every project now runs
 * in an E2B cloud sandbox on all devices — build on the Oracle worker, preview
 * via the same-origin /preview/ proxy. Dropping the in-browser runtime also let
 * us drop the global COEP: require-corp header it required, which had been
 * blocking external images/fonts inside the preview iframe.
 *
 * The many modules that still `await webcontainer` (editor saveFile, the file
 * watcher, legacy deploy/search/terminal) keep working against a lightweight
 * in-memory shim — see ./shim.ts. The workbench store stays the source of truth.
 */
if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve().then(() => {
      webcontainerContext.loaded = true;
      return createWebContainerShim();
    });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
