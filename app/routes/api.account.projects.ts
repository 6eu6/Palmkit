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
    const { data, error } = await supabase
      .from('projects')
      .select('url_id, description, messages, snapshot, updated_at')
      .eq('user_id', user.id)
      .eq('url_id', id)
      .maybeSingle();

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

  const { data, error } = await supabase
    .from('projects')
    .select('url_id, description, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

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

  const { error } = await supabase.from('projects').upsert(
    {
      user_id: user.id,
      url_id: urlId,
      description: body.description ?? null,
      messages: body.messages ?? [],
      snapshot: inlineSnapshot,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,url_id' },
  );

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true }, { headers });
}
