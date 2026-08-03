import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIA_FILE_PATTERN,
  MEDIA_URL_PREFIX,
  fetchOwnMediaAsDataUrl,
  mediaFileFromUrl,
  storeGeneratedMedia,
} from '~/lib/.server/llm/generated-media';

/**
 * Reading a file back is a request the server makes on a model's say-so.
 *
 * The URL arrives in a tool argument, and a model that has just read a web
 * page can put anything there. A server that fetches whatever it is told
 * will read a cloud metadata endpoint, or something behind the firewall,
 * and hand the contents to whoever asked. So the host is checked first.
 */

const HOST = 'project.supabase.co';
const OURS = `https://${HOST}/storage/v1/object/sign/generated-media/user/1.jpg?token=x`;

function mockFetch(body: Uint8Array, contentType: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchOwnMediaAsDataUrl', () => {
  it('reads back a file this app issued', async () => {
    mockFetch(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg');

    expect(await fetchOwnMediaAsDataUrl(OURS, HOST)).toBe('data:image/jpeg;base64,/9j/');
  });

  it('refuses a host it did not issue from', async () => {
    mockFetch(new Uint8Array([1, 2, 3]), 'image/png');

    expect(await fetchOwnMediaAsDataUrl('https://evil.example.com/x.png', HOST)).toBeUndefined();
  });

  /* The classic target: link-local metadata, reachable from inside. */
  it('refuses a cloud metadata address', async () => {
    mockFetch(new Uint8Array([1]), 'image/png');

    expect(await fetchOwnMediaAsDataUrl('https://169.254.169.254/latest/meta-data/', HOST)).toBeUndefined();
  });

  it('refuses plain http even on the right host', async () => {
    mockFetch(new Uint8Array([1]), 'image/png');

    expect(await fetchOwnMediaAsDataUrl(`http://${HOST}/x.png`, HOST)).toBeUndefined();
  });

  it('refuses everything when no host is configured', async () => {
    mockFetch(new Uint8Array([1]), 'image/png');

    expect(await fetchOwnMediaAsDataUrl(OURS, undefined)).toBeUndefined();
  });

  /*
   * A subdomain of the right host is a different host. `evil-project.supabase.co`
   * and a suffix check would let it through.
   */
  it('matches the host exactly, not by suffix', async () => {
    mockFetch(new Uint8Array([1]), 'image/png');

    expect(await fetchOwnMediaAsDataUrl(`https://evil-${HOST}/x.png`, HOST)).toBeUndefined();
    expect(await fetchOwnMediaAsDataUrl(`https://attacker.com/${HOST}/x.png`, HOST)).toBeUndefined();
  });

  it('refuses content that is not an image', async () => {
    mockFetch(new Uint8Array([1]), 'text/html');

    expect(await fetchOwnMediaAsDataUrl(OURS, HOST)).toBeUndefined();
  });

  it('returns nothing rather than throwing on a bad response', async () => {
    mockFetch(new Uint8Array([1]), 'image/png', 404);

    expect(await fetchOwnMediaAsDataUrl(OURS, HOST)).toBeUndefined();
  });

  it('returns nothing rather than throwing on a malformed URL', async () => {
    expect(await fetchOwnMediaAsDataUrl('not a url', HOST)).toBeUndefined();
  });
});

/**
 * What the model is asked to carry between a tool and an asset action.
 *
 * It used to be the signed Supabase URL: 529 characters, most of it a JWT.
 * A real build copied 528 of them correctly — one character inside the token
 * payload came out as `f` instead of `a`, the signature stopped matching the
 * path it was signed for, storage answered 400, and the finished page shipped
 * with a missing video. The page was right, the tool was right, the action was
 * right; the only broken thing was the assumption that a model can transcribe
 * half a kilobyte of base64.
 */
