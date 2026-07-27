import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { decryptSecret } from '~/lib/auth/crypto.server';

/**
 * GDPR data export: returns a JSON document with everything we store about the
 * signed-in user — profile, projects (chats + snapshots), and their decrypted
 * API key (it's their own data, returned only to them over HTTPS).
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  }

  const [{ data: profile }, { data: projects }, { data: keyRow }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase
      .from('projects')
      .select('url_id, description, messages, snapshot, created_at, updated_at')
      .eq('user_id', user.id),
    supabase.from('user_api_keys').select('provider, encrypted_key, updated_at').eq('user_id', user.id).maybeSingle(),
  ]);

  let apiKey: { provider: string; key: string | null; updated_at: string } | null = null;

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

  if (keyRow) {
    const masterKey = getEnv(context).API_KEY_ENCRYPTION_KEY;
    let decrypted: string | null = null;

    if (masterKey) {
      try {
        decrypted = await decryptSecret(keyRow.encrypted_key, masterKey);
      } catch {
        decrypted = null;
      }
    }

    apiKey = { provider: keyRow.provider, key: decrypted, updated_at: keyRow.updated_at };
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email },
    profile: profile ?? null,
    apiKey,
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
