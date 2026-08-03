import type { SupabaseClient } from '@supabase/supabase-js';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('generated-media');

const BUCKET = 'generated-media';

/**
 * How long a signed link lasts once /api/media issues one.
 *
 * Short on purpose. The link is now made at the moment it is followed, so it
 * only has to survive the redirect and the download that follows it.
 */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Where a stored file is reached from. Deliberately short — see below. */
export const MEDIA_URL_PREFIX = '/api/media/';

/**
 * The file name, as it appears after the prefix: a uuid and an extension.
 *
 * Anything else is refused rather than passed to storage, so a model cannot
 * put `../` or another user's folder in a tool argument and have the server
 * fetch it on their behalf.
 */
export const MEDIA_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$/;

/** The file part of a reference this app issued, or undefined. */
export function mediaFileFromUrl(url: string): string | undefined {
  const at = url.indexOf(MEDIA_URL_PREFIX);

  if (at === -1) {
    return undefined;
  }

  const file = url.slice(at + MEDIA_URL_PREFIX.length).split(/[?#]/)[0];

  return MEDIA_FILE_PATTERN.test(file) ? file : undefined;
}

/**
 * Where generated images and video live.
 *
 * They used to live in the tool result itself, as a base64 data URL. That
 * result goes to two places at once — the browser, which needs the pixels,
 * and back into the model's context, which does not — and a 673KB JPEG is
 * about 224,000 tokens of base64 against a 204,800 context. So asking for an
 * image and then a video made from it stopped after the image: there was no
 * room left for a second turn. It was also written into the stored
 * conversation, so every reopen carried a megabyte nothing needed.
 *
 * A short URL costs the model about ten tokens.
 *
 * It has to be genuinely short, though, and the first version was not. The
 * tool handed back a signed Supabase URL — 529 characters, most of it a JWT —
 * and the model was expected to copy it verbatim into an asset action. It
 * copied 528 of them. One character inside the token payload came out wrong,
 * the signature stopped matching the path, storage answered 400, and the page
 * shipped with a missing video. Nothing in the pipeline was broken except the
 * assumption that a model can transcribe half a kilobyte of base64.
 *
 * So what the model sees is `/api/media/<uuid>.<ext>` — fifty-one characters,
 * shaped like the file paths it writes all day. There is no token in it to
 * corrupt, it never expires, and it cannot point anywhere but the signed-in
 * user's own folder, because that route builds the storage path from the
 * session rather than from anything the model said.
 */

export interface StoredMedia {
  url: string;
  path: string;
  bytes: number;
  mime: string;
}

/** Chunked so a multi-megabyte clip does not blow the argument limit. */
function toBase64(buf: Uint8Array): string {
  let binary = '';

  for (let i = 0; i < buf.length; i += 0x8000) {
    binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }

  return btoa(binary);
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

export async function storeGeneratedMedia(
  supabase: SupabaseClient,
  userId: string,
  bytes: Uint8Array,
  mime: string,
): Promise<StoredMedia | undefined> {
  const ext = EXTENSIONS[mime] ?? 'bin';
  const file = `${crypto.randomUUID()}.${ext}`;
  const path = `${userId}/${file}`;

  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });

    if (error) {
      /*
       * Most likely the bucket does not exist because migration 0022 has not
       * been applied. The caller falls back to a data URL, which is what it
       * did before — degraded, not broken.
       */
      logger.warn(`Could not store generated media: ${error.message}`);
      return undefined;
    }

    /*
     * No signing here. The reference handed back is a route on this app, and
     * the signature is made when someone follows it — so what travels through
     * the model has nothing in it that can go stale or be mistyped into
     * something that fails a signature check.
     */
    return { url: `${MEDIA_URL_PREFIX}${file}`, path, bytes: bytes.length, mime };
  } catch (err) {
    logger.warn(`Could not store generated media: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Read back something this app stored, as a data URL.
 *
 * `generate_video` needs the actual bytes of a starting frame, and the model
 * only ever holds the link. Fetching happens here, on the server, so the
 * picture goes from storage to the provider without passing through the
 * conversation a second time.
 *
 * Only URLs this app issued are followed. A model that has read a web page
 * can put any URL in a tool argument, and a server that fetches whatever it
 * is told will happily read a cloud metadata endpoint or something behind
 * the firewall on that model's behalf.
 */
export async function fetchOwnMediaAsDataUrl(
  url: string,
  allowedHost: string | undefined,
  own?: { supabase: SupabaseClient; userId: string },
): Promise<string | undefined> {
  /*
   * The normal case now: a reference this app issued. The bytes come straight
   * out of storage under the signed-in user's own folder, so there is no URL
   * to validate and no request to make — the model cannot name a file outside
   * that folder because the folder comes from the session, not from the
   * argument.
   */
  const file = mediaFileFromUrl(url);

  if (file && own) {
    try {
      const { data, error } = await own.supabase.storage.from(BUCKET).download(`${own.userId}/${file}`);

      if (error || !data) {
        logger.warn(`Could not read own media ${file}: ${error?.message ?? 'not found'}`);
        return undefined;
      }

      const mime = data.type || 'image/png';

      if (!mime.startsWith('image/')) {
        return undefined;
      }

      return `data:${mime};base64,${toBase64(new Uint8Array(await data.arrayBuffer()))}`;
    } catch (err) {
      logger.warn(`Could not read own media: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'https:') {
      return undefined;
    }

    if (!allowedHost || parsed.hostname !== allowedHost) {
      logger.warn(`Refusing to fetch media from an unexpected host: ${parsed.hostname}`);
      return undefined;
    }

    const res = await fetch(url);

    if (!res.ok) {
      return undefined;
    }

    const mime = res.headers.get('content-type') ?? 'image/png';

    if (!mime.startsWith('image/')) {
      return undefined;
    }

    return `data:${mime};base64,${toBase64(new Uint8Array(await res.arrayBuffer()))}`;
  } catch (err) {
    logger.warn(`Could not read stored media: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
