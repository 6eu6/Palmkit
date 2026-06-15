import { useStore } from '@nanostores/react';
import { memo, useEffect, useRef, useState } from 'react';
import { streamingState } from '~/lib/stores/streaming';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  ensureRemotePreview,
  remotePreviewStatus,
  shouldUseRemotePreview,
  resetForChat,
} from '~/lib/sandbox/remotePreview';

function currentChatId(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const m = window.location.pathname.match(/\/chat\/([^/]+)/);

  return m ? m[1] : undefined;
}

// Rough expected time (s) to install + boot the dev server; drives the bar fill.
const EXPECTED_SECONDS = 75;

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;

  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Drives the server-side (E2B) preview on memory-constrained devices and shows a
 * polished bottom status bar (with an elapsed counter + progress bar) while the
 * cloud sandbox installs and launches the preview.
 */
export const RemotePreviewTrigger = memo(() => {
  const isStreaming = useStore(streamingState);
  const files = useStore(workbenchStore.files);
  const status = useStore(remotePreviewStatus);
  const prevStreaming = useRef(isStreaming);

  /*
   * Per-conversation isolation: tear down the old sandbox when switching to a
   * DIFFERENT existing chat (fresh-page -> /chat/:id is the same session).
   */
  const lastChatId = useRef<string | undefined>(currentChatId());
  useEffect(() => {
    const interval = setInterval(() => {
      const id = currentChatId();

      if (id !== lastChatId.current) {
        if (lastChatId.current && id !== lastChatId.current) {
          resetForChat();
        }

        lastChatId.current = id;
      }
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const justFinished = prevStreaming.current && !isStreaming;
    prevStreaming.current = isStreaming;

    if (isStreaming) {
      return;
    }

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

  // Elapsed-time counter while the sandbox is preparing.
  const isPreparing = status.state === 'creating' || status.state === 'installing';
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPreparing) {
      startRef.current = null;
      setElapsed(0);

      return undefined;
    }

    if (startRef.current === null) {
      startRef.current = Date.now();
    }

    const tick = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [isPreparing]);

  const bottom = 'calc(var(--bolt-mobile-dock-height) + env(safe-area-inset-bottom, 0px) + 10px)';

  // Inline preview renders in the Preview tab when ready — surface only progress/errors here.
  if (status.state === 'error') {
    return (
      <div
        className="fixed left-3 right-3 z-40 sm:hidden flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium"
        style={{
          bottom,
          background: 'var(--bolt-mobile-surface-bg-elevated)',
          border: '1px solid var(--bolt-mobile-error)',
          color: 'var(--bolt-mobile-error)',
          boxShadow: 'var(--bolt-shadow-md)',
        }}
      >
        <span className="i-ph:warning-circle text-sm shrink-0" />
        Cloud preview failed — try again
      </div>
    );
  }

  if (!isPreparing) {
    return null;
  }

  const label = status.state === 'creating' ? 'Starting cloud sandbox' : 'Installing & launching preview';
  const progress = Math.min(95, Math.round((elapsed / EXPECTED_SECONDS) * 100));

  return (
    <div
      className="fixed left-3 right-3 z-40 sm:hidden rounded-xl overflow-hidden"
      style={{
        bottom,
        background: 'var(--bolt-mobile-surface-bg-elevated)',
        border: '1px solid var(--bolt-mobile-surface-border-strong)',
        boxShadow: 'var(--bolt-shadow-md)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span
          className="i-svg-spinners:90-ring-with-bg text-base shrink-0"
          style={{ color: 'var(--bolt-mobile-accent-text)' }}
        />
        <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--bolt-mobile-text-primary)' }}>
          {label}
        </span>
        <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--bolt-mobile-text-accent)' }}>
          {formatElapsed(elapsed)}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1 w-full" style={{ background: 'var(--bolt-mobile-accent-faint)' }}>
        <div
          className="h-full rounded-r-full"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, var(--bolt-mobile-accent) 0%, #c084fc 100%)',
            transition: 'width 1s linear',
          }}
        />
      </div>
    </div>
  );
});

RemotePreviewTrigger.displayName = 'RemotePreviewTrigger';