function fakeSupabase(overrides: { upload?: unknown } = {}) {
  return {
    storage: {
      from: () => ({
        upload: vi.fn(async () => overrides.upload ?? { error: null }),
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://x/y' }, error: null })),
      }),
    },
  } as never;
}

describe('what a stored file is called', () => {
  it('hands back a short reference, not a signed URL', async () => {
    const stored = await storeGeneratedMedia(fakeSupabase(), 'user-1', new Uint8Array([1, 2, 3]), 'image/png');

    expect(stored?.url.startsWith(MEDIA_URL_PREFIX)).toBe(true);
    expect(stored?.url.length).toBeLessThan(60);
    expect(stored?.url).not.toContain('token=');
    expect(stored?.url).not.toContain('supabase');
  });

  it('keeps the file inside the user’s own folder', async () => {
    const stored = await storeGeneratedMedia(fakeSupabase(), 'user-1', new Uint8Array([1]), 'video/mp4');

    expect(stored?.path.startsWith('user-1/')).toBe(true);
    expect(stored?.url.endsWith('.mp4')).toBe(true);
  });

  it('says nothing rather than something wrong when the upload fails', async () => {
    const stored = await storeGeneratedMedia(
      fakeSupabase({ upload: { error: { message: 'no such bucket' } } }),
      'user-1',
      new Uint8Array([1]),
      'image/png',
    );

    expect(stored).toBeUndefined();
  });
});

describe('reading a reference back', () => {
  const file = '3f2504e0-4f89-41d3-9a0c-0305e82c3301.mp4';

  it('recognises one this app issued', () => {
    expect(mediaFileFromUrl(`${MEDIA_URL_PREFIX}${file}`)).toBe(file);
    expect(mediaFileFromUrl(`https://palmkit.app${MEDIA_URL_PREFIX}${file}`)).toBe(file);
    expect(mediaFileFromUrl(`${MEDIA_URL_PREFIX}${file}?v=2`)).toBe(file);
  });

  it('does not mistake anything else for one', () => {
    expect(mediaFileFromUrl('https://evil.example/x.png')).toBeUndefined();
    expect(mediaFileFromUrl('https://ijb.supabase.co/storage/v1/object/sign/generated-media/a/b.mp4')).toBeUndefined();
  });

  /*
   * The file name is the only part of the storage path that comes from the
   * model — the folder comes from the session — so a name that tries to leave
   * its folder has to be refused here, before it reaches storage.
   */
  it('refuses a name that tries to climb out of the folder', () => {
    for (const bad of [
      '../other-user/secret.mp4',
      'other-user/3f2504e0-4f89-41d3-9a0c-0305e82c3301.mp4',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301.mp4/../../x',
      '..%2Fx.mp4',
      '3f2504e0.mp4',
      'not-a-uuid.png',
      '',
    ]) {
      expect(MEDIA_FILE_PATTERN.test(bad), `${bad} should be refused`).toBe(false);
      expect(mediaFileFromUrl(`${MEDIA_URL_PREFIX}${bad}`), `${bad} should not resolve`).toBeUndefined();
    }
  });

  it('accepts every name it actually issues', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'video/mp4']) {
      const stored = await storeGeneratedMedia(fakeSupabase(), 'user-1', new Uint8Array([1]), mime);
      const name = stored!.url.slice(MEDIA_URL_PREFIX.length);

      expect(MEDIA_FILE_PATTERN.test(name), `${mime} → ${name}`).toBe(true);
    }
  });

  it('reads its own file straight out of storage, without a request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('no HTTP request should be made for our own media');
      }),
    );

    const supabase = {
      storage: {
        from: () => ({
          download: vi.fn(async () => ({ data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) })),
        }),
      },
    } as never;

    const dataUrl = await fetchOwnMediaAsDataUrl(`${MEDIA_URL_PREFIX}${file}`, HOST, { supabase, userId: 'user-1' });

    expect(dataUrl?.startsWith('data:image/png;base64,')).toBe(true);
  });
});
