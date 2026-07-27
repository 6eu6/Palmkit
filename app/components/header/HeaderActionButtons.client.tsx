import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { DeployButton } from '~/components/deploy/DeployButton';
import { buildStatusStore, currentJobIdStore } from '~/lib/stores/build-status';

interface HeaderActionButtonsProps {
  chatStarted: boolean;
}

export function HeaderActionButtons({ chatStarted: _chatStarted }: HeaderActionButtonsProps) {
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const buildStatus = useStore(buildStatusStore);
  const currentJobId = useStore(currentJobIdStore);
  const activePreview = previews[activePreviewIndex];

  const shouldShowButtons = activePreview;
  const showExportZip = buildStatus.jobStatus === 'ready_for_preview' && currentJobId !== null;

  return (
    <div className="flex items-center gap-1">
      {/* Phase 8: Export ZIP — shown when Oracle Worker build is ready */}
      {showExportZip && (
        <a
          href={`/api/export-zip?jobId=${currentJobId}`}
          download
          className="flex items-center gap-1.5 rounded-lg border border-palmkit-elements-borderColor px-3 py-1.5 text-xs font-medium text-palmkit-elements-textSecondary hover:border-palmkit-elements-borderColorActive hover:text-palmkit-elements-textPrimary transition-colors"
          title="Download project as ZIP"
        >
          <div className="i-ph:download-simple text-base" />
          <span className="hidden sm:inline">Export ZIP</span>
        </a>
      )}

      {/* Deploy Button */}
      {shouldShowButtons && <DeployButton />}

      {/* Debug Tools */}
      {shouldShowButtons && (
        <div className="flex border border-palmkit-elements-borderColor rounded-md overflow-hidden text-sm">
          <button
            onClick={() => window.open('https://github.com/6eu6/Palmkit/issues/new?template=bug_report.yml', '_blank')}
            className="rounded-l-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-gray-800 dark:bg-gray-300 text-white hover:text-palmkit-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-palmkit-elements-button-primary-backgroundHover outline-gray-800 dark:outline-gray-300 flex gap-1.5"
            title="Report Bug"
          >
            <div className="i-ph:bug" />
            <span>Report Bug</span>
          </button>
          <div className="w-px bg-palmkit-elements-borderColor" />
          <button
            onClick={async () => {
              try {
                const { downloadDebugLog } = await import('~/utils/debugLogger');
                await downloadDebugLog();
              } catch (error) {
                console.error('Failed to download debug log:', error);
              }
            }}
            className="rounded-r-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-gray-800 dark:bg-gray-300 text-white hover:text-palmkit-elements-item-contentAccent [&:not(:disabled,.disabled)]:hover:bg-palmkit-elements-button-primary-backgroundHover outline-gray-800 dark:outline-gray-300 flex gap-1.5"
            title="Download Debug Log"
          >
            <div className="i-ph:download" />
            <span>Debug Log</span>
          </button>
        </div>
      )}
    </div>
  );
}
