/**
 * /code — Code mode entry point.
 *
 * Sets sidebar mode to 'code' and renders the code interface.
 * URL: palmkit.app/code
 *
 * Code mode = build apps, write code, preview, deploy.
 * Tools: read_file, list_files, run_shell, generate_image (assets), grep.
 */

import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Palmkit Code — Build apps' },
    {
      name: 'description',
      content: 'Build web apps from natural language. Preview, edit, and deploy.',
    },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  if (authEnabled) {
    const { user, headers } = await getAuthedUser(request, context);
    return json({ authed: Boolean(user), mode: 'code' as const }, { headers });
  }

  return json({ authed: true, mode: 'code' as const });
}

export default function CodeRoute() {
  const { authed } = useLoaderData<typeof loader>();

  if (!authed) {
    window.location.href = '/';
    return null;
  }

  return (
    <div className="relative flex flex-col h-full w-full bg-palmkit-elements-background-depth-1">
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
