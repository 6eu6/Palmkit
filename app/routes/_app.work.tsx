/**
 * /work — Work mode entry point.
 *
 * Sets sidebar mode to 'work' and renders the work interface.
 * URL: palmkit.app/work
 *
 * Work mode = documents, images, PDFs, analysis, scheduled tasks.
 * Tools: generate_image, generate_video, create_pdf, read_url, web_search.
 *
 * NOTE: <Header /> and <Chat /> are rendered by the parent _app.tsx layout
 * route, so they stay mounted across tab switches (no flicker).
 */

import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Palmkit Work — Documents & Media' },
    {
      name: 'description',
      content: 'Create documents, generate images, analyze data, and manage tasks.',
    },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  if (authEnabled) {
    const { user, headers } = await getAuthedUser(request, context);
    return json({ authed: Boolean(user), mode: 'work' as const }, { headers });
  }

  return json({ authed: true, mode: 'work' as const });
}

export default function WorkRoute() {
  const { authed } = useLoaderData<typeof loader>();

  if (!authed) {
    window.location.href = '/';
    return null;
  }

  return null;
}
