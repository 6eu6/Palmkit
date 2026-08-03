/**
 * The files a deploy should upload, taken from the project itself.
 *
 * All four deploy targets used to walk a directory tree through the
 * WebContainer API — `fs.readdir`, then `fs.readFile` on every entry, the same
 * recursive function copied four times. There has been no WebContainer behind
 * that API for a while: a shim satisfied the interface and read from the
 * workbench store underneath, so the deploys were reading the workbench the
 * long way round, through a filesystem that does not exist.
 *
 * This reads it directly. One implementation instead of four, and no
 * dependency on a runtime the app no longer has.
 */
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

export interface CollectedBuildFiles {
  /** Deploy path (leading slash, relative to the build root) → contents. */
  files: Record<string, string>;

  /** Which directory the files were found in. */
  buildPath: string;
}

/** Where a build output tends to land, in the order worth trying. */
const COMMON_OUTPUT_DIRS = ['/dist', '/build', '/out', '/output', '/.next', '/public'];

/**
 * Everything under the build directory, keyed by its path within that
 * directory.
 *
 * `preferred` comes from the build action's own reported output path; if
 * nothing is there, the usual suspects are tried in turn. Binary files are
 * skipped rather than mangled into a string — that was already true of the
 * old code, which read every entry as utf-8.
 */
export function collectBuildFiles(preferred?: string): CollectedBuildFiles {
  const all = workbenchStore.files.get();

  const candidates = [...(preferred ? [preferred.replace(WORK_DIR, '') || '/'] : []), ...COMMON_OUTPUT_DIRS];

  for (const dir of candidates) {
    const prefix = `${WORK_DIR}${dir === '/' ? '' : dir}/`;
    const files: Record<string, string> = {};

    for (const [fullPath, dirent] of Object.entries(all)) {
      if (!fullPath.startsWith(prefix) || dirent?.type !== 'file' || dirent.isBinary) {
        continue;
      }

      files[`/${fullPath.slice(prefix.length)}`] = dirent.content;
    }

    if (Object.keys(files).length > 0) {
      return { files, buildPath: dir };
    }
  }

  throw new Error('Could not find build output directory. Please check your build configuration.');
}

/** Directories no repository push should ever carry. */
const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '.cache', '.next'];

/** Files that are noise, generated, or secret. */
const skipFile = (name: string) => name.endsWith('.DS_Store') || name.endsWith('.log') || name.startsWith('.env');

/**
 * The whole project, as a repository push wants it: paths relative to the
 * root, no leading slash, without the directories and files nobody commits.
 *
 * Same story as collectBuildFiles — this was a recursive readdir through an
 * API with nothing behind it, written out twice.
 */
export function collectProjectFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const prefix = `${WORK_DIR}/`;

  for (const [fullPath, dirent] of Object.entries(workbenchStore.files.get())) {
    if (!fullPath.startsWith(prefix) || dirent?.type !== 'file' || dirent.isBinary) {
      continue;
    }

    const relative = fullPath.slice(prefix.length);
    const segments = relative.split('/');

    if (segments.slice(0, -1).some((s) => SKIP_DIRS.includes(s)) || skipFile(segments.at(-1) ?? '')) {
      continue;
    }

    files[relative] = dirent.content;
  }

  return files;
}
