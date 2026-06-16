import { useStore } from '@nanostores/react';
import { json, type LinksFunction, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ClientOnly } from 'remix-utils/client-only';
import { cssTransition, ToastContainer } from 'react-toastify';
import { getAuthedUser, getEnv } from './lib/auth/supabase.server';
import { decryptSecret } from './lib/auth/crypto.server';
import { authEnabledStore, authUserStore, type AuthUser } from './lib/stores/auth';
import { profileStore } from './lib/stores/profile';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/palmkit-icon.jpg',
    type: 'image/jpeg',
  },
  {
    rel: 'apple-touch-icon',
    href: '/palmkit-icon.jpg',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = getEnv(context);
  const authEnabled = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);

  let user: AuthUser | null = null;
  let headers = new Headers();

  if (authEnabled) {
    const result = await getAuthedUser(request, context);
    headers = result.headers;

    if (result.user) {
      const meta = (result.user.user_metadata ?? {}) as Record<string, string>;
      user = {
        id: result.user.id,
        email: result.user.email ?? undefined,
        name: meta.user_name || meta.name || meta.full_name || undefined,
        avatarUrl: meta.avatar_url || undefined,
      };

      /*
       * If the user has a stored API key and the browser doesn't already have
       * a valid (non-empty) one, hydrate the `apiKeys` cookie from the account
       * (decrypted) so they don't re-enter it.
       *
       * We check for at least one non-empty key value — a cookie like
       * `{"OpenRouter":""}` should NOT block the Supabase sync.
       */
      const hasValidApiKeyCookie = (() => {
        const cookieStr = request.headers.get('Cookie') || '';
        const match = cookieStr.match(/(?:^|;\s*)apiKeys=([^;]*)/);

        if (!match) {
          return false;
        }

        try {
          const parsed: Record<string, string> = JSON.parse(decodeURIComponent(match[1]));
          return Object.values(parsed).some((v) => typeof v === 'string' && v.length > 0);
        } catch {
          return false;
        }
      })();

      if (!hasValidApiKeyCookie && result.supabase && env.API_KEY_ENCRYPTION_KEY) {
        const { data } = await result.supabase
          .from('user_api_keys')
          .select('provider, encrypted_key')
          .eq('user_id', result.user.id)
          .maybeSingle();

        if (data?.encrypted_key) {
          try {
            const apiKey = await decryptSecret(data.encrypted_key, env.API_KEY_ENCRYPTION_KEY);
            const cookieValue = encodeURIComponent(JSON.stringify({ [data.provider]: apiKey }));
            headers.append('Set-Cookie', `apiKeys=${cookieValue}; Path=/; Max-Age=2592000; SameSite=Lax`);
          } catch {
            // ignore decrypt failures
          }
        }
      }
    }
  }

  return json({ user, authEnabled, supabaseUrl: env.SUPABASE_URL ?? null, supabaseAnonKey: env.SUPABASE_ANON_KEY ?? null }, { headers });
}

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    let theme = localStorage.getItem('palmkit_theme');

    if (!theme) {
      theme = 'dark';
    }

    document.querySelector('html')?.setAttribute('data-theme', theme);
  }
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      <ClientOnly>{() => <DndProvider backend={HTML5Backend}>{children}</DndProvider>}</ClientOnly>
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-palmkit-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-palmkit-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
        autoClose={3000}
      />
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

import { logStore } from './lib/stores/logs';
import { isRouteErrorResponse, useRouteError } from '@remix-run/react';

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}: ${typeof error.data === 'string' ? error.data : JSON.stringify(error.data)}`
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  return (
    <div className="min-h-screen flex items-center justify-center bg-palmkit-elements-bg-depth-1 text-palmkit-elements-textPrimary p-6">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h1 className="text-xl font-bold mb-3">Something went wrong</h1>
        <p className="text-sm text-palmkit-elements-textSecondary mb-4 break-words">{message}</p>
        {message.includes('Supabase') && (
          <p className="text-xs text-palmkit-elements-textTertiary mb-4">
            Make sure SUPABASE_URL and SUPABASE_ANON_KEY are set as environment variables.
          </p>
        )}
        <a
          href="/"
          className="inline-block px-5 py-2.5 rounded-xl text-sm font-medium text-white"
          style={{ background: 'linear-gradient(135deg, #00A8B5 0%, #008C97 140%)' }}
        >
          Go home
        </a>
      </div>
    </div>
  );
}

export default function App() {
  const theme = useStore(themeStore);
  const { user, authEnabled } = useLoaderData<typeof loader>();

  useEffect(() => {
    authEnabledStore.set(authEnabled);
    authUserStore.set(user);

    // Reflect the signed-in account in the existing profile UI.
    if (user) {
      profileStore.set({
        username: user.name || user.email?.split('@')[0] || 'Account',
        bio: '',
        avatar: user.avatarUrl || '',
      });
    }
  }, [user, authEnabled]);

  useEffect(() => {
    logStore.logSystem('Application initialized', {
      theme,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });

    // Initialize debug logging with improved error handling
    import('./utils/debugLogger')
      .then(({ debugLogger }) => {
        /*
         * The debug logger initializes itself and starts disabled by default
         * It will only start capturing when enableDebugMode() is called
         */
        const status = debugLogger.getStatus();
        logStore.logSystem('Debug logging ready', {
          initialized: status.initialized,
          capturing: status.capturing,
          enabled: status.enabled,
        });
      })
      .catch((error) => {
        logStore.logError('Failed to initialize debug logging', error);
      });
  }, []);

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
