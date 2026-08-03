import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { encryptSecret } from '~/lib/auth/crypto.server';
import { keyHint, listProviderKeys } from '~/lib/.server/llm/user-keys';

/**
 * Per-provider encrypted API keys.
 *
 *  - GET                          → every connected provider, no secrets
 *  - POST   {apiKey, provider}    → store or replace that provider's key
 *  - POST   {provider, activate}  → switch which provider requests go to
 *  - DELETE ?provider=X           → forget one provider (all, if omitted)
 *
 * The decrypted key is never returned. It used to be, through `?reveal=1`,
 * which meant the plaintext key travelled to the browser and sat in a network
 * log, within reach of any XSS or browser extension, purely so the UI could
 * display it. `key_hint` — the last four characters — does that job without
 * the secret ever leaving the server.
 *
 * AES-GCM at rest via API_KEY_ENCRYPTION_KEY; RLS on `user_api_keys` means a
 * user can only ever touch their own rows.
 */

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ stored: false, error: 'unauthorized' }, { status: 401, headers });
  }

  const keys = await listProviderKeys(supabase, user.id);
  const active = keys.find((k) => k.isActive) ?? keys[0];

  return Response.json(
    {
      /*
       * `stored` and `provider` are kept for callers written against the
       * single-key shape this endpoint used to have.
       */
      stored: keys.length > 0,
      provider: active?.provider,
      keys,
    },
    { headers },
  );
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  }

  if (request.method === 'DELETE') {
    const provider = new URL(request.url).searchParams.get('provider');

    let query = supabase.from('user_api_keys').delete().eq('user_id', user.id);

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { error } = await query;

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    /*
     * Deleting the active provider leaves the user with keys but nothing
     * selected, and every request would then fail with no explanation. Promote
     * whatever is left instead.
     */
    if (provider) {
      const remaining = await listProviderKeys(supabase, user.id);

      if (remaining.length && !remaining.some((k) => k.isActive)) {
        await supabase
          .from('user_api_keys')
          .update({ is_active: true })
          .eq('user_id', user.id)
          .eq('provider', remaining[0].provider);
      }
    }

    return Response.json({ ok: true }, { headers });
  }

  const body = (await request.json().catch(() => ({}))) as {
    apiKey?: string;
    provider?: string;
    activate?: boolean;
  };

  const provider = (body.provider ?? 'OpenRouter').trim();

  if (!provider) {
    return Response.json({ ok: false, error: 'provider is required.' }, { status: 400, headers });
  }

  /* Switching providers — no new secret involved. */
  if (body.activate && !body.apiKey) {
    const deactivate = await supabase.from('user_api_keys').update({ is_active: false }).eq('user_id', user.id);

    if (deactivate.error) {
      return Response.json({ ok: false, error: deactivate.error.message }, { status: 500, headers });
    }

    const { error } = await supabase
      .from('user_api_keys')
      .update({ is_active: true })
      .eq('user_id', user.id)
      .eq('provider', provider);

    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 500, headers });
    }

    return Response.json({ ok: true, provider }, { headers });
  }

  const masterKey = getEnv(context).API_KEY_ENCRYPTION_KEY;

  if (!masterKey) {
    return Response.json(
      { ok: false, error: 'Server missing API_KEY_ENCRYPTION_KEY; cannot store keys securely.' },
      { status: 500, headers },
    );
  }

  const apiKey = (body.apiKey ?? '').trim();

  if (!apiKey) {
    return Response.json({ ok: false, error: 'apiKey is required.' }, { status: 400, headers });
  }

  const encrypted = await encryptSecret(apiKey, masterKey);

  /*
   * A newly added key becomes the active one — adding a provider and then
   * having to switch to it separately is a second step for a decision the
   * user has already expressed by adding it. Deactivate first, because the
   * unique index permits exactly one.
   */
  await supabase.from('user_api_keys').update({ is_active: false }).eq('user_id', user.id);

  const row = {
    user_id: user.id,
    provider,
    encrypted_key: encrypted,
    is_active: true,
    key_hint: keyHint(apiKey),
    updated_at: new Date().toISOString(),
  };

  let { error } = await supabase.from('user_api_keys').upsert(row, { onConflict: 'user_id,provider' });

  if (error) {
    /*
     * Before migration 0020 the primary key is user_id alone and the extra
     * columns do not exist, so fall back to the old single-key shape rather
     * than refusing to save anything at all.
     */
    ({ error } = await supabase.from('user_api_keys').upsert(
      {
        user_id: user.id,
        provider,
        encrypted_key: encrypted,
        updated_at: row.updated_at,
      },
      { onConflict: 'user_id' },
    ));
  }

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers });
  }

  return Response.json({ ok: true, provider }, { headers });
}
