import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOwnMediaAsDataUrl } from '~/lib/.server/llm/generated-media';

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
