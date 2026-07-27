import { useState, useCallback } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatId } from '~/lib/persistence';
import { toast } from 'react-toastify';
import { WORK_DIR } from '~/utils/constants';

/**
 * usePalmkitDeploy — client-side hook to deploy the current project to
 * Palmkit's internal hosting.
 *
 * Flow:
 *   1. Collect files from workbenchStore
 *   2. POST /api/deploy/internal with the files
 *   3. Server builds self-contained HTML + stores in Supabase Storage
 *   4. Returns { url: '/p/{slug}' }
 *   5. Show toast + open the deployed URL in a new tab
 *
 * The deployed app is publicly accessible at /p/{slug} (no auth needed).
 */

export function usePalmkitDeploy() {
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);

  const handlePalmkitDeploy = useCallback(async () => {
    setIsDeploying(true);

    try {
      // Collect files from the workbench store
      const fileMap = workbenchStore.files.get();
      const files: Record<string, { content: string }> = {};

      for (const [path, dirent] of Object.entries(fileMap)) {
        if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
          continue;
        }

        // Strip the workdir prefix to get relative paths
        const relPath = path.startsWith(WORK_DIR + '/') ? path.slice(WORK_DIR.length + 1) : path;
        files[relPath] = { content: dirent.content };
      }

      if (Object.keys(files).length === 0) {
        toast.error('No files to deploy');
        return null;
      }

      // Get the chat title for the deployment name
      const id = chatId.get();
      const title = `Palmkit Project ${id ? id.slice(-6) : ''}`;

      const res = await fetch('/api/deploy/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files, title }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Deploy failed (${res.status})`);
      }

      const data = (await res.json()) as { url: string; slug: string };
      const fullUrl = `${window.location.origin}${data.url}`;

      setDeployedUrl(fullUrl);
      toast.success('Deployed to Palmkit!', {
        position: 'bottom-right',
        autoClose: 5000,
        onClick: () => window.open(fullUrl, '_blank'),
      });

      // Open the deployed app in a new tab
      window.open(fullUrl, '_blank');

      return { url: fullUrl, slug: data.slug };
    } catch (error) {
      console.error('[PalmkitDeploy] failed:', error);
      toast.error(error instanceof Error ? error.message : 'Deploy failed');

      return null;
    } finally {
      setIsDeploying(false);
    }
  }, []);

  return { handlePalmkitDeploy, isDeploying, deployedUrl };
}
