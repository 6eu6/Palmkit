import { json } from '@remix-run/cloudflare';

/**
 * Git info endpoint — returns branch, commit, dirty status.
 *
 * Uses dynamic imports for `fs` and `child_process` so the SSR bundle
 * doesn't crash on Cloudflare Workers (where these Node.js builtins are
 * either unavailable or stubbed). On Workers the route returns a safe
 * fallback; it's primarily useful in local development.
 */
export async function loader() {
  try {
    const [fsMod, cpMod] = await Promise.all([import('fs'), import('child_process')]);
    const { existsSync } = fsMod;
    const { execSync } = cpMod;

    // Check if we're in a git repository
    if (!existsSync('.git')) {
      return json({
        branch: 'unknown',
        commit: 'unknown',
        isDirty: false,
      });
    }

    // Get current branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();

    // Get current commit hash
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

    // Check if working directory is dirty
    const statusOutput = execSync('git status --porcelain', { encoding: 'utf8' });
    const isDirty = statusOutput.trim().length > 0;

    // Get remote URL
    let remoteUrl: string | undefined;

    try {
      remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    } catch {
      // No remote origin, leave as undefined
    }

    // Get last commit info
    let lastCommit: { message: string; date: string; author: string } | undefined;

    try {
      const commitInfo = execSync('git log -1 --pretty=format:"%s|%ci|%an"', { encoding: 'utf8' }).trim();
      const [message, date, author] = commitInfo.split('|');
      lastCommit = {
        message: message || 'unknown',
        date: date || 'unknown',
        author: author || 'unknown',
      };
    } catch {
      // Could not get commit info
    }

    return json({
      branch,
      commit,
      isDirty,
      remoteUrl,
      lastCommit,
    });
  } catch (error) {
    // On Cloudflare Workers (no fs/child_process), return fallback
    console.error('[api/git-info] unavailable in this environment:', error);

    return json({
      branch: 'unknown',
      commit: 'unknown',
      isDirty: false,
    });
  }
}
