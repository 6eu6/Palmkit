import { useStore } from '@nanostores/react';
import { memo, useEffect, useRef } from 'react';
import { streamingState } from '~/lib/stores/streaming';
import { workbenchStore } from '~/lib/stores/workbench';
import { ensureRemotePreview, remotePreviewStatus, shouldUseRemotePreview } from '~/lib/sandbox/remotePreview';

/**
 * Drives the server-side (E2B) preview on memory-constrained devices.
 *
 * When a generation finishes and files exist, and the device is one where the
 * in-browser WebContainer cannot run a real dev server (mobile Safari), this
 * uploads the project to the cloud sandbox and injects the resulting live
 * preview into the workbench. On desktop / when E2B is not configured it does
 * nothing (the in-browser WebContainer is used as before).
 *
 * Renders a small status pill while the cloud preview is starting.
 */
export const RemotePreviewTrigger = memo(() => {
  const isStreaming = useStore(streamingState);
  const files = useStore(workbenchStore.files);
  const status = useStore(remotePreviewStatus);
  const prevStreaming = useRef(isStreaming);

  useEffect(() => {
    const justFinished = prevStreaming.current && !isStreaming;
    prevStreaming.current = isStreaming;

    if (isStreaming) {
      return;
    }

    // Run when a generation just finished, or when files exist and we haven't started.
    const hasFiles = Object.values(files).some((d) => d && d.type === 'file');

    if (!hasFiles) {
      return;
    }

    if (!justFinished && status.state !== 'idle') {
      return;
    }

    void (async () => {
      if (await shouldUseRemotePreview()) {
        await ensureRemotePreview();
      }
    })();
  }, [isStreaming, files, status.state]);

  const bottom = 'calc(var(--bolt-mobile-dock-height) + env(safe-area-inset-bottom, 0px) + 10px)';

  /*
   * When ready, the preview renders inline in the Preview tab (same-origin
   * proxy), so no extra button is needed here.
   */
  if (status.state === 'error') {
    return (
      <div
        className="fixed left-1/2 -translate-x-1/2 z-40 sm:hidden flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium"
        style={{
          bottom,
          background: 'var(--bolt-mobile-surface-bg-elevated)',
          border: '1px solid var(--bolt-mobile-error)',
          color: 'var(--bolt-mobile-error)',
          boxShadow: 'var(--bolt-shadow-md)',
        }}
      >
        <span className="i-ph:warning-circle text-sm" />
        Cloud preview failed
      </div>
    );
  }

  if (status.state !== 'creating' && status.state !== 'installing') {
    return null;
  }

  const label = status.state === 'creating' ? 'Starting cloud sandbox…' : 'Installing & launching preview…';

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40 sm:hidden flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium"
      style={{
        bottom,
        background: 'var(--bolt-mobile-surface-bg-elevated)',
        border: '1px solid var(--bolt-mobile-surface-border-strong)',
        color: 'var(--bolt-mobile-text-accent)',
        boxShadow: 'var(--bolt-shadow-md)',
      }}
    >
      <span className="i-svg-spinners:90-ring-with-bg text-sm" />
      {label}
    </div>
  );
});

RemotePreviewTrigger.displayName = 'RemotePreviewTrigger';
