import { type ActionFunctionArgs, json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { buildStaticPreviewHtml } from '~/lib/runtime/project-analyzer';
import type { FileMap } from '~/lib/common/llm/constants';

/**
 * Internal hosting — deploy apps to Palmkit itself.
 *
 * POST /api/deploy/internal
 *   Body: { files: Record<string, { content: string }>, title?: string, framework?: string }
 *   Response: { url: '/p/{slug}', slug: string }
 *
 * GET /api/deploy/internal
 *   Query: ?userId={uuid}
 *   Response: Deployment[] — list of user's deployments
 *
 * DELETE /api/deploy/internal
 *   Body: { slug: string }
 *   Response: { ok: true }
 *
 * Architecture:
 *   1. Auth check (Supabase session required for POST/DELETE)
 *   2. Build self-contained HTML from project files
 *   3. Upload to Supabase Storage: deployments/{userId}/{slug}.html
 *   4. Insert metadata in deployments table
 *   5. Return public URL: /p/{slug}
 *
 * The deployed app is served by /p/$slug.tsx (public, no auth needed).
 */

const DEPLOYMENTS_BUCKET = 'deployments';

/** Generate a short URL-safe slug (e.g., "a7f3k2m9"). */
function generateSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';

  for (let i = 0; i < 8; i++) {
    slug += chars[Math.floor(Math.random() * chars.length)];
  }

  return slug;
}

/** Convert workbench file paths to a FileMap for the analyzer. */
function buildFileMap(files: Record<string, { content: string }>): FileMap {
  const map: FileMap = {};

  for (const [path, file] of Object.entries(files)) {
    const fullPath = path.startsWith('/home/project/') ? path : `/home/project/${path}`;
    map[fullPath] = { type: 'file', content: file.content, isBinary: false };
  }

  return map;
}

// ─── GET: list user's deployments ───────────────────────────────────────────

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('deployments')
    .select('id, url_slug, title, framework, file_count, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return json({ error: 'Failed to load deployments' }, { status: 500, headers });
  }

  return json({ deployments: data || [] }, { headers });
}

// ─── POST: deploy / DELETE: undeploy ────────────────────────────────────────

export async function action({ request, context }: ActionFunctionArgs) {
  const method = request.method.toUpperCase();

  if (method === 'DELETE') {
    return handleDelete(request, context);
  }

  return handleDeploy(request, context);
}

// ─── Deploy ─────────────────────────────────────────────────────────────────

async function handleDeploy(request: Request, context: ActionFunctionArgs['context']) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { files?: Record<string, { content: string }>; title?: string; framework?: string };

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  if (!body.files || Object.keys(body.files).length === 0) {
    return json({ error: 'No files to deploy' }, { status: 400, headers });
  }

  /*
   * Build a self-contained HTML file from the project files.
   * For static projects: CSS/JS are inlined into index.html → single file.
   * For Vite projects: we serve the index.html as-is (assets won't load
   * without a dev server, but the HTML structure + inline styles still work).
   * Future: run `npm run build` in E2B and deploy the dist/ output.
   */
  const fileMap = buildFileMap(body.files);
  const html = buildStaticPreviewHtml(fileMap);

  if (!html || html.length < 50) {
    return json({ error: 'Failed to build deployable HTML' }, { status: 500, headers });
  }

  // Generate a unique slug (retry on collision)
  let slug = generateSlug();
  let attempts = 0;

  while (attempts < 5) {
    const { data: existing } = await supabase.from('deployments').select('id').eq('url_slug', slug).maybeSingle();

    if (!existing) {
      break;
    }

    slug = generateSlug();
    attempts++;
  }

  // Upload HTML to Supabase Storage
  const storagePath = `${user.id}/${slug}.html`;
  const htmlBlob = new Blob([html], { type: 'text/html' });

  const { error: uploadError } = await supabase.storage.from(DEPLOYMENTS_BUCKET).upload(storagePath, htmlBlob, {
    contentType: 'text/html',
    cacheControl: '3600',
  });

  if (uploadError) {
    console.error('[deploy/internal] storage upload failed:', uploadError.message);
    return json({ error: 'Failed to upload deployment' }, { status: 500, headers });
  }

  // Insert deployment record
  const { error: insertError } = await supabase.from('deployments').insert({
    user_id: user.id,
    url_slug: slug,
    title: body.title || 'Untitled Project',
    framework: body.framework || 'static',
    storage_path: storagePath,
    file_count: Object.keys(body.files).length,
  });

  if (insertError) {
    // Clean up the uploaded file if the insert fails
    await supabase.storage.from(DEPLOYMENTS_BUCKET).remove([storagePath]);
    console.error('[deploy/internal] insert failed:', insertError.message);

    return json({ error: 'Failed to create deployment record' }, { status: 500, headers });
  }

  console.log(
    `[deploy/internal] deployed: /p/${slug} (${body.framework}, ${Object.keys(body.files).length} files, ${html.length} bytes)`,
  );

  return json(
    {
      url: `/p/${slug}`,
      slug,
      title: body.title || 'Untitled Project',
    },
    { headers },
  );
}

// ─── Undeploy ───────────────────────────────────────────────────────────────

async function handleDelete(request: Request, context: ActionFunctionArgs['context']) {
  const { user, supabase, headers } = await getAuthedUser(request, context);

  if (!user || !supabase) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { slug?: string };

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  if (!body.slug) {
    return json({ error: 'slug is required' }, { status: 400, headers });
  }

  // Find the deployment (must belong to the user)
  const { data: deployment, error: findError } = await supabase
    .from('deployments')
    .select('id, storage_path')
    .eq('url_slug', body.slug)
    .eq('user_id', user.id)
    .maybeSingle();

  if (findError || !deployment) {
    return json({ error: 'Deployment not found' }, { status: 404, headers });
  }

  // Delete from storage
  await supabase.storage.from(DEPLOYMENTS_BUCKET).remove([deployment.storage_path]);

  // Delete from table
  const { error: deleteError } = await supabase.from('deployments').delete().eq('id', deployment.id);

  if (deleteError) {
    return json({ error: 'Failed to delete deployment' }, { status: 500, headers });
  }

  return json({ ok: true }, { headers });
}
