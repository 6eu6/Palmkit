import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect } from 'react';
import { FloatingViewToggle } from '~/components/mobile/FloatingViewToggle';
import { ProjectSwitcherDrawer } from '~/components/ui/workspace/ProjectSwitcherDrawer';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { ControlPanel } from '~/components/@settings/core/ControlPanel';
import { RemotePreviewTrigger } from '~/components/sandbox/RemotePreviewTrigger';

export const MobileShell = memo(() => {
  const activeTab = useStore(mobileActiveTab);
  const showWorkbench = useStore(workbenchStore.showWorkbench);

  useEffect(() => {
    if (showWorkbench && activeTab === 'chat') {
      mobileActiveTab.set('workspace');
    } else if (!showWorkbench && activeTab !== 'chat' && activeTab !== 'settings' && activeTab !== 'projects') {
      mobileActiveTab.set('chat');
      chatStore.setKey('showChat', true);
    }
  }, [showWorkbench, activeTab]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      chatStore.setKey('showChat', true);
      workbenchStore.showWorkbench.set(false);
    }
  }, []);

  /*
   * Touch spec (Design v2): a horizontal swipe on the content area moves
   * between the two dock destinations — swipe LEFT (finger →) goes Chat→App,
   * swipe RIGHT goes App→Chat, matching the dock pill's slide. Skipped when
   * the gesture starts inside the code editor / terminal (they scroll
   * horizontally) or over the preview iframe (it owns its own touches).
   */
  useEffect(() => {
    let sx = -1;
    let sy = -1;
    let blocked = false;

    const onStart = (e: TouchEvent) => {
      if (window.innerWidth >= 640 || e.touches.length !== 1) {
        sx = -1;
        return;
      }

      const target = e.target as HTMLElement | null;
      blocked = !!target?.closest('.cm-editor, .xterm, iframe, [data-no-swipe], input, textarea, select');

      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
    };

    const onEnd = (e: TouchEvent) => {
      if (sx < 0 || blocked) {
        return;
      }

      const t = e.changedTouches[0];
      const startX = sx;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - sy);
      sx = -1;

      /*
       * A confident horizontal swipe — not a vertical scroll, and not the
       * left-edge pull that opens the projects drawer (handled separately).
       */
      if (Math.abs(dx) < 70 || dy > 50 || startX < 28) {
        return;
      }

      const onWorkspace = workbenchStore.showWorkbench.get();

      if (dx < 0 && !onWorkspace) {
        // Chat → App (only once files exist, so we never land on an empty screen)
        const hasFiles = Object.values(workbenchStore.files.get() ?? {}).some((d) => d?.type === 'file');

        if (hasFiles) {
          chatStore.setKey('showChat', false);
          workbenchStore.showWorkbench.set(true);
          mobileActiveTab.set('workspace');
        }
      } else if (dx > 0 && onWorkspace) {
        // App → Chat
        chatStore.setKey('showChat', true);
        workbenchStore.showWorkbench.set(false);
        mobileActiveTab.set('chat');
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        chatStore.setKey('showChat', true);
        mobileActiveTab.set('chat');
      }
    };
    mq.addEventListener('change', handler);

    return () => mq.removeEventListener('change', handler);
  }, []);

  const isSettingsTab = activeTab === 'settings';
  const isProjectsTab = activeTab === 'projects';

  /*
   * Which surface is showing is DERIVED from `mobileActiveTab`, never latched
   * into local state beside it.
   *
   * It used to be mirrored into two useState flags that an effect only ever
   * turned ON: `if (isProjectsTab) setMobileProjectsOpen(true)`. Nothing turned
   * them back off except each drawer's own close button — so closing the
   * projects drawer by DRAGGING it shut, or by tapping the strip of
   * conversation still showing, set the tab back to 'chat' and left the flag
   * stuck at true. The next tap on the menu icon set the tab to 'projects'
   * again, the effect set the flag to true again — the value it already had —
   * and React skipped the re-render. The drawer's `open` prop never changed,
   * so the effect that animates it never ran, and the drawer simply refused to
   * open until a reload cleared the flag. That is the intermittent "sometimes
   * it won't open" — it happened precisely after a close that wasn't the X
   * button.
   *
   * Deriving both flags makes that state unrepresentable. It also makes the
   * two drawers mutually exclusive for free: `mobileActiveTab` holds one value,
   * so both can never be open at once — which is what the pair of effects was
   * trying to arrange by hand.
   */
  const mobileSettingsOpen = isSettingsTab;
  const mobileProjectsOpen = isProjectsTab;

  const handleCloseSettings = useCallback(() => {
    mobileActiveTab.set('chat');
  }, []);

  const handleCloseProjects = useCallback(() => {
    mobileActiveTab.set('chat');
  }, []);

  /*
   * The left-edge pull that opens the projects drawer lives in AppShell now.
   * It has to: opening is a DRAG that moves the drawer and the conversation
   * together under the finger, and the surface being pushed is AppShell's.
   * The threshold-based version that used to live here only flipped a boolean
   * once the finger had travelled far enough, so both were animating at once
   * and the panel ran ahead of the touch.
   */

  return (
    <>
      <RemotePreviewTrigger />

      {/* v3: the fixed bottom Chat/App dock is replaced by a draggable floating
          toggle — it frees the whole bottom strip so chat + preview get the
          full screen on mobile. No spacer needed anymore. */}
      <FloatingViewToggle />

      {/* Note: the previous floating Terminal/Export action bar was removed —
          it duplicated the dock's Terminal tab and the workbench toolbar's
          Export button, and (being position:fixed with no vertical anchor)
          rendered over the workbench header. Both actions remain available in
          their canonical locations. */}

      <div className="sm:hidden">
        <ControlPanel open={mobileSettingsOpen} onClose={handleCloseSettings} />
      </div>

      <div className="sm:hidden">
        <ProjectSwitcherDrawer open={mobileProjectsOpen} onClose={handleCloseProjects} />
      </div>
    </>
  );
});

MobileShell.displayName = 'MobileShell';
