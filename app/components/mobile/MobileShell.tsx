import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useState } from 'react';
import { MobileActionDock } from '~/components/ui/workspace/MobileActionDock';
import { ProjectSwitcherDrawer } from '~/components/ui/workspace/ProjectSwitcherDrawer';
import { mobileActiveTab } from '~/lib/stores/mobile';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatStore } from '~/lib/stores/chat';
import { ControlPanel } from '~/components/@settings/core/ControlPanel';

/**
 * DOCK_HEIGHT must match the rendered dock height:
 * pt-1.5 + min-h-[44px] + pb-1.5 = ~48px + border + glow line ≈ 52px
 * We use 56px as a safe value that accounts for padding.
 */
const DOCK_HEIGHT_PX = 56;

export const MobileShell = memo(() => {
  const activeTab = useStore(mobileActiveTab);
  const showWorkbench = useStore(workbenchStore.showWorkbench);

  useEffect(() => {
    if (showWorkbench && activeTab === 'chat') {
      mobileActiveTab.set('preview');
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

  const handleExportZip = useCallback(() => {
    workbenchStore.downloadZip();
  }, []);

  const handleToggleTerminal = useCallback(() => {
    const current = workbenchStore.showTerminal.get();
    workbenchStore.toggleTerminal(!current);
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

  return (
    <>
      <MobileActionDock />

      {/* Bottom spacer: pushes content above the dock */}
      <div
        className="sm:hidden shrink-0"
        style={{
          height: `${DOCK_HEIGHT_PX}px`,
          marginBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      />

      {/* Workbench floating action bar: sits above the dock */}
      {showWorkbench && (
        <div
          className="fixed left-2 right-2 z-40 sm:hidden"
          style={{
            bottom: `calc(${DOCK_HEIGHT_PX}px + env(safe-area-inset-bottom, 0px) + 8px)`,
          }}
        >
          <div
            className="flex items-center gap-2 p-2 rounded-xl shadow-lg border"
            style={{
              background: 'rgba(15, 15, 24, 0.88)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderColor: 'rgba(139, 92, 246, 0.1)',
            }}
          >
            <button
              onClick={handleToggleTerminal}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(168,85,247,0.1))',
                color: '#c084fc',
                border: '1px solid rgba(139,92,246,0.2)',
              }}
            >
              <div className="i-ph:terminal text-sm" />
              Terminal
            </button>
            <button
              onClick={handleExportZip}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.97]"
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: '#a0a0b0',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="i-ph:download-simple text-sm" />
              Export ZIP
            </button>
          </div>
        </div>
      )}

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
