import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from '@remix-run/react';
import { activeFolderIdStore } from '~/lib/stores/folders';
import { sidebarModeStore } from '~/lib/stores/sidebar';

/**
 * The project the app is currently working inside, owned by the URL.
 *
 * `?project=<id>` rather than component state, so the scope survives a reload,
 * a tab switch and a shared link — and so the desktop sidebar and the mobile
 * drawer cannot disagree about which project is open.
 */
export function useProjectScope() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    activeFolderIdStore.set(searchParams.get('project') ?? undefined);
  }, [searchParams]);

  /**
   * Open a project — or leave the one you are in.
   *
   * This lands on the TAB ROOT, never on the conversation you happened to be
   * reading. Opening a project is meant to give you its own composer: a fresh
   * message box that files whatever you start there into the project, with the
   * project's conversations listed underneath it. Staying put and merely
   * re-filtering the sidebar would make a project a search filter instead of a
   * place you work in.
   */
  const selectFolder = useCallback(
    (folderId: string | undefined) => {
      const mode = sidebarModeStore.get() || 'chat';
      const params = new URLSearchParams(location.search);

      if (folderId) {
        params.set('project', folderId);
      } else {
        params.delete('project');
      }

      const qs = params.toString();
      navigate(`/${mode}${qs ? `?${qs}` : ''}`, { preventScrollReset: true });
    },
    [navigate, location.search],
  );

  return { selectFolder };
}
