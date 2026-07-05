import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useState } from 'react';
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

  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState(false);

  /*
   * The Settings drawer (ControlPanel) renders at z-[100/101], while the
   * Projects drawer sits at z-[999]. If both are open at once the Projects
   * drawer covers Settings — so the user taps "Settings" from the account
   * menu and sees nothing change. Make the two drawers mutually exclusive:
   * opening one closes the other.
   */
  useEffect(() => {
    if (isSettingsTab) {
      setMobileProjectsOpen(false);
      setMobileSettingsOpen(true);
    }
  }, [isSettingsTab]);

  useEffect(() => {
    if (isProjectsTab) {
      setMobileSettingsOpen(false);
      setMobileProjectsOpen(true);
    }
  }, [isProjectsTab]);

  const handleCloseSettings = useCallback(() => {
    setMobileSettingsOpen(false);
    mobileActiveTab.set('chat');
  }, []);

  const handleCloseProjects = useCallback(() => {
    setMobileProjectsOpen(false);
    mobileActiveTab.set('chat');
  }, []);

  /*
   * Touch spec (Design v2): a swipe that STARTS at the left screen edge
   * (20px hot zone) and travels right opens the projects drawer — the same
   * gesture every mobile OS uses for its navigation drawer. Only on phones,
   * and never while the drawer is already open.
   */
  useEffect(() => {
    let startX = -1;
    let startY = -1;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX <= 20 && window.innerWidth < 640 ? t.clientX : -1;
      startY = t.clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startX < 0 || mobileProjectsOpen) {
        return;
      }

      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);

      if (dx > 48 && dy < 40) {
        startX = -1;
        setMobileProjectsOpen(true);
        mobileActiveTab.set('projects');
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [mobileProjectsOpen]);

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
