import { beforeEach, describe, expect, it } from 'vitest';
import { collectBuildFiles, collectProjectFiles } from '~/lib/deploy/collect-build-files';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

/**
 * What a deploy uploads.
 *
 * This was four copies of a recursive `readdir`/`readFile` walk over the
 * WebContainer API, and there was no WebContainer — a shim satisfied the
 * interface and read the workbench underneath. Untested in all four copies,
 * and the kind of thing whose failure mode is a live site missing half its
 * files.
 */
const file = (content: string, isBinary = false) => ({ type: 'file' as const, content, isBinary });

function project(files: Record<string, unknown>) {
  workbenchStore.files.set(files as never);
}

beforeEach(() => project({}));

describe('the build output', () => {
  it('takes the directory the build reported', () => {
    project({
      [`${WORK_DIR}/dist/index.html`]: file('<html>'),
      [`${WORK_DIR}/dist/assets/app.js`]: file('js'),
      [`${WORK_DIR}/src/main.ts`]: file('source'),
    });

    const { files, buildPath } = collectBuildFiles(`${WORK_DIR}/dist`);

    expect(buildPath).toBe('/dist');
    expect(Object.keys(files).sort()).toEqual(['/assets/app.js', '/index.html']);
  });

  it('paths are relative to the build root, so a deploy can use them as-is', () => {
    project({ [`${WORK_DIR}/dist/nested/deep/a.css`]: file('css') });

    expect(Object.keys(collectBuildFiles(`${WORK_DIR}/dist`).files)).toEqual(['/nested/deep/a.css']);
  });

  /* The model's reported path is a hint; the usual suspects are the fallback. */
  it('falls back to the common output directories', () => {
    project({ [`${WORK_DIR}/build/index.html`]: file('<html>') });

    expect(collectBuildFiles('/nonexistent').buildPath).toBe('/build');
  });

  it('finds the output with no hint at all', () => {
    project({ [`${WORK_DIR}/out/index.html`]: file('<html>') });

    expect(collectBuildFiles().buildPath).toBe('/out');
  });

  it('says so rather than deploying an empty site', () => {
    project({ [`${WORK_DIR}/src/main.ts`]: file('source') });

    expect(() => collectBuildFiles()).toThrow(/build output directory/i);
  });

  /*
   * The old walk read every entry as utf-8, which turns an image into
   * mojibake. Skipping it is worse for the image and better for everything
   * else, and it is what the old code effectively did to text.
   */
  it('skips binary files instead of mangling them', () => {
    project({
      [`${WORK_DIR}/dist/index.html`]: file('<html>'),
      [`${WORK_DIR}/dist/logo.png`]: file('PNG', true),
    });

    expect(Object.keys(collectBuildFiles(`${WORK_DIR}/dist`).files)).toEqual(['/index.html']);
  });
});

describe('the whole project, for a repository push', () => {
  it('uses paths relative to the root, without a leading slash', () => {
    project({
      [`${WORK_DIR}/index.html`]: file('<html>'),
      [`${WORK_DIR}/src/app.ts`]: file('ts'),
    });

    expect(Object.keys(collectProjectFiles()).sort()).toEqual(['index.html', 'src/app.ts']);
  });

  it('leaves out what nobody commits', () => {
    project({
      [`${WORK_DIR}/index.html`]: file('<html>'),
      [`${WORK_DIR}/node_modules/react/index.js`]: file('lib'),
      [`${WORK_DIR}/.git/HEAD`]: file('ref'),
      [`${WORK_DIR}/dist/bundle.js`]: file('built'),
      [`${WORK_DIR}/.next/cache/x`]: file('cache'),
    });

    expect(Object.keys(collectProjectFiles())).toEqual(['index.html']);
  });

  /* A .env in a public repo is the expensive one. */
  it('never pushes secrets or noise', () => {
    project({
      [`${WORK_DIR}/app.ts`]: file('ok'),
      [`${WORK_DIR}/.env`]: file('SECRET=1'),
      [`${WORK_DIR}/.env.local`]: file('SECRET=2'),
      [`${WORK_DIR}/debug.log`]: file('noise'),
      [`${WORK_DIR}/.DS_Store`]: file('junk'),
    });

    expect(Object.keys(collectProjectFiles())).toEqual(['app.ts']);
  });

  it('keeps a file whose name merely contains an excluded word', () => {
    project({
      [`${WORK_DIR}/src/build-utils.ts`]: file('ok'),
      [`${WORK_DIR}/distance.ts`]: file('ok'),
    });

    expect(Object.keys(collectProjectFiles()).sort()).toEqual(['distance.ts', 'src/build-utils.ts']);
  });

  it('excludes an excluded directory at any depth', () => {
    project({
      [`${WORK_DIR}/packages/ui/node_modules/x/index.js`]: file('lib'),
      [`${WORK_DIR}/packages/ui/index.ts`]: file('ok'),
    });

    expect(Object.keys(collectProjectFiles())).toEqual(['packages/ui/index.ts']);
  });
});
