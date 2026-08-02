import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';

/**
 * Per-user projects ("folders" in storage — the `projects` table holds
 * conversations, see migration 0015).
 *
 *  - GET                 → list the user's folders
 *  - POST {id?,name,...} → create (no id) or update (id) a folder
 *  - DELETE ?id=<id>     → remove the folder; its conversations are detached,
 *                          never deleted (ON DELETE SET NULL in 0015)
 */

const MAX_NAME = 60;

/**
 * Migration 0015 may not have run yet. Rather than 500 on every call — which
 * would make the whole Projects section look broken — report the table as
 * simply empty and let the client keep folders local-only until it lands.
 */
function isMissingFolders(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }

  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation .*folders.* does not exist/i.test(error.message ?? '') ||
    /could not find the table/i.test(error.message ?? '')
  );
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  }

  const { data, error } = await supabase
    .from('folders')
    .select('id, name, color, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    if (isMissingFolders(error)) {
      return Response.json({ folders: [], unavailable: true }, { headers });
    }

    return Response.json({ error: error.message }, { status: 500, headers });
  }

  return Response.json({ folders: data ?? [] }, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');

    if (!id) {
      return Response.json({ ok: false, error: 'id is required' }, { status: 400, headers });
    }

    const { error } = await supabase.from('folders').delete().eq('user_id', user.id).eq('id', id);

    if (error && !isMissingFolders(error)) {
      return Response.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    return Response.json({ ok: true }, { headers });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    color?: string;
    created_at?: string;
  };

  const name = (body.name ?? '').trim();

  if (!name || name.length > MAX_NAME) {
    return Response.json({ ok: false, error: `name must be 1-${MAX_NAME} characters` }, { status: 400, headers });
  }

  /*
   * The id is generated on the client so a project can be created, used and
   * moved into offline, then mirrored later under the same identity.
   */
  const row = {
    ...(body.id ? { id: body.id } : {}),
    user_id: user.id,
    name,
    color: body.color ?? null,
    updated_at: new Date().toISOString(),
    ...(body.created_at ? { created_at: body.created_at } : {}),
  };

  const { data, error } = await supabase.from('folders').upsert(row, { onConflict: 'id' }).select().maybeSingle();

  if (error) {
    if (isMissingFolders(error)) {
      return Response.json({ ok: true, unavailable: true }, { headers });
    }

    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true, folder: data }, { headers });
}
