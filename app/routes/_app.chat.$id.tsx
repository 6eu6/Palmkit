/**
 * /chat/:id — Individual chat route.
 *
 * The loader reads the chat ID for the chat history hook (useChatHistory)
 * which restores messages from IndexedDB. The UI (<Header /> + <Chat />)
 * is rendered by the parent _app.tsx layout route — this route returns null.
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

export default function ChatIdRoute() {
  /*
   * <Header /> and <Chat /> are rendered by _app.tsx (layout route).
   * The chat ID from the URL is picked up by useChatHistory hook which
   * reads it from the route params and loads the messages.
   */
  return null;
}
