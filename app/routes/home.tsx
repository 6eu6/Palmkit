import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { Landing } from '~/components/landing/Landing';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

export const meta: MetaFunction = () => {
  return [
    { title: 'Palmkit — build web apps from your phone' },
    {
      name: 'description',
      content: 'Palmkit — build, preview and export AI-generated web apps right from your phone.',
    },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  if (authEnabled) {
    const { user, headers } = await getAuthedUser(request, context);
    return json({ authed: Boolean(user) }, { headers });
  }

  return json({ authed: true });
}

export default function Home() {
  const { authed } = useLoaderData<typeof loader>();

  if (!authed) {
    return <Landing />;
  }

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
