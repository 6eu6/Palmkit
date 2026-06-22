import { useStore } from '@nanostores/react';
import { memo, useEffect, useRef, useState } from 'react';
import { streamingState } from '~/lib/stores/streaming';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  generationStatusStore,
  GENERATION_STEP_LABELS,
  resetGenerationStatus,
  setGenerationStep,
} from '~/lib/stores/generationStatus';
import {
  ensureRemotePreview,
  remotePreviewStatus,
  shouldUseRemotePreview,
  resetForChat,
  resetRemotePreview,
} from '~/lib/sandbox/remotePreview';
import { isMemoryConstrainedDevice } from '~/lib/sandbox/remoteSandbox';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('RPT');

function currentChatId(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const m = window.location.pathname.match(/\/chat\/([^/]+)/);

  return m ? m[1] : undefined;
}

const GEN_STEPS = ['waiting-for-model', 'creating-files', 'updating-workspace', 'starting-preview'] as const;
const SANDBOX_EXPECTED_SECONDS = 75;

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;

  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Unified mobile status bar.
 *
 * One bottom bar owns the whole lifecycle: model generation (steps + "seems
 * stuck") AND the cloud sandbox (install + launch), each with an elapsed counter
 * and a progress bar. It also drives the server-side (E2B) preview on
 * memory-constrained devices. The old top GenerationStatusBar is hidden on
 * mobile (see Chat.client) so this is the single source of status.
 */
export const RemotePreviewTrigger = memo(() => {
  const isStreaming = useStore(streamingState);
  const files = useStore(workbenchStore.files);
  const sandbox = useStore(remotePreviewStatus);
  const gen = useStore(generationStatusStore);
  const prevStreaming = useRef(isStreaming);

  // Per-conversation isolation: tear down the old sandbox when switching chats.
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
      if (isMemoryConstrainedDevice()) {
        logger.warn('no files to preview — WebContainer file writes may have all failed');
      }

      return;
    }

    if (!justFinished && sandbox.state !== 'idle') {
      return;
    }

    void (async () => {
      const useRemote = await shouldUseRemotePreview();
      logger.debug(
        `trigger: justFinished=${justFinished}, sandboxState=${sandbox.state}, hasFiles=${hasFiles}, useRemote=${useRemote}`,
      );

      if (useRemote) {
        await ensureRemotePreview();
      }
    })();
  }, [isStreaming, files, sandbox.state]);

  // Phase detection
  const sandboxPreparing = sandbox.state === 'creating' || sandbox.state === 'installing';
  const genActive = gen.step !== 'idle' && gen.step !== 'done' && gen.step !== 'error';
  const active = sandboxPreparing || genActive;
  const hasError = sandbox.state === 'error' || gen.step === 'error';

  // 1s ticker for the counters while active.
  const [, setNow] = useState(0);
  const sandboxStart = useRef<number | null>(null);

  useEffect(() => {
    if (sandboxPreparing && sandboxStart.current === null) {
      sandboxStart.current = Date.now();
    }

    if (!sandboxPreparing) {
      sandboxStart.current = null;
    }
  }, [sandboxPreparing]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const t = setInterval(() => setNow((n) => n + 1), 1000);

    return () => clearInterval(t);
  }, [active]);

  const bottom = 'calc(var(--palmkit-mobile-dock-height) + env(safe-area-inset-bottom, 0px) + 10px)';

  if (hasError && !active) {
    const isSandboxError = sandbox.state === 'error';

    return (
      <div
        className="fixed left-3 right-3 z-40 sm:hidden flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium"
        style={{
          bottom,
          background: 'var(--palmkit-mobile-surface-bg-elevated)',
          border: '1px solid var(--palmkit-mobile-error)',
          color: 'var(--palmkit-mobile-error)',
          boxShadow: 'var(--palmkit-shadow-md)',
        }}
      >
        <span className="i-ph:warning-circle text-sm shrink-0" />
        <span className="flex-1 truncate">{isSandboxError ? 'Cloud preview failed' : 'Generation failed'}</span>
        {isSandboxError && sandbox.retryable && (
          <button
            onClick={() => {
              resetRemotePreview();
              setTimeout(() => void ensureRemotePreview(), 300);
            }}
            className="text-[11px] px-2.5 py-1 rounded-md shrink-0 font-medium"
            style={{ background: 'var(--palmkit-mobile-error-muted)', color: 'var(--palmkit-mobile-error)' }}
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (!active) {
    return null;
  }

  // Resolve label / counter / progress for the current phase.
  let label: string;
  let elapsedSeconds = 0;
  let progress = 0;

  if (sandboxPreparing) {
    label = sandbox.state === 'creating' ? 'Starting cloud sandbox' : 'Installing & launching preview';
    elapsedSeconds = sandboxStart.current ? Math.floor((Date.now() - sandboxStart.current) / 1000) : 0;
    progress = Math.min(95, Math.round((elapsedSeconds / SANDBOX_EXPECTED_SECONDS) * 100));
  } else {
    label = GENERATION_STEP_LABELS[gen.step] ?? 'Working…';
    elapsedSeconds = gen.startTime ? Math.floor((Date.now() - gen.startTime) / 1000) : 0;

    const idx = GEN_STEPS.indexOf(gen.step as (typeof GEN_STEPS)[number]);
    progress = idx >= 0 ? Math.min(90, Math.round((idx / (GEN_STEPS.length - 1)) * 100)) : 10;
  }

  const currentFile = !sandboxPreparing && gen.currentFile ? gen.currentFile.split('/').pop() : undefined;

  return (
    <div
      className="fixed left-3 right-3 z-40 sm:hidden rounded-xl overflow-hidden"
      style={{
        bottom,
        background: 'var(--palmkit-mobile-surface-bg-elevated)',
        border: '1px solid var(--palmkit-mobile-surface-border-strong)',
        boxShadow: 'var(--palmkit-shadow-md)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span
          className="i-svg-spinners:90-ring-with-bg text-base shrink-0"
          style={{ color: 'var(--palmkit-mobile-accent-text)' }}
        />
        <span className="text-xs font-medium truncate" style={{ color: 'var(--palmkit-mobile-text-primary)' }}>
          {label}
        </span>
        {currentFile && (
          <span
            className="text-[11px] font-mono truncate opacity-70"
            style={{ color: 'var(--palmkit-mobile-text-secondary)' }}
          >
            {currentFile}
          </span>
        )}

        {gen.isStuck && !sandboxPreparing ? (
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <button
              onClick={() => resetGenerationStatus()}
              className="text-[11px] px-2 py-1 rounded-md"
              style={{ background: 'var(--palmkit-mobile-error-muted)', color: 'var(--palmkit-mobile-error)' }}
            >
              Stop
            </button>
            <button
              onClick={() => setGenerationStep('waiting-for-model')}
              className="text-[11px] px-2 py-1 rounded-md"
              style={{ background: 'var(--palmkit-mobile-accent-muted)', color: 'var(--palmkit-mobile-accent-text)' }}
            >
              Retry
            </button>
          </div>
        ) : (
          <span
            className="text-xs font-semibold tabular-nums ml-auto shrink-0"
            style={{ color: 'var(--palmkit-mobile-text-accent)' }}
          >
            {formatElapsed(elapsedSeconds)}
          </span>
        )}
      </div>
      {/* Progress bar */}
      <div className="h-1 w-full" style={{ background: 'var(--palmkit-mobile-accent-faint)' }}>
        <div
          className="h-full rounded-r-full"
          style={{
            width: `${progress}%`,
            background: gen.isStuck
              ? 'var(--palmkit-mobile-warning)'
              : 'linear-gradient(90deg, var(--palmkit-mobile-accent) 0%, #f5f5f5 100%)',
            transition: 'width 1s linear',
          }}
        />
      </div>
    </div>
  );
});

RemotePreviewTrigger.displayName = 'RemotePreviewTrigger';
