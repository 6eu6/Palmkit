import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useState } from 'react';
import { MobileActionDock } from '~/components/ui/workspace/MobileActionDock';
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

  useEffect(() => {
    if (isSettingsTab) {
      setMobileSettingsOpen(true);
    }
  }, [isSettingsTab]);

  useEffect(() => {
    if (isProjectsTab) {
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
      <MobileActionDock />

      {/* Bottom spacer: pushes content above the dock */}
      <div className="sm:hidden shrink-0" style={{ height: 'var(--palmkit-mobile-dock-height)' }} />

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
