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

  /*
   * Newest columns first, dropping one per attempt.
   *
   * PostgREST rejects the whole select when a single column is missing, so a
   * database that has 0015 but not 0016/0017 would 500 here and the Projects
   * section would look broken rather than merely behind. Each fallback trades
   * one feature for the rest still working.
   */
  const columnSets = [
    'id, name, color, memory_mode, instructions, created_at, updated_at',
    'id, name, color, memory_mode, created_at, updated_at',
    'id, name, color, created_at, updated_at',
  ];

  let data: unknown[] | null = null;
  let error: { code?: string; message?: string } | null = null;

  for (const columns of columnSets) {
    ({ data, error } = await supabase
      .from('folders')
      .select(columns)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false }));

    if (!error || isMissingFolders(error)) {
      break;
    }
  }

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
    memory_mode?: string;
    instructions?: string | null;
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
  const memoryMode = body.memory_mode === 'project_only' ? 'project_only' : 'default';

  const row = {
    ...(body.id ? { id: body.id } : {}),
    user_id: user.id,
    name,
    color: body.color ?? null,
    updated_at: new Date().toISOString(),
    ...(body.created_at ? { created_at: body.created_at } : {}),
  };

  /*
   * instructions ships in 0017, memory_mode in 0016 — shed them one at a time
   * so a database missing only the newest one keeps the older setting. Dropping
   * both together would silently reset every project to shared memory.
   */
  const attempts = [
    { ...row, memory_mode: memoryMode, instructions: body.instructions ?? null },
    { ...row, memory_mode: memoryMode },
    row,
  ];

  let data: unknown = null;
  let error: { code?: string; message?: string } | null = null;

  for (const attempt of attempts) {
    ({ data, error } = await supabase.from('folders').upsert(attempt, { onConflict: 'id' }).select().maybeSingle());

    if (!error || isMissingFolders(error)) {
      break;
    }
  }

  if (error) {
    if (isMissingFolders(error)) {
      return Response.json({ ok: true, unavailable: true }, { headers });
    }

    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true, folder: data }, { headers });
}
