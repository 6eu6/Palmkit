import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';
import { default as IndexRoute } from './_index';

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

export default IndexRoute;
