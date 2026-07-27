/**
 * /api/export-zip?jobId=<id> — Phase 8 ZIP Export
 *
 * Downloads all files for a completed build as a ZIP archive.
 * Uses fflate (already a project dependency) for in-memory ZIP creation.
 *
 * Auth: authenticated user must own the job (RLS enforced).
 */

import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { zipSync, type Zippable } from 'fflate';

const BUCKET = 'palmkit-files';

const README_TEMPLATES: Record<string, string> = {
  react: `# Palmkit Generated React App

## Run locally

\`\`\`bash
npm install
npm run dev
\`\`\`

Built with: React 18 + Vite + Tailwind CSS
`,
  nextjs: `# Palmkit Generated Next.js App

## Run locally

\`\`\`bash
npm install
npm run dev
\`\`\`

Built with: Next.js 14 App Router + Tailwind CSS
`,
  vue: `# Palmkit Generated Vue App

## Run locally

\`\`\`bash
npm install
npm run dev
\`\`\`

Built with: Vue 3 + Vite + Tailwind CSS
`,
  python: `# Palmkit Generated Python App

## Run locally

\`\`\`bash
pip install -r requirements.txt
python app.py
\`\`\`

Visit http://localhost:5000
`,
  flutter: `# Palmkit Generated Flutter App

## Run locally

\`\`\`bash
flutter pub get
flutter run
\`\`\`

Or preview in browser:
\`\`\`bash
flutter run -d chrome
\`\`\`
`,
  'react-native': `# Palmkit Generated React Native App

## Run locally with Expo

\`\`\`bash
npm install
npx expo start
\`\`\`

Scan the QR code with Expo Go on your device.
`,
  static: `# Palmkit Generated Web App

Open index.html in your browser, or serve with:

\`\`\`bash
npx serve .
\`\`\`
`,
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    return json({ error: 'jobId is required' }, { status: 400 });
  }

  /* Verify job ownership and get metadata */
  const { data: job, error: jobError } = await authed.supabase
    .from('build_jobs')
    .select('id, validation_result')
    .eq('id', jobId)
    .eq('user_id', authed.user.id)
    .single();

  if (jobError || !job) {
    return json({ error: 'Build not found' }, { status: 404 });
  }

  /* Fetch file manifest */
  const { data: manifest, error: manifestError } = await authed.supabase
    .from('project_files_manifest')
    .select('path, storage_key, mime_type')
    .eq('job_id', jobId)
    .order('path');

  if (manifestError || !manifest || manifest.length === 0) {
    return json({ error: 'No files found for this build' }, { status: 404 });
  }

  /* Download all files from Supabase Storage */
  const zipEntries: Zippable = {};

  for (const entry of manifest) {
    const storageKey = `${authed.user.id}/${entry.storage_key}`;
    const { data: fileData, error: downloadError } = await authed.supabase.storage.from(BUCKET).download(storageKey);

    if (downloadError || !fileData) {
      continue;
    }

    const content = await fileData.text();
    zipEntries[entry.path] = new TextEncoder().encode(content);
  }

  /* Add README if not present */
  const appType = (job.validation_result?.appType as string) ?? 'static';

  if (!zipEntries['README.md'] && README_TEMPLATES[appType]) {
    zipEntries['README.md'] = new TextEncoder().encode(README_TEMPLATES[appType]);
  }

  if (Object.keys(zipEntries).length === 0) {
    return json({ error: 'Failed to download build files' }, { status: 500 });
  }

  /* Create ZIP in memory */
  const zipBytes = zipSync(zipEntries, { level: 6 });
  const prompt = (job.validation_result?.prompt as string | undefined) ?? 'project';
  const safeName = prompt
    .slice(0, 30)
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const filename = `palmkit-${safeName || 'project'}.zip`;

  return new Response(zipBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zipBytes.length),
      'Cache-Control': 'no-store',
    },
  });
}
