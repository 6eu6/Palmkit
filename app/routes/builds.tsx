/**
 * /builds — Phase 6 Project History
 *
 * Shows the authenticated user's completed Oracle Worker builds.
 * Each card shows: app type, date, prompt snippet, and an "Open" button
 * that loads the files from R2 into the preview.
 */

import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData, useNavigate } from '@remix-run/react';
import { useState } from 'react';
import { Header } from '~/components/header/Header';
import { getAuthedUser } from '~/lib/auth/supabase.server';
import { setPreviewFiles } from '~/lib/stores/build-status';
import { classNames } from '~/utils/classNames';

export const meta: MetaFunction = () => [{ title: 'My Builds — Palmkit' }];

interface BuildRow {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  validation_result: {
    appType?: string;
    fileCount?: number;
    prompt?: string;
  } | null;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authed = await getAuthedUser(request, context);

  if (!authed?.user) {
    return json({ authed: false, builds: [] as BuildRow[] });
  }

  const { data: builds } = await authed.supabase
    .from('build_jobs')
    .select('id, status, validation_result, created_at, updated_at')
    .eq('user_id', authed.user.id)
    .eq('status', 'ready_for_preview')
    .order('updated_at', { ascending: false })
    .limit(20);

  return json({ authed: true, builds: (builds ?? []) as BuildRow[] });
}

const APP_TYPE_ICON: Record<string, string> = {
  react: 'i-logos:react',
  vue: 'i-logos:vue',
  nextjs: 'i-logos:nextjs-icon',
  python: 'i-logos:python',
  static: 'i-ph:globe',
  flutter: 'i-logos:flutter',
  'react-native': 'i-logos:react',
};

const APP_TYPE_LABEL: Record<string, string> = {
  react: 'React',
  vue: 'Vue 3',
  nextjs: 'Next.js',
  python: 'Python',
  static: 'Static',
  flutter: 'Flutter',
  'react-native': 'React Native',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function BuildCard({ build, onOpen }: { build: BuildRow; onOpen: (id: string) => void }) {
  const vr = build.validation_result ?? {};
  const appType = vr.appType ?? 'static';
  const icon = APP_TYPE_ICON[appType] ?? 'i-ph:code';
  const label = APP_TYPE_LABEL[appType] ?? appType;
  const prompt = vr.prompt ?? '';
  const fileCount = vr.fileCount ?? 0;
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();

    if (!confirm('Delete this build?')) {
      return;
    }

    setDeleting(true);
    await fetch(`/api/account/builds?id=${build.id}`, { method: 'DELETE' });
    window.location.reload();
  }

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-bg-depth-2 p-4 transition hover:border-palmkit-elements-borderColorActive hover:bg-palmkit-elements-bg-depth-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={classNames(icon, 'text-xl')} />
          <span className="text-sm font-semibold text-palmkit-elements-textPrimary">{label}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-palmkit-elements-textTertiary">
          {fileCount > 0 && <span>{fileCount} files</span>}
          <span>{formatDate(build.updated_at)}</span>
        </div>
      </div>

      {prompt && <p className="line-clamp-2 text-xs text-palmkit-elements-textSecondary">{prompt.slice(0, 120)}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => onOpen(build.id)}
          className="flex-1 rounded-lg bg-palmkit-elements-button-primary-background px-3 py-1.5 text-xs font-medium text-palmkit-elements-button-primary-text hover:bg-palmkit-elements-button-primary-backgroundHover transition"
        >
          Open Preview
        </button>
        <a
          href={`/api/export-zip?jobId=${build.id}`}
          download
          className="rounded-lg border border-palmkit-elements-borderColor px-2 py-1.5 text-xs text-palmkit-elements-textTertiary hover:border-palmkit-elements-borderColorActive hover:text-palmkit-elements-textSecondary transition"
          title="Download ZIP"
        >
          <div className="i-ph:download-simple" />
        </a>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-lg border border-palmkit-elements-borderColor px-2 py-1.5 text-xs text-palmkit-elements-textTertiary hover:border-red-400 hover:text-red-400 transition"
        >
          <div className={deleting ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:trash'} />
        </button>
      </div>
    </div>
  );
}

export default function BuildsPage() {
  const { authed, builds } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);

  async function openBuild(jobId: string) {
    setLoading(jobId);

    try {
      const detailRes = await fetch(`/api/account/builds?id=${jobId}`);
      const detail = (await detailRes.json()) as { files?: Array<{ path: string }> };
      const fileList = detail.files ?? [];

      const previewFiles: Record<string, string> = {};

      await Promise.all(
        fileList.map(async (f) => {
          const res = await fetch(`/api/files?jobId=${jobId}&path=${encodeURIComponent(f.path)}`);

          if (res.ok) {
            previewFiles[f.path] = await res.text();
          }
        }),
      );

      setPreviewFiles(previewFiles);

      /*
       * Store in sessionStorage as a bridge — useChatHistory reads this
       * on the next page load. This prevents race conditions where the
       * nanostore isn't updated before the navigation completes.
       */
      try {
        sessionStorage.setItem('palmkit_restore_files', JSON.stringify({ jobId, files: previewFiles }));
      } catch {
        // best-effort
      }

      navigate(`/chat/${jobId}`);
    } catch {
      setLoading(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-palmkit-elements-background text-palmkit-elements-textPrimary">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Builds</h1>
            <p className="mt-1 text-sm text-palmkit-elements-textSecondary">
              Apps built with the Palmkit Oracle Worker
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 rounded-lg bg-palmkit-elements-button-primary-background px-4 py-2 text-sm font-medium text-palmkit-elements-button-primary-text hover:bg-palmkit-elements-button-primary-backgroundHover transition"
          >
            <div className="i-ph:plus" />
            New Build
          </button>
        </div>

        {!authed && (
          <div className="rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-bg-depth-2 p-8 text-center">
            <div className="i-ph:lock text-4xl text-palmkit-elements-textTertiary mx-auto mb-3" />
            <p className="text-palmkit-elements-textSecondary">Sign in to view your build history.</p>
          </div>
        )}

        {authed && builds.length === 0 && (
          <div className="rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-bg-depth-2 p-12 text-center">
            <div className="i-ph:code-block text-5xl text-palmkit-elements-textTertiary mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">No builds yet</h2>
            <p className="text-sm text-palmkit-elements-textSecondary mb-6">
              Describe an app and Palmkit will build it for you.
            </p>
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 rounded-lg bg-palmkit-elements-button-primary-background px-5 py-2.5 text-sm font-medium text-palmkit-elements-button-primary-text hover:bg-palmkit-elements-button-primary-backgroundHover transition"
            >
              <div className="i-ph:wand" />
              Build something
            </button>
          </div>
        )}

        {authed && builds.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {builds.map((build) =>
              loading === build.id ? (
                <div
                  key={build.id}
                  className="flex items-center justify-center rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-bg-depth-2 p-8"
                >
                  <div className="i-svg-spinners:90-ring-with-bg text-2xl text-palmkit-elements-loader-progress" />
                </div>
              ) : (
                <BuildCard key={build.id} build={build} onOpen={openBuild} />
              ),
            )}
          </div>
        )}
      </main>
    </div>
  );
}
