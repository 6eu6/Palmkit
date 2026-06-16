import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import { Landing } from '~/components/landing/Landing';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { getAuthedUser, getEnv } from '~/lib/auth/supabase.server';

/**
 * Internal mirror of the root route used by the Cloudflare `_redirects` rewrite
 * rule `/ /home 200`. The rewrite lets "/" bypass any stale static index.html
 * left over from the old Next.js deployment (Cloudflare processes _redirects
 * BEFORE static assets, so the Function always wins). The URL in the browser
 * stays "/", while the request is silently proxied to this route.
 */
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
    <div className="flex flex-col h-full w-full bg-palmkit-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}
