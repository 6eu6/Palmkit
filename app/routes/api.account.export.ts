import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';

/**
 * GDPR data export: returns a JSON document with everything we store about the
 * signed-in user — profile, projects (chats + snapshots), and which providers
 * they have keys for. The keys themselves stay on the server.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  }

  const [{ data: profile }, { data: projects }, { data: keyRows }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('projects')
      .select('url_id, description, messages, snapshot, created_at, updated_at')
      .eq('user_id', user.id),
    supabase.from('user_api_keys').select('provider, updated_at').eq('user_id', user.id),
  ]);

  // Snapshots are offloaded to Storage; pull each one so the export is complete.
  const projectsWithSnapshots = await Promise.all(
    (projects ?? []).map(async (proj) => {
      if (proj.snapshot) {
        return proj;
      }

      try {
        const { data } = await supabase.storage.from('project-snapshots').download(`${user.id}/${proj.url_id}.json`);

        if (data) {
          return { ...proj, snapshot: JSON.parse(await data.text()) };
        }
      } catch {
        // leave snapshot as-is
      }

      return proj;
    }),
  );

  /*
   * Providers and dates, never the keys themselves.
   *
   * This export used to decrypt every key into the downloaded file — a
   * plaintext credential in whatever folder the browser saves to, forwarded
   * to whoever the user shares their export with. Nobody needs their own key
   * back out of Palmkit; they already have it from the provider, and if they
   * do not, the provider will issue another.
   */
  const apiKeys = (keyRows ?? []).map((row) => ({ provider: row.provider, updated_at: row.updated_at }));

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile: profile ?? null,
    apiKeys,
    projects: projectsWithSnapshots,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: (() => {
      headers.set('Content-Type', 'application/json');
      headers.set('Content-Disposition', `attachment; filename="palmkit-data-${user.id}.json"`);

      return headers;
    })(),
  });
}
