/**
 * A filesystem for isomorphic-git, backed by the project itself.
 *
 * Cloning a repository writes it into the workbench, which is where the editor,
 * the preview and the deploys all read from. That was already true — the
 * WebContainer shim's `fs` did exactly this underneath — but it was reached
 * through an API pretending to be a real filesystem, so the actual destination
 * was two indirections away and nothing said so.
 *
 * Only what git asks for is here: `stat` and its friends are built in useGit
 * from these primitives, and always were.
 */
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

/** Paths arrive relative to the project root, or absolute within it. */
function resolve(p: string): string {
  const clean = p.replace(/\/+$/, '');
  return clean.startsWith('/') ? clean : `${WORK_DIR}/${clean}`;
}

function enoent(p: string): Error & { code?: string } {
  const error = new Error(`ENOENT: no such file or directory, '${p}'`) as Error & { code?: string };
  error.code = 'ENOENT';

  return error;
}

/** Every readable text file, keyed by its full path. */
function textFiles(): Map<string, string> {
  const files = new Map<string, string>();

  for (const [path, dirent] of Object.entries(workbenchStore.files.get())) {
    if (dirent?.type === 'file' && !dirent.isBinary) {
      files.set(path, dirent.content || '');
    }
  }

  return files;
}

/** What `readdir({ withFileTypes: true })` hands back, as git expects it. */
export interface ProjectDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export const projectFs = {
  async writeFile(p: string, data: string | Uint8Array): Promise<void> {
    const content = typeof data === 'string' ? data : new TextDecoder().decode(data);
    workbenchStore.files.setKey(resolve(p), { type: 'file', content, isBinary: false });
  },

  async readFile(p: string, encoding?: string): Promise<string | Uint8Array> {
    const files = textFiles();
    const key = resolve(p);

    if (!files.has(key)) {
      throw enoent(p);
    }

    const content = files.get(key)!;

    return encoding ? content : new TextEncoder().encode(content);
  },

  async readdir(p: string, opts?: { withFileTypes?: boolean }): Promise<ProjectDirent[] | string[]> {
    const prefix = `${resolve(p)}/`;
    const files = textFiles();
    const names = new Set<string>();

    for (const key of files.keys()) {
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
      return list.map((name): ProjectDirent => {
        const isDirectory = [...files.keys()].some((k) => k.startsWith(`${prefix}${name}/`));
        return { name, isDirectory: () => isDirectory, isFile: () => !isDirectory };
      });
    }

    return list;
  },

  /* Folders are implied by the paths of the files inside them. */
  async mkdir(_p: string, _opts?: unknown): Promise<void> {
    return undefined;
  },

  async rm(p: string, opts?: { recursive?: boolean }): Promise<void> {
    const key = resolve(p);
    workbenchStore.files.setKey(key, undefined as never);

    if (opts?.recursive) {
      for (const path of Object.keys(workbenchStore.files.get())) {
        if (path.startsWith(`${key}/`)) {
          workbenchStore.files.setKey(path, undefined as never);
        }
      }
    }
  },
};
