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
 * `projects.mode` ships in migration 0011. A deployment whose database has not
 * run that migration yet would fail EVERY read and write here, taking project
 * sync down entirely — so each query falls back to the pre-0011 column list.
 * Once the migration is applied the fallbacks stop firing and the tab a
 * conversation belongs to starts round-tripping through the account.
 */
interface ProjectRow {
  url_id: string;
  description: string | null;
  messages?: unknown;
  snapshot?: unknown;
  mode?: string | null;
  updated_at: string;
}

/*
 * A missing `mode` column does NOT report the same way on reads and writes.
 *
 * `mode` is also the name of a built-in Postgres ordered-set aggregate. When
 * the column is absent the planner resolves the bare identifier in the select
 * list to that FUNCTION instead, and raises 42809 — "WITHIN GROUP is required
 * for ordered-set aggregate mode" — not the usual "column does not exist".
 * Quoting, casting and aliasing it in the select all resolve the same way;
 * only the column actually existing turns it back into a column reference.
 * Writes, where `mode` is a JSON body key rather than an identifier, fail the
 * ordinary way with 42703 / PGRST204. Both shapes are matched here.
 */
function isMissingModeColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) {
    return false;
  }

  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.code === '42809' ||
    /column .*mode.* does not exist/i.test(error.message ?? '') ||
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

    let { data, error } = await one('url_id, description, messages, snapshot, mode, updated_at');

    if (isMissingModeColumn(error)) {
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

  let { data, error } = await many('url_id, description, mode, updated_at');

  if (isMissingModeColumn(error)) {
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

  let { error } = await supabase.from('projects').upsert({ ...row, mode }, { onConflict: 'user_id,url_id' });

  if (isMissingModeColumn(error)) {
    ({ error } = await supabase.from('projects').upsert(row, { onConflict: 'user_id,url_id' }));
  }

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true }, { headers });
}
