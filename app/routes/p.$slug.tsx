import { type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { getEnv } from '~/lib/auth/supabase.server';

/**
 * Public deployment route — serves deployed apps at /p/{slug}.
 *
 * No auth required. Anyone with the URL can view the deployed app.
 *
 * Flow:
 *   1. Look up the deployment by url_slug in the deployments table
 *   2. Fetch the HTML from Supabase Storage (public bucket)
 *   3. Return it as text/html
 *
 * The HTML is self-contained (CSS/JS inlined at deploy time) so no
 * additional asset requests are needed — the app renders in one response.
 */

export const meta: MetaFunction = () => [
  { title: 'Deployed App — Palmkit' },
  { name: 'description', content: 'A project deployed on Palmkit' },
];

export async function loader({ params, context }: LoaderFunctionArgs) {
  const slug = params.slug;

  if (!slug) {
    return new Response('Not found', { status: 404 });
  }

  const env = getEnv(context);
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response('Server configuration error', { status: 500 });
  }

  /*
   * Step 1: Look up the deployment by slug.
   * The deployments table has a public read RLS policy, so the anon key works.
   */
  const queryUrl = `${supabaseUrl}/rest/v1/deployments?url_slug=eq.${encodeURIComponent(slug)}&select=storage_path,title,framework`;

  const queryRes = await fetch(queryUrl, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
  });

  if (!queryRes.ok) {
    return new Response('Failed to look up deployment', { status: 500 });
  }

  const deployments = (await queryRes.json()) as Array<{
    storage_path: string;
    title: string;
    framework: string;
  }>;

  if (!deployments || deployments.length === 0) {
    return new Response('Deployment not found', { status: 404 });
  }

  const deployment = deployments[0];

  /*
   * Step 2: Fetch the HTML from Supabase Storage (public bucket).
   * URL pattern: {supabaseUrl}/storage/v1/object/public/deployments/{storage_path}
   */
  const storageUrl = `${supabaseUrl}/storage/v1/object/public/deployments/${deployment.storage_path}`;

  const htmlRes = await fetch(storageUrl);

  if (!htmlRes.ok) {
    return new Response('Deployed app content not found', { status: 404 });
  }

  const html = await htmlRes.text();

  /*
   * Step 3: Return the HTML directly.
   * Set Content-Type to text/html and allow the browser to render it.
   * No COEP/COOP headers — this is a standalone page, not an iframe embed.
   */
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
