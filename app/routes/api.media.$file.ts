/**
 * Follow a reference to something this app generated.
 *
 * `/api/media/<uuid>.<ext>` — that is the whole thing the model ever holds.
 * It replaced a 529-character signed Supabase URL that the model was expected
 * to copy verbatim into an asset action; it copied 528 of the characters
 * correctly, the token no longer matched the path it was signed for, storage
 * answered 400, and a finished page shipped with a missing video.
 *
 * The storage path is built here from the session, never from the request, so
 * the file name in the URL selects a file inside the signed-in user's own
 * folder or it selects nothing. That also means the reference does not expire:
 * the signature is made at the moment someone follows it.
 */
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { MEDIA_FILE_PATTERN, SIGNED_URL_TTL_SECONDS } from '~/lib/.server/llm/generated-media';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.media');

const BUCKET = 'generated-media';

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const file = params.file ?? '';

  /*
   * Checked before anything touches storage: a name with a slash or a `..` in
   * it is the one way this route could be talked into reading someone else's
   * folder, and there is no legitimate reason for one to arrive.
   */
  if (!MEDIA_FILE_PATTERN.test(file)) {
    return new Response('Not found', { status: 404 });
  }

  const { user, supabase } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(`${user.id}/${file}`, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    logger.warn(`No stored media ${file} for this account: ${error?.message ?? 'no url returned'}`);
    return new Response('Not found', { status: 404 });
  }

  /*
   * A redirect rather than a proxy: the bytes go from storage to whoever
   * asked, without a worker in the middle holding a video in memory.
   */
  return new Response(null, {
    status: 302,
    headers: {
      Location: data.signedUrl,

      /* The signed URL behind it is short-lived, so nothing may cache this. */
      'Cache-Control': 'private, no-store',
    },
  });
}
