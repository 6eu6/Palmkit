import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthedUser } from '~/lib/auth/supabase.server';

/**
 * Per-user project (chat) sync, backed by the `projects` table with RLS.
 * Large file snapshots are offloaded to the private `project-snapshots` Storage
 * bucket (path: <user_id>/<url_id>.json) to keep table rows small; the
 * projects.snapshot column is left null when a snapshot is stored in Storage.
 *
 *  - GET                → list projects (url_id, description, updated_at).
 *  - GET ?id=<urlId>    → full project (messages + snapshot).
 *  - POST {url_id,...}  → upsert a project.
 *  - DELETE ?id=<urlId> → remove a project.
 */

const BUCKET = 'project-snapshots';

/**
 * `projects.mode` ships in migration 0011 and `projects.pinned` in 0014. A
 * database that has not run them yet would fail EVERY read and write here,
 * taking project sync down entirely — so each query falls back to the older
 * column list. Once the migrations are applied the fallbacks stop firing and
 * both the tab a conversation belongs to and its pin state round-trip through
 * the account.
 */
interface ProjectRow {
  url_id: string;
  description: string | null;
  messages?: unknown;
  snapshot?: unknown;
  mode?: string | null;
  pinned?: boolean | null;
  folder_id?: string | null;
  updated_at: string;
}

/*
 * A missing column does NOT report the same way on reads and writes, and
 * `mode` is a special case on top of that.
 *
 * `mode` is also the name of a built-in Postgres ordered-set aggregate. When
 * the column is absent the planner resolves the bare identifier in the select
 * list to that FUNCTION instead, and raises 42809 — "WITHIN GROUP is required
 * for ordered-set aggregate mode" — not the usual "column does not exist".
 * Quoting, casting and aliasing it in the select all resolve the same way;
 * only the column actually existing turns it back into a column reference.
 * `pinned` collides with nothing, so it fails the ordinary way (42703).
 * Writes, where both are JSON body keys rather than identifiers, also fail
 * the ordinary way with 42703 / PGRST204. Every shape is matched here.
 */
function isMissingNewColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }

  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.code === '42809' ||
    /column .*(mode|pinned|folder_id).* does not exist/i.test(error.message ?? '') ||
    /ordered-set aggregate mode/i.test(error.message ?? '')
  );
}

function snapshotPath(userId: string, urlId: string): string {
  return `${userId}/${urlId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

async function readSnapshotFromStorage(
  supabase: SupabaseClient,
  userId: string,
  urlId: string,
): Promise<unknown | null> {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(snapshotPath(userId, urlId));

    if (error || !data) {
      return null;
    }

    const text = await data.text();

    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  }

  const id = new URL(request.url).searchParams.get('id');

  if (id) {
    const one = async (columns: string) => {
      const res = await supabase.from('projects').select(columns).eq('user_id', user.id).eq('url_id', id).maybeSingle();

      /*
       * The column list is dynamic (see isMissingModeColumn), so the row shape
       * can't be inferred from it.
       */
      return res as unknown as { data: ProjectRow | null; error: { code?: string; message?: string } | null };
    };

    let { data, error } = await one('url_id, description, messages, snapshot, mode, pinned, folder_id, updated_at');

    if (isMissingNewColumn(error)) {
      ({ data, error } = await one('url_id, description, messages, snapshot, updated_at'));
    }

    if (error) {
      return Response.json({ error: error.message }, { status: 500, headers });
    }

    if (!data) {
      return Response.json({ project: null }, { headers });
    }

    // Prefer the Storage snapshot; fall back to the inline column (legacy rows).
    const storageSnapshot = await readSnapshotFromStorage(supabase, user.id, id);
    const project = { ...data, snapshot: storageSnapshot ?? data.snapshot ?? null };

    return Response.json({ project }, { headers });
  }

  const many = async (columns: string) => {
    const res = await supabase
      .from('projects')
      .select(columns)
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    return res as unknown as { data: ProjectRow[] | null; error: { code?: string; message?: string } | null };
  };

  let { data, error } = await many('url_id, description, mode, pinned, folder_id, updated_at');

  if (isMissingNewColumn(error)) {
    ({ data, error } = await many('url_id, description, updated_at'));
  }

  if (error) {
    return Response.json({ error: error.message }, { status: 500, headers });
  }

  return Response.json({ projects: data ?? [] }, { headers });
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

    await supabase.storage
      .from(BUCKET)
      .remove([snapshotPath(user.id, id)])
      .catch(() => undefined);

    const { error } = await supabase.from('projects').delete().eq('user_id', user.id).eq('url_id', id);

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    return Response.json({ ok: true }, { headers });
  }

  const body = (await request.json().catch(() => ({}))) as {
    url_id?: string;
    description?: string;
    messages?: unknown;
    snapshot?: unknown;
    mode?: string;
    pinned?: boolean;
    folder_id?: string | null;
  };

  const urlId = (body.url_id ?? '').trim();

  if (!urlId) {
    return Response.json({ ok: false, error: 'url_id is required' }, { status: 400, headers });
  }

  /*
   * Offload the file snapshot to Storage. If that fails, keep it inline so we
   * never lose data.
   */
  let inlineSnapshot: unknown = null;

  if (body.snapshot) {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(snapshotPath(user.id, urlId), JSON.stringify(body.snapshot), {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadError) {
      inlineSnapshot = body.snapshot;
    }
  }

  /*
   * `mode` is column-constrained to these three values, so an unknown value
   * would fail the whole upsert. Fall back to the table default instead.
   */
  const mode = ['chat', 'work', 'code'].includes(body.mode ?? '') ? body.mode : 'code';

  const row = {
    user_id: user.id,
    url_id: urlId,
    description: body.description ?? null,
    messages: body.messages ?? [],
    snapshot: inlineSnapshot,
    updated_at: new Date().toISOString(),
  };

  const pinned = body.pinned === true;

  /*
   * Newest column first, shedding one per attempt: folder_id ships in 0015,
   * pinned in 0014, mode in 0011.
   *
   * folder_id was missing from this write entirely while the SELECT above
   * already asked for it, so every conversation was stored with a null
   * project. It looked correct on the device that filed it — IndexedDB held
   * the truth — and lost its project the moment another device synced, or
   * this one re-seeded from the account.
   */
  const attempts = [
    { ...row, mode, pinned, folder_id: body.folder_id ?? null },
    { ...row, mode, pinned },
    { ...row, mode },
    row,
  ];

  let error: { code?: string; message?: string } | null = null;

  for (const attempt of attempts) {
    ({ error } = await supabase.from('projects').upsert(attempt, { onConflict: 'user_id,url_id' }));

    if (!isMissingNewColumn(error)) {
      break;
    }
  }

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true }, { headers });
}
