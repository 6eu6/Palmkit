/**
 * /code/:id — individual code conversation.
 *
 * The loader reads the chat ID for the chat history hook (useChatHistory).
 * The UI is rendered by the parent _app.tsx layout route — this route
 * returns null.
 */

import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

export async function loader(args: LoaderFunctionArgs) {
  const env = getEnv(args.context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  let authed = true;
  let headers = new Headers();

  if (authEnabled) {
    const { user, headers: h } = await getAuthedUser(args.request, args.context);
    headers = h;
    authed = Boolean(user);
  }

  return json({ id: args.params.id, authed }, { headers });
}

export default function CodeIdRoute() {
  return null;
}
