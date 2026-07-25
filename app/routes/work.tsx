/**
 * /work — Work mode entry point.
 *
 * Sets sidebar mode to 'work' and renders the work interface.
 * URL: palmkit.app/work
 *
 * Work mode = documents, images, PDFs, analysis, scheduled tasks.
 * Tools: generate_image, generate_video, create_pdf, read_url, web_search.
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

  return (
    <div className="relative flex flex-col h-full w-full bg-palmkit-elements-background-depth-1">
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
