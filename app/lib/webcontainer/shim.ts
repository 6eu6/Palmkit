/**
 * WebContainer shim — a drop-in stand-in for `@webcontainer/api`'s WebContainer.
 *
 * Palmkit runs every project in an E2B cloud sandbox (build on the Oracle worker,
 * preview via the same-origin /preview/ proxy) on ALL devices. WebContainer —
 * the in-browser runtime — is gone: it can't run real dev servers reliably, it
 * breaks on refresh, and its `SharedArrayBuffer` requirement forced a global
 * `COEP: require-corp` header that blocked external images/fonts from rendering
 * inside the preview iframe. Dropping it lets us drop COEP so previews render
 * external resources like the real web.
 *
 * Many modules still `await webcontainer` and call its `fs`/`spawn`/`workdir`
 * API (the editor's saveFile, the file watcher, legacy deploy/search/terminal).
 * Rather than rip those call sites apart, this shim satisfies the same interface
 * so they keep working:
 *   - The workbench store (FilesStore.files) remains the single source of truth
 *     for the editor + preview seeding; saveFile updates it directly.
 *   - `fs.*` is a best-effort in-memory filesystem so writes/reads don't throw.
 *   - `spawn` throws a clear message (the shell runs in the cloud sandbox), which
 *     the terminal already catches and displays.
 *   - The watcher / preview-message hooks are no-ops.
 */

import type { WebContainer } from '@webcontainer/api';
import { WORK_DIR } from '~/utils/constants';
import { workbenchStore } from '~/lib/stores/workbench';

function createInMemoryFs() {
  // Sync with the workbench store — the single source of truth for files.
  // The workbench store (FilesStore.files) holds all project files keyed by
  // WORK_DIR-prefixed paths. The shim's fs reads/writes through it so that
  // deploy components (GitHubDeploy, NetlifyDeploy, etc.) can collect files
  // for deployment without a real WebContainer.

  const norm = (p: string): string => {
    const clean = p.replace(/\/+$/, '');
    return clean.startsWith('/') ? clean : `${WORK_DIR}/${clean}`;
  };

  const enoent = (p: string): Error => {
    const e = new Error(`ENOENT: no such file or directory, '${p}'`) as Error & { code?: string };
    e.code = 'ENOENT';
    return e;
  };

  // Get the current files from the workbench store
  const getStoreFiles = (): Map<string, string> => {
    const map = workbenchStore.files.get();
    const files = new Map<string, string>();
    for (const [path, dirent] of Object.entries(map)) {
      if (dirent && dirent.type === 'file' && !dirent.isBinary) {
        files.set(path, dirent.content || '');
      }
    }
    return files;
  };

  return {
    async writeFile(p: string, data: string | Uint8Array): Promise<void> {
      // Write to workbench store
      const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
      workbenchStore.files.setKey(norm(p), { type: 'file', content, isBinary: false });
    },

    async readFile(p: string, encoding?: string): Promise<string | Uint8Array> {
      const key = norm(p);
      const storeFiles = getStoreFiles();
      if (!storeFiles.has(key)) {
        throw enoent(p);
      }
      const content = storeFiles.get(key)!;
      return encoding ? content : new TextEncoder().encode(content);
    },

    async readdir(p: string, opts?: { withFileTypes?: boolean }): Promise<unknown[]> {
      const prefix = `${norm(p)}/`;
      const storeFiles = getStoreFiles();
      const names = new Set<string>();

      for (const key of storeFiles.keys()) {
        if (key.startsWith(prefix)) {
          const child = key.slice(prefix.length).split('/')[0];
          if (child) {
            names.add(child);
          }
        }
      }

      if (names.size === 0) {
        throw enoent(p);
      }

      const list = [...names];

      if (opts?.withFileTypes) {
        return list.map((name) => {
          const isDir = [...storeFiles.keys()].some((k) => k.startsWith(`${prefix}${name}/`));
          return { name, isDirectory: () => isDir, isFile: () => !isDir };
        });
      }

      return list;
    },

    async mkdir(_p: string, _opts?: unknown): Promise<void> {
      // Directories are implicit — nothing to do.
    },

    async rm(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
      const key = norm(p);
      workbenchStore.files.setKey(key, undefined as any);

      if (opts?.recursive) {
        const dirPrefix = `${key}/`;
        const storeFiles = getStoreFiles();
        for (const k of [...storeFiles.keys()]) {
          if (k.startsWith(dirPrefix)) {
            workbenchStore.files.setKey(k, undefined as any);
          }
        }
      }
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      const a = norm(oldPath);
      const b = norm(newPath);
      const storeFiles = getStoreFiles();
      if (storeFiles.has(a)) {
        workbenchStore.files.setKey(b, { type: 'file', content: storeFiles.get(a)!, isBinary: false });
        workbenchStore.files.setKey(a, undefined as any);
      }
    },
  };
}

/**
 * Build a WebContainer-shaped object. Cast through `unknown` because we only
 * implement the members Palmkit actually calls — the rest of the WebContainer
 * surface is never touched now that the real runtime is gone.
 */
export function createWebContainerShim(): WebContainer {
  const shim = {
    workdir: WORK_DIR,
    fs: createInMemoryFs(),
    internal: {
      /*
       * The file watcher never fires — the worker flow sets workbenchStore.files
       * directly, so there is nothing to watch.
       */
      watchPaths: () => undefined,
    },
    on: () => () => undefined,
    setPreviewScript: async () => undefined,
    spawn: async () => {
      throw new Error('The shell runs in the cloud sandbox (E2B), not in the browser.');
    },
    mount: async () => undefined,
    export: async () => ({}),
    teardown: () => undefined,
  };

  return shim as unknown as WebContainer;
}
