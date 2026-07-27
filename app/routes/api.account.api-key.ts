import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { decryptSecret, encryptSecret } from '~/lib/auth/crypto.server';

/**
 * Per-user encrypted API key storage.
 *  - GET  → returns whether a key is stored and (optionally) the decrypted key.
 *  - POST → upserts an encrypted key (provider + ciphertext) for the user.
 *  - DELETE → removes the stored key.
 *
 * The key is encrypted at rest with AES-GCM (API_KEY_ENCRYPTION_KEY). Row Level
 * Security on `user_api_keys` ensures a user can only ever touch their own row.
 */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ stored: false, error: 'unauthorized' }, { status: 401, headers });
  }

  const { data, error } = await supabase
    .from('user_api_keys')
    .select('provider, encrypted_key')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return Response.json({ stored: false, error: error.message }, { status: 500, headers });
  }

  if (!data) {
    return Response.json({ stored: false }, { headers });
  }

  const wantReveal = new URL(request.url).searchParams.get('reveal') === '1';
  const masterKey = getEnv(context).API_KEY_ENCRYPTION_KEY;

  if (wantReveal && masterKey) {
    try {
      const apiKey = await decryptSecret(data.encrypted_key, masterKey);
      return Response.json({ stored: true, provider: data.provider, apiKey }, { headers });
    } catch {
      return Response.json({ stored: true, provider: data.provider, error: 'decrypt_failed' }, { headers });
    }
  }

  return Response.json({ stored: true, provider: data.provider }, { headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }

  if (request.method === 'DELETE') {
    const { error } = await supabase.from('user_api_keys').delete().eq('user_id', user.id);

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    return Response.json({ ok: true }, { headers });
  }

  const masterKey = getEnv(context).API_KEY_ENCRYPTION_KEY;

  if (!masterKey) {
    return Response.json(
      { ok: false, error: 'Server missing API_KEY_ENCRYPTION_KEY; cannot store keys securely.' },
      { status: 500, headers },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { apiKey?: string; provider?: string };
  const apiKey = (body.apiKey ?? '').trim();
  const provider = (body.provider ?? 'OpenRouter').trim();

  if (!apiKey) {
    return Response.json({ ok: false, error: 'apiKey is required.' }, { status: 400, headers });
  }

  const encrypted = await encryptSecret(apiKey, masterKey);

  const { error } = await supabase.from('user_api_keys').upsert(
    { user_id: user.id, provider, encrypted_key: encrypted, updated_at: new Date().toISOString() },
    {
      onConflict: 'user_id',
    },
  );

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true, provider }, { headers });
}
