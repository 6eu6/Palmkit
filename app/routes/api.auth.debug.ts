import { type LoaderFunctionArgs, json } from '@remix-run/cloudflare';

/**
 * Diagnostic endpoint — returns the status of Supabase auth configuration.
 * This helps debug why OAuth buttons might not work.
 * Only shows whether variables are set (NOT their values — that would be a security risk).
 */
export async function loader({ request: _request, context }: LoaderFunctionArgs) {
  const cloudflareEnv =
    (context as unknown as { cloudflare?: { env?: Record<string, string | undefined> } }).cloudflare?.env ?? {};

  const hasSupabaseUrl = Boolean(cloudflareEnv.SUPABASE_URL);
  const hasSupabaseAnonKey = Boolean(cloudflareEnv.SUPABASE_ANON_KEY);
  const hasViteSupabaseUrl = Boolean(cloudflareEnv.VITE_SUPABASE_URL);
  const hasViteSupabaseAnonKey = Boolean(cloudflareEnv.VITE_SUPABASE_ANON_KEY);
  const hasProcessSupabaseUrl = Boolean(process.env.SUPABASE_URL);
  const hasProcessSupabaseAnonKey = Boolean(process.env.SUPABASE_ANON_KEY);
  const hasProcessViteSupabaseUrl = Boolean(process.env.VITE_SUPABASE_URL);
  const hasProcessViteSupabaseAnonKey = Boolean(process.env.VITE_SUPABASE_ANON_KEY);

  const allCloudflareKeys = Object.keys(cloudflareEnv).filter(
    (k) => k.includes('SUPABASE') || k.includes('API_KEY_ENCRYPTION'),
  );

  return json({
    authEnabled: hasSupabaseUrl && hasSupabaseAnonKey,
    cloudflareEnv: {
      SUPABASE_URL: hasSupabaseUrl ? '✅ set' : '❌ missing',
      SUPABASE_ANON_KEY: hasSupabaseAnonKey ? '✅ set' : '❌ missing',
      VITE_SUPABASE_URL: hasViteSupabaseUrl ? '✅ set' : '❌ missing',
      VITE_SUPABASE_ANON_KEY: hasViteSupabaseAnonKey ? '✅ set' : '❌ missing',
      allSupabaseKeys: allCloudflareKeys.length > 0 ? allCloudflareKeys : 'none found',
    },
    processEnv: {
      SUPABASE_URL: hasProcessSupabaseUrl ? '✅ set' : '❌ missing',
      SUPABASE_ANON_KEY: hasProcessSupabaseAnonKey ? '✅ set' : '❌ missing',
      VITE_SUPABASE_URL: hasProcessViteSupabaseUrl ? '✅ set' : '❌ missing',
      VITE_SUPABASE_ANON_KEY: hasProcessViteSupabaseAnonKey ? '✅ set' : '❌ missing',
    },
    hint:
      !hasSupabaseUrl && !hasViteSupabaseUrl
        ? 'No Supabase URL found anywhere! Set SUPABASE_URL in Cloudflare Pages dashboard > Settings > Environment variables.'
        : hasViteSupabaseUrl && !hasSupabaseUrl
          ? 'Only VITE_SUPABASE_URL is set. The code will use it as fallback, but for best results also set SUPABASE_URL (without VITE_ prefix).'
          : 'Configuration looks good.',
  });
}
