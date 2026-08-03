import { beforeEach, describe, expect, it } from 'vitest';
import { projectFs, type ProjectDirent } from '~/lib/git/project-fs';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

/**
 * The filesystem isomorphic-git writes a clone into.
 *
 * This used to be the WebContainer's `fs`, reached through a shim that wrote
 * into the workbench store underneath — so the destination was always the
 * project, two indirections away, with nothing saying so. It is the project
 * directly now, and these are the operations git actually calls: `stat` and
 * its friends are built in useGit out of exactly these.
 *
 * Worth pinning because a clone that silently writes nowhere looks identical
 * to a clone that failed, and neither shows up until someone imports a repo.
 */
function reset(files: Record<string, { type: 'file'; content: string; isBinary: boolean } | undefined> = {}) {
  workbenchStore.files.set(files as never);
}

beforeEach(() => reset());

const file = (content: string) => ({ type: 'file' as const, content, isBinary: false });

describe('writing', () => {
  it('puts a relative path inside the project', async () => {
    await projectFs.writeFile('src/app.ts', 'export const a = 1;');

    expect(workbenchStore.files.get()[`${WORK_DIR}/src/app.ts`]).toEqual({
      type: 'file',
      content: 'export const a = 1;',
      isBinary: false,
    });
  });

  it('leaves an absolute path where it is', async () => {
    await projectFs.writeFile(`${WORK_DIR}/README.md`, '# hi');
    expect(workbenchStore.files.get()[`${WORK_DIR}/README.md`]).toBeTruthy();
  });

  /* git hands over bytes for anything it does not know is text. */
  it('accepts bytes as well as a string', async () => {
    await projectFs.writeFile('a.txt', new TextEncoder().encode('bytes'));
    expect((workbenchStore.files.get()[`${WORK_DIR}/a.txt`] as { content: string }).content).toBe('bytes');
  });
});

describe('reading', () => {
  it('returns text when an encoding is asked for, bytes otherwise', async () => {
    reset({ [`${WORK_DIR}/a.txt`]: file('hello') });

    expect(await projectFs.readFile('a.txt', 'utf8')).toBe('hello');
    expect(await projectFs.readFile('a.txt')).toBeInstanceOf(Uint8Array);
  });

  /*
   * git relies on the error code, not the message: it probes for files it
   * expects to be missing and treats ENOENT as "not there yet".
   */
  it('throws ENOENT for a file that is not there', async () => {
    await expect(projectFs.readFile('nope.txt', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('listing', () => {
  beforeEach(() =>
    reset({
      [`${WORK_DIR}/src/app.ts`]: file('a'),
      [`${WORK_DIR}/src/lib/util.ts`]: file('b'),
      [`${WORK_DIR}/README.md`]: file('c'),
    }),
  );

  it('lists the immediate children only', async () => {
    expect(await projectFs.readdir('src')).toEqual(['app.ts', 'lib']);
  });

  it('says which children are directories', async () => {
    const entries = (await projectFs.readdir('src', { withFileTypes: true })) as ProjectDirent[];

    expect(entries.find((e) => e.name === 'lib')!.isDirectory()).toBe(true);
    expect(entries.find((e) => e.name === 'app.ts')!.isFile()).toBe(true);
  });

  it('throws ENOENT for a directory with nothing in it', async () => {
    await expect(projectFs.readdir('does-not-exist')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('removing', () => {
  it('removes one file', async () => {
    reset({ [`${WORK_DIR}/a.txt`]: file('a'), [`${WORK_DIR}/b.txt`]: file('b') });
    await projectFs.rm('a.txt');

    expect(workbenchStore.files.get()[`${WORK_DIR}/a.txt`]).toBeUndefined();
    expect(workbenchStore.files.get()[`${WORK_DIR}/b.txt`]).toBeTruthy();
  });

  /* `.git` is removed wholesale after a clone, so this has to reach children. */
  it('removes a whole tree when asked recursively', async () => {
    reset({
      [`${WORK_DIR}/.git/HEAD`]: file('ref'),
      [`${WORK_DIR}/.git/objects/ab/cd`]: file('x'),
      [`${WORK_DIR}/keep.txt`]: file('keep'),
    });

    await projectFs.rm('.git', { recursive: true });

    expect(workbenchStore.files.get()[`${WORK_DIR}/.git/HEAD`]).toBeUndefined();
    expect(workbenchStore.files.get()[`${WORK_DIR}/.git/objects/ab/cd`]).toBeUndefined();
    expect(workbenchStore.files.get()[`${WORK_DIR}/keep.txt`]).toBeTruthy();
  });

  it('leaves children alone when not asked recursively', async () => {
    reset({ [`${WORK_DIR}/dir/inner.txt`]: file('x') });
    await projectFs.rm('dir');

    expect(workbenchStore.files.get()[`${WORK_DIR}/dir/inner.txt`]).toBeTruthy();
  });
});

/* Folders exist because files have paths; there is nothing to create. */
describe('mkdir', () => {
  it('is accepted and changes nothing', async () => {
    reset({ [`${WORK_DIR}/a.txt`]: file('a') });
    await projectFs.mkdir('deep/nested');

    expect(Object.keys(workbenchStore.files.get())).toEqual([`${WORK_DIR}/a.txt`]);
  });
});
