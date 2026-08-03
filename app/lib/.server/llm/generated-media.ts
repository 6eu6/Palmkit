import type { SupabaseClient } from '@supabase/supabase-js';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('generated-media');

const BUCKET = 'generated-media';

/**
 * How long a link to a generated file stays valid.
 *
 * A week: long enough that reopening a conversation tomorrow still shows the
 * picture, short enough that a link copied out of a chat does not stay live
 * indefinitely. Re-signing on read would be better and is a separate change.
 */
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

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
 */

export interface StoredMedia {
  url: string;
  path: string;
  bytes: number;
  mime: string;
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
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

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

    const { data, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (signError || !data?.signedUrl) {
      logger.warn(`Stored media but could not sign a URL: ${signError?.message ?? 'no url returned'}`);
      return undefined;
    }

    return { url: data.signedUrl, path, bytes: bytes.length, mime };
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
): Promise<string | undefined> {
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

    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = '';

    for (let i = 0; i < buf.length; i++) {
      binary += String.fromCharCode(buf[i]);
    }

    return `data:${mime};base64,${btoa(binary)}`;
  } catch (err) {
    logger.warn(`Could not read stored media: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
