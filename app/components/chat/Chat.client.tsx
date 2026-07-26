import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, useShortcuts, finalizeMessageParser } from '~/lib/hooks';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { description as descriptionAtom, useChatHistory, chatMetadata, chatId } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  setBuildStatus,
  resetBuildStatus,
  setWorkerEvents,
  clearWorkerEvents,
  setCurrentJobId,
  setWorkerProgress,
  resetWorkerProgress,
  activeBuildJobIdStore,
} from '~/lib/stores/build-status';
import type { BuildCompleteness, BuildJobStatus } from '~/lib/stores/build-status';
import { useExternalWorker, useExternalWorkerFlag } from '~/lib/hooks/use-external-worker';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import { PENDING_PROMPT_KEY } from '~/components/landing/LandingPromptBox';
import Cookies from 'js-cookie';
import { useMemory } from '~/lib/hooks/useMemory';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams, useLocation } from '@remix-run/react';
import { setSidebarMode } from '~/lib/stores/sidebar';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { isMemoryConstrainedDevice } from '~/lib/sandbox/remoteSandbox';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';
import type { FileMap } from '~/lib/stores/files';
import { RestoreOverlay } from '~/components/ui/RestoreOverlay';
import { GenerationStatusBar } from '~/components/ui/GenerationStatusBar';
import { ProjectList } from '~/components/ui/ProjectList';
import { setGenerationStep, resetGenerationStatus, generationStatusStore } from '~/lib/stores/generationStatus';
import { pendingEditPromptStore } from '~/lib/stores/inspector';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const location = useLocation();

  const {
    ready,
    routeId,
    initialMessages,
    storeMessageHistory,
    importChat,
    exportChat,
    takeDebouncedSnapshot,
    takeSnapshot,
  } = useChatHistory();
  const title = useStore(descriptionAtom);
  const [projectListOpen, setProjectListOpen] = useState(false);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  // Track URL changes for mode switching

  /*
   * Keying <ChatImpl> by the route id remounts the whole chat tree when the
   * user switches conversations (/chat/A -> /chat/B) or starts a new one
   * (/chat/A -> /). useChat() only reads `initialMessages` on mount, so
   * without this key the previous chat's messages would stay on screen until
   * a manual page refresh. Brand-new chats are created via history.replaceState
   * (no loader re-run), so routeId stays undefined during creation and the
   * in-flight stream is preserved.
   */
  return (
    <>
      <RestoreOverlay />
      {ready && (
        <ChatImpl
          key={routeId ?? location.pathname}
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
          takeDebouncedSnapshot={takeDebouncedSnapshot}
          takeSnapshot={takeSnapshot}
          onOpenProjectList={() => setProjectListOpen(true)}
        />
      )}
      <ProjectList open={projectListOpen} onClose={() => setProjectListOpen(false)} />
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

/**
 * Build the assistant message content from Oracle-worker events.
 *
 * RADICAL STREAM REBUILD: This function returns ONLY the brain's own final
 * summary text (when the build is done) or an error message (when it failed).
 * During the build it returns an EMPTY string — no "🔨 Building your project…"
 * banner, no file-count stub, no reasoning-step count. The BuildStream panel
 * is the single voice during the build; this text only fills in once the
 * brain has called `done()` and produced its structured summary.
 *
 * The empty-string-during-build approach works because `isBuildBannerContent`
 * in Messages.client.tsx detects build turns by a leading ⚡/🔨/✅/❌ marker
 * on the placeholder, then renders `<LiveBuildPlaceholder />` (a minimal
 * "Working…" line) until the global BuildStream has events to show. So the
 * user sees: Working… → [BuildStream timeline] → [brain's summary]. Never a
 * hardcoded "Building your project…" banner.
 */
function buildWorkerStreamContent(state: import('~/lib/hooks/use-external-worker').ExternalWorkerState): string {
  if (state.status === 'failed_clean') {
    return `❌ **Build failed**\n\n${state.error ?? 'Unknown error'}`;
  }

  const isDone = state.status === 'ready_for_preview';

  if (isDone) {
    /*
     * Use the Builder's model-generated summary as the assistant's final
     * response. This gives the user a real explanation of what was built,
     * the files created, key features, and tech stack — not a generic stub.
     */
    const summaryEvent = [...state.events].reverse().find((e) => (e.payload as any)?.isBuildSummary === true);

    if (summaryEvent) {
      const summaryText = (summaryEvent.payload as any)?.text ?? '';

      if (summaryText.trim().length > 30) {
        return summaryText;
      }
    }

    // Minimal fallback ONLY when the brain produced no summary at all.
    const fileCount = state.files.length;

    return `✅ **Build complete** — ${fileCount} file${fileCount !== 1 ? 's' : ''} generated.`;
  }

  /*
   * During build — return the ⚡ marker only (no descriptive text). This
   * keeps the `isWorkerMessage` check (last.content.startsWith('⚡'))
   * passing on every poll so the message keeps updating, while rendering
   * no visible banner text. The `<LiveBuildPlaceholder />` in Messages.tsx
   * detects the ⚡ prefix and shows a minimal "Working…" line that hides
   * itself the moment the global BuildStream has events. The brain's own
   * reasoning is the first real content the user sees.
   */
  return '⚡';
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
  takeDebouncedSnapshot: (chatIdx: string, files: FileMap, chatSummary?: string) => Promise<void>;
  takeSnapshot: (chatIdx: string, files: FileMap, _urlId?: string, chatSummary?: string) => Promise<void>;
  onOpenProjectList: () => void;
}

export const ChatImpl = memo(
  ({
    description,
    initialMessages,
    storeMessageHistory,
    importChat,
    exportChat,
    takeDebouncedSnapshot,
    takeSnapshot,
    onOpenProjectList,
  }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    /*
     * Tracks the jobId the user aborted (Stop button). The restore effect
     * skips re-attaching to this job so the UI stays idle after abort — but
     * palmkitJobId stays in chat metadata so the NEXT message resolves to an
     * edit on this job's workspace (preserving context).
     */
    const abortedJobIdRef = useRef<string | null>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);

    /*
     * BUG FIX (2026-06-30): When navigating from home (/) to /chat/<id>, the
     * Chat component reuses the same instance (both _index and chat.$id routes
     * render <Chat/>). The component mounts with initialMessages=[] (chatStarted=false),
     * then useChatHistory's async effect loads messages and calls setInitialMessages.
     * But chatStarted was NEVER updated — it only got set to true when the user
     * sent a NEW message. So the home page kept showing instead of the chat.
     *
     * Now: sync chatStarted with initialMessages.length whenever it changes.
     */
    useEffect(() => {
      if (initialMessages.length > 0) {
        setChatStarted(true);
      }
    }, [initialMessages]);

    // Track URL changes for mode switching
    const locationKey = typeof window !== 'undefined' ? window.location.pathname : '';

    /*
     * Route-based mode detection: sync sidebar mode + chat mode with the URL.
     * Runs on mount AND when the URL changes (navigation between /chat /work /code).
     * /chat → sidebarMode='chat', chatMode='discuss'
     * /work → sidebarMode='work', chatMode='discuss'
     * /code → sidebarMode='code', chatMode='build'
     * /     → sidebarMode='code', chatMode='build' (default)
     */
    useEffect(() => {
      const path = window.location.pathname;

      if (path.startsWith('/chat')) {
        setSidebarMode('chat');
        setChatMode('discuss');
      } else if (path.startsWith('/work')) {
        setSidebarMode('work');
        setChatMode('discuss');
      } else if (path.startsWith('/code')) {
        setSidebarMode('code');
        setChatMode('build');
      } else {
        setSidebarMode('code');
        setChatMode('build');
      }
    }, [locationKey]); // Re-run when URL changes

    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });
    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();

    /*
     * B) Provider/settings restore: Load API keys synchronously from cookies
     * to avoid "No providers enabled" flash after refresh.
     */
    const [apiKeys] = useState<Record<string, string>>(() => {
      try {
        const storedApiKeys = Cookies.get('apiKeys');

        if (storedApiKeys) {
          return JSON.parse(storedApiKeys);
        }
      } catch {
        // ignore parse errors
      }

      return {};
    });

    // Determine chat mode from URL — /chat and /work = discuss, /code and / = build
    const location = useLocation();
    const path = location.pathname;

    const effectiveChatMode: 'discuss' | 'build' =
      path.startsWith('/chat') || path.startsWith('/work') ? 'discuss' : 'build';

    const effectiveSidebarMode: 'chat' | 'work' | 'code' = path.startsWith('/chat')
      ? 'chat'
      : path.startsWith('/work')
        ? 'work'
        : 'code';

    // Sync sidebarModeStore with URL on every render (ensures UI matches route)
    useEffect(() => {
      setSidebarMode(effectiveSidebarMode);
    }, [effectiveSidebarMode]);

    const [chatMode, setChatMode] = useState<'discuss' | 'build'>(effectiveChatMode);
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const pendingEditPrompt = useStore(pendingEditPromptStore);
    const mcpSettings = useMCPStore((state) => state.settings);

    // 3-tier memory system: fetch before send, extract after finish
    const { fetchMemoryBlock, triggerExtraction } = useMemory();
    const memoryBlockRef = useRef<string>('');

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        chatMode: effectiveChatMode,
        sidebarMode: effectiveSidebarMode,
        designScheme,
        memoryBlock: memoryBlockRef.current,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
        maxLLMSteps: mcpSettings.maxLLMSteps,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        setFakeLoading(false);
        setGenerationStep('error');
        handleError(e, 'chat');
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);
        setGenerationStep('done');

        // Finalize any open parser actions (files that were mid-stream)
        finalizeMessageParser();

        /*
         * Trigger async memory extraction (Layer 1 + Layer 3)
         * Runs every 3 messages — fire and forget, no UI blocking
         */
        const mode = chatMode === 'discuss' ? 'chat' : 'code';
        triggerExtraction(
          messages.map((m: Message) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
          mode,
        );

        // Auto-reset after 3 seconds
        setTimeout(() => {
          resetGenerationStatus();
        }, 3000);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });
    useEffect(() => {
      if (pendingEditPrompt) {
        setInput(pendingEditPrompt);
        pendingEditPromptStore.set(null);
      }
    }, [pendingEditPrompt]);

    useEffect(() => {
      /*
       * Pick up a prompt stashed by the landing page (lovable-style flow) — a
       * logged-out visitor types their idea into LandingPromptBox, we store it
       * in sessionStorage, send them through login, and resume here. Falls back
       * to a ?prompt= URL param for the no-sessionStorage case.
       */
      let prompt = '';

      try {
        const stored = sessionStorage.getItem(PENDING_PROMPT_KEY);

        if (stored) {
          prompt = stored;
          sessionStorage.removeItem(PENDING_PROMPT_KEY);
        }
      } catch {
        /* sessionStorage unavailable (private mode, etc.) — fall back to URL. */
      }

      if (!prompt) {
        prompt = searchParams.get('prompt') ?? '';
      }

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    /*
     * D) Generation status: Track streaming state and update generation step.
     * When streaming starts, show 'waiting-for-model'. When files appear, show 'creating-files'.
     * Keep updating lastActivityTime while files are still being created so the
     * "stuck" detection (30 s inactivity) doesn't fire prematurely during slow
     * model output.
     */
    useEffect(() => {
      if (isLoading || fakeLoading) {
        const currentStep = generationStatusStore.get().step;

        if (currentStep === 'idle') {
          setGenerationStep('waiting-for-model');
        }

        const fileCount = Object.keys(files).length;

        if (fileCount > 0 && (currentStep === 'waiting-for-model' || currentStep === 'creating-files')) {
          setGenerationStep('creating-files');
        }
      }
    }, [isLoading, fakeLoading, files]);

    // Phase 2: External Worker feature flag + hook.
    const externalWorkerEnabled = useExternalWorkerFlag();
    const {
      state: extWorkerState,
      startJob: startExtJob,
      restoreJob: restoreExtJob,
      reset: resetExtWorker,
      cancelJob: cancelExtJob,
    } = useExternalWorker();

    // Subscribe to chat metadata so the restore effect re-runs when it loads on refresh.
    const activeChatMeta = useStore(chatMetadata);

    /*
     * RESTORE JOB ON PAGE LOAD / REFRESH
     *
     * When the user opens an existing chat (via refresh, My Builds, or URL),
     * the chat metadata contains `palmkitJobId` — the ID of the build job.
     * Without restoring it, the polling never starts and all progress panels
     * (Thought Process, Todos, Activity Stream) stay empty.
     *
     * This matches Super Z's architecture: when I re-enter a conversation,
     * my workspace is already there with all files and history. Palmkit
     * should do the same — restore the full job state on chat open so the
     * user sees the same UI they had before refresh.
     */
    useEffect(() => {
      if (!externalWorkerEnabled) {
        return;
      }

      /*
       * Read palmkitJobId from chat metadata (persisted in IndexedDB). We depend
       * on `activeChatMeta` (a useStore subscription) — NOT a one-shot .get() —
       * because on a page refresh useChatHistory loads the metadata ASYNC, often
       * AFTER this effect first runs. Without the subscription the effect never
       * re-ran once the metadata arrived, so the job was never restored and the
       * BuildStream stayed blank.
       */
      if (
        activeChatMeta?.palmkitJobId &&
        extWorkerState.status === 'idle' &&
        !extWorkerState.jobId &&
        activeChatMeta.palmkitJobId !== abortedJobIdRef.current
      ) {
        /*
         * Restore the job — this starts polling which processes ALL events
         * through dispatchJobEvent, repopulating workerEventsStore so the live
         * BuildStream comes back exactly where it was.
         *
         * Skips the job the user just aborted (abortedJobIdRef) — without
         * this, the restore effect would immediately re-attach to the
         * aborted job and re-poll it, undoing the Stop. palmkitJobId stays
         * in metadata so the next message still resolves to an edit.
         */
        restoreExtJob(activeChatMeta.palmkitJobId);
      }
    }, [externalWorkerEnabled, activeChatMeta, extWorkerState.status, extWorkerState.jobId, restoreExtJob]);

    // Sync external worker status → build-status store (for Preview gate).
    useEffect(() => {
      if (!externalWorkerEnabled || extWorkerState.status === 'idle') {
        return;
      }

      const statusMap: Record<string, BuildJobStatus> = {
        pending: 'generating',
        generating: 'generating',
        validating: 'incomplete_retrying',
        uploading_snapshot: 'incomplete_retrying',
        ready_for_preview: 'ready_for_preview',
        failed_clean: 'failed_clean',
      };

      setBuildStatus({
        completeness: extWorkerState.status === 'ready_for_preview' ? 'complete' : 'incomplete',
        jobStatus: statusMap[extWorkerState.status] ?? 'generating',
        hasCompletionMarker: extWorkerState.status === 'ready_for_preview',
        artifactTagsBalanced: extWorkerState.status === 'ready_for_preview',
        fileActionsBalanced: extWorkerState.status === 'ready_for_preview',
        fileCount: extWorkerState.files.length,
        appType: extWorkerState.appType,
        issues: extWorkerState.error
          ? [{ code: 'WORKER_ERROR', message: extWorkerState.error, severity: 'error' }]
          : [],
        retryCount: 0,

        /*
         * Prebuilt preview info from Oracle worker's local build.
         * When hasPrebuiltPreview is true, the preview is served from Oracle's
         * nginx directly (bypasses E2B sandbox OOM for large projects).
         */
        _jobValidationResult:
          extWorkerState.status === 'ready_for_preview' ? ((extWorkerState as any)._validationResult ?? null) : null,
      });

      /* Phase 5: sync job events to workerEventsStore for the progress UI */
      setWorkerEvents(extWorkerState.events);

      /*
       * Mark this as the live build so per-turn streams skip it (the global
       * BuildStream already draws it). It stays "active" through
       * ready_for_preview until the NEXT turn starts a new job.
       */
      activeBuildJobIdStore.set(extWorkerState.jobId ?? null);

      /* Phase 10: sync real progress percentage + current step */
      setWorkerProgress(extWorkerState.progress, extWorkerState.currentStep);

      /*
       * SHOW WORKBENCH when the first file is written or build is ready.
       *
       * The legacy chat path shows the workbench via onArtifactOpen in
       * useMessageParser (when it parses <palmkitArtifact> XML tags).
       * But the external worker path doesn't use XML — it uses write_file
       * tool calls. So showWorkbench was NEVER set to true, and the
       * workbench (with the preview iframe) stayed off-screen.
       *
       * On phones (<640px), opening the workbench flips the bottom-dock tab
       * to Workspace (MobileShell reacts to showWorkbench), which used to
       * YANK the user out of the conversation the moment the first file was
       * written mid-build. There, don't auto-open at all from here — the
       * chat's inline BuildStream shows the live build, and the auto-preview
       * paths (use-worker-sandbox for E2B apps, Preview's blob effect for
       * static apps) open the workspace when the running app is actually
       * ready to look at.
       */
      const isPhone = typeof window !== 'undefined' && window.innerWidth < 640;

      if (!isPhone && (extWorkerState.files.length > 0 || extWorkerState.status === 'ready_for_preview')) {
        workbenchStore.showWorkbench.set(true);
      }

      /*
       * Persist the jobId to chat metadata AS SOON AS it exists — not only when
       * the build finishes. This is what lets a MID-BUILD page refresh restore
       * the live BuildStream: on reload we look up palmkitJobId and resume
       * polling. (Previously this ran only on ready_for_preview, so refreshing
       * DURING a build lost the whole stream — the user saw only the static
       * "Building your project…" line with no idea where the build was.)
       */
      if (extWorkerState.jobId) {
        /* Phase 8: track job ID for ZIP export once the build is ready. */
        if (extWorkerState.status === 'ready_for_preview') {
          setCurrentJobId(extWorkerState.jobId);
        }

        const currentMetadata = chatMetadata.get();
        const appType = extWorkerState.appType ?? currentMetadata?.palmkitAppType;

        /*
         * Save palmkitJobId so the next message can resolve priorJobId.
         *
         * Save on TWO occasions:
         *   1. When the job STARTS (status='pending' or 'generating') — so a
         *      cancelled build still has its jobId saved. Without this, a user
         *      who cancels before ready_for_preview, reloads, and sends a
         *      follow-up message has NO palmkitJobId → the system starts a
         *      fresh build instead of an edit (losing all context).
         *   2. When the job SUCCEEDS (status='ready_for_preview') — confirms
         *      the job and updates the appType.
         *
         * Do NOT overwrite on 'failed_clean' with a non-cancel error — that
         * would replace a successful build's jobId with a failed edit's jobId.
         * Cancelled jobs (error_summary='Cancelled by user') are fine — they
         * may complete in the background and produce a manifest.
         */
        const shouldSaveJobId =
          (extWorkerState.jobId &&
            (extWorkerState.status === 'pending' ||
              extWorkerState.status === 'generating' ||
              extWorkerState.status === 'ready_for_preview') &&
            currentMetadata?.palmkitJobId !== extWorkerState.jobId) ||
          (extWorkerState.status === 'ready_for_preview' && currentMetadata?.palmkitAppType !== appType);

        if (shouldSaveJobId && extWorkerState.jobId) {
          chatMetadata.set({
            ...currentMetadata,
            gitUrl: currentMetadata?.gitUrl ?? '',
            palmkitJobId: extWorkerState.jobId,
            palmkitAppType: appType,
          });

          /*
           * Save the chat to IndexedDB with the LATEST messages + metadata so
           * the jobId reference survives a refresh at any point in the build.
           */
          const visibleMessages = messages.filter((m) => !m.annotations?.includes('hidden'));

          if (visibleMessages.length > 0) {
            storeMessageHistory(visibleMessages).catch((err) => {
              console.warn('[Palmkit] Failed to save worker chat to IndexedDB:', err);
            });
          }
        }
      }

      /* Live-stream Oracle worker events into the assistant message on every poll */
      if (
        extWorkerState.events.length > 0 ||
        extWorkerState.status === 'failed_clean' ||
        extWorkerState.status === 'ready_for_preview'
      ) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];

          if (last?.role !== 'assistant') {
            return prev;
          }

          /*
           * Detect a worker build-turn message by its ⚡ marker (the
           * placeholder set when the turn was created) OR by the presence
           * of a palmkit-build annotation (stamped once the jobId is known).
           * Either signal means this turn is a build and should be updated
           * from the worker state. We no longer match ✅/❌ because once the
           * build is done/failed, the content is the brain's summary or the
           * error text — both are final, no further updates needed.
           */
          const hasBuildAnnotation =
            Array.isArray(last.annotations) &&
            last.annotations.some((a) => a && typeof a === 'object' && (a as any).type === 'palmkit-build');
          const isWorkerMessage =
            last.content.trim().startsWith('⚡') || last.content.trim().startsWith('❌') || hasBuildAnnotation;

          if (!isWorkerMessage) {
            return prev;
          }

          const newContent = buildWorkerStreamContent(extWorkerState);

          /*
           * Stamp THIS assistant turn with its jobId so the per-turn build
           * stream (TurnBuildStream) can reload exactly this turn's timeline
           * later — even after several more edits replace the live event store.
           * Persisted with the message, so it survives reload. Dedup by jobId.
           */
          const jobId = extWorkerState.jobId;
          const existingAnnotations = Array.isArray(last.annotations) ? last.annotations : [];
          const hasBuildAnn =
            !!jobId &&
            existingAnnotations.some(
              (a) => a && typeof a === 'object' && (a as any).type === 'palmkit-build' && (a as any).jobId === jobId,
            );
          const nextAnnotations =
            jobId && !hasBuildAnn ? [...existingAnnotations, { type: 'palmkit-build', jobId }] : existingAnnotations;

          if (newContent === last.content && nextAnnotations === existingAnnotations) {
            return prev;
          }

          /*
           * Replace BOTH `content` and `parts`. The ai-sdk renders assistant
           * messages from `parts` when present; updating only `content` left
           * the stale text parts in place, so successive status lines rendered
           * on top of each other ("Building project…project…** · 1 reasoning
           * stepne · 2 reasoning stepsdone…" — the garbled banner seen live).
           */
          const updatedMessages = [
            ...prev.slice(0, -1),
            {
              ...last,
              content: newContent,
              parts: [{ type: 'text' as const, text: newContent }],
              annotations: nextAnnotations,
            },
          ];

          /*
           * Save to IndexedDB immediately when the content changes.
           * This ensures the latest stream content (including BUILD COMPLETE)
           * is persisted. Without this, page refresh shows the old "Building..."
           * text because the messages state was never saved.
           */
          storeMessageHistory(updatedMessages).catch(() => {
            // best-effort
          });

          return updatedMessages;
        });
      }
    }, [externalWorkerEnabled, extWorkerState]);

    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    /*
     * Phase 1 Safety Gate — Sync validation annotations to buildStatusStore.
     *
     * api.chat.ts emits `writeMessageAnnotation({type:'validation', value:{...}})`
     * after each segment. The AI SDK delivers these on `message.annotations`.
     * We pick the LATEST validation annotation from the most recent assistant
     * message and push it into the build-status store. The Preview component
     * reads that store to decide whether to render the iframe or show the
     * "No preview available" state.
     *
     * See ROADMAP.md → Phase 1 → "Fix partial preview".
     */
    useEffect(() => {
      if (messages.length === 0) {
        return;
      }

      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role !== 'assistant') {
        return;
      }

      const annotations = (lastMessage as Message & { annotations?: unknown[] }).annotations;

      if (!Array.isArray(annotations) || annotations.length === 0) {
        return;
      }

      // Find the most recent validation annotation.
      const validationAnns = annotations.filter(
        (a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>).type === 'validation',
      ) as Array<{ type: 'validation'; value: Record<string, unknown> }>;

      if (validationAnns.length === 0) {
        return;
      }

      const latest = validationAnns[validationAnns.length - 1]?.value ?? {};

      setBuildStatus({
        completeness: (latest.completeness as BuildCompleteness) ?? 'unknown',
        jobStatus: (latest.jobStatus as BuildJobStatus) ?? 'generating',
        hasCompletionMarker: Boolean(latest.hasCompletionMarker),
        artifactTagsBalanced: Boolean(latest.artifactTagsBalanced),
        fileActionsBalanced: Boolean(latest.fileActionsBalanced),
        fileCount: Number(latest.fileCount ?? 0),
        issues: Array.isArray(latest.issues) ? latest.issues : [],
        retryCount: Number(latest.retryCount ?? 0),
      });
    }, [messages]);

    /**
     * FIX #3: Watch workbenchStore.files changes during streaming and save
     * debounced snapshots to IndexedDB. This ensures files are persisted even
     * if the user refreshes mid-generation.
     */
    const prevFilesRef = useRef<FileMap>({});
    const immediateSaveCounterRef = useRef<number>(0);
    useEffect(() => {
      const currentFiles = files;

      if (isLoading && Object.keys(currentFiles).length > 0) {
        const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : '';
        const prevFiles = prevFilesRef.current;

        // Only trigger debounced save if files have actually changed
        const filesChanged = JSON.stringify(currentFiles) !== JSON.stringify(prevFiles);

        if (filesChanged && lastMessageId) {
          prevFilesRef.current = currentFiles;
          takeDebouncedSnapshot(lastMessageId, currentFiles).catch((err) => {
            console.error('Debounced snapshot save failed:', err);
          });

          /*
           * BUG FIX (2026-06-29): Also save an IMMEDIATE (non-debounced)
           * snapshot every 5th file change. The 2s debounce can drop the
           * most recent files if the page is refreshed mid-build —
           * leaving the user with a stale snapshot that doesn't include
           * the last 1-2s of streamed files. This immediate save acts
           * as a floor: at most we lose 4 file actions worth of work.
           */
          immediateSaveCounterRef.current = (immediateSaveCounterRef.current ?? 0) + 1;

          if (immediateSaveCounterRef.current >= 5) {
            immediateSaveCounterRef.current = 0;
            takeSnapshot(lastMessageId, currentFiles).catch((err) => {
              console.error('Immediate snapshot save failed:', err);
            });
          }
        }
      }
    }, [files, isLoading, messages, takeDebouncedSnapshot, takeSnapshot]);

    /*
     * Persistence fix: the effect above only saves WHILE streaming, but file
     * actions (and registerFile on mobile) often finish AFTER streaming ends, so
     * the final/complete file set was never snapshotted — files vanished on
     * re-entry. Save a final snapshot when generation completes, plus a delayed
     * one to catch files written just after the stream closed.
     */
    const prevLoadingRef = useRef(isLoading);
    useEffect(() => {
      const justFinished = prevLoadingRef.current && !isLoading;
      prevLoadingRef.current = isLoading;

      if (!justFinished) {
        return undefined;
      }

      const saveFinal = () => {
        const finalFiles = workbenchStore.files.get();
        const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : '';

        /*
         * Always advance the snapshot's chatIndex to the latest assistant message,
         * even when the workbench has no files.
         * The debounced saver will preserve any previously-stored files so we
         * don't lose earlier snapshot data.
         */
        if (lastMessageId) {
          takeDebouncedSnapshot(lastMessageId, finalFiles).catch((err) => {
            console.error('Final snapshot save failed:', err);
          });
        }
      };

      saveFinal();

      const t = setTimeout(saveFinal, 3000);

      return () => clearTimeout(t);
    }, [isLoading, messages, takeDebouncedSnapshot]);

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      /*
       * Stop button — "pause and let me tell you something".
       *
       * The user wants to interrupt the build to add a correction, fix, or
       * new instruction. The RIGHT behavior (vs the old "cancel + start
       * fresh" which lost all context):
       *
       *   1. Stop polling the current job — the UI drops to 'idle' so the
       *      Send button reverts and the user can type.
       *   2. KEEP palmkitJobId in chat metadata. The orphaned worker job
       *      continues to completion in the background (writes files +
       *      worklog + manifest). This is the CONTEXT the next message
       *      will build on.
       *   3. When the user sends a new message, `priorJobId` resolves to
       *      this saved jobId → the worker treats it as an EDIT (not a new
       *      build): it reads the worklog + files + the new message, and
       *      the LLM reasons about what to change. The worker's edit path
       *      polls the manifest for up to 30s, so even if the previous job
       *      hasn't finished uploading yet, the edit waits for it.
       *
       * The epoch guard in useExternalWorker ensures the old polling loop
       * doesn't override the reset. We do NOT clear palmkitJobId — that
       * would sever the context link and force a from-scratch rebuild.
       */
      resetExtWorker();

      /*
       * Write 'cancel_requested' to Supabase. The orchestrator polls the
       * job's status between agent steps; when it sees cancel_requested it
       * fires its AbortController (cancels the in-flight LLM stream) and
       * writes a PARTIAL manifest from the files written so far. This is the
       * Supabase-native cancel path — no public worker URL needed.
       */
      const currentMeta = chatMetadata.get();

      if (currentMeta?.palmkitJobId) {
        abortedJobIdRef.current = currentMeta.palmkitJobId;
        cancelExtJob(currentMeta.palmkitJobId).catch((e) => console.warn('[abort] cancelJob failed:', e));
      }

      /*
       * SILENT CANCEL — no "Build cancelled" message in the stream.
       * Just reset build status. The worker detects the cancel on next poll.
       */
      resetBuildStatus();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });

        // Finalize any open parser actions so files aren't lost
        finalizeMessageParser();
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      /*
       * Fetch memory block before sending (Layer 1 + Layer 3)
       * This injects user profile + relevant facts into the system prompt
       */
      try {
        const mode = chatMode === 'discuss' ? 'chat' : 'code';
        memoryBlockRef.current = await fetchMemoryBlock(messageContent, mode);
      } catch {
        memoryBlockRef.current = '';
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__palmkitSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      // Phase 1 Safety Gate: reset build status at the start of each new build.
      resetBuildStatus();
      clearWorkerEvents();
      resetWorkerProgress();

      /*
       * Phase 2: External Worker path (experimental, feature-flagged).
       * If the flag is on, we bypass the legacy /api/chat streaming flow
       * and instead enqueue a job via /api/jobs. The worker picks it up,
       * generates files, uploads to R2, and we poll for status.
       * Preview renders from R2 files when status=ready_for_preview.
       *
       * Toggle via: localStorage.setItem('palmkit_use_external_worker', 'true')
       */
      if (externalWorkerEnabled) {
        chatStore.setKey('started', true);
        chatStore.setKey('aborted', false);

        /*
         * Set chat ID and description IMMEDIATELY so the URL is correct
         * and the chat can be saved to IndexedDB.
         * Without this, the URL shows /chat/NaN and the chat is lost on refresh.
         */
        /*
         * Normally each new build mints a fresh chat/project id. But when THIS
         * chat was created via "Continue in a fresh chat", its workspace (the
         * carried-over files + memory + handoff) already lives under the current
         * chat id. Reusing that id makes the worker hydrate + continue that
         * workspace instead of starting an empty project under a new id.
         */
        /*
         * Reuse the CURRENT chat's id for every follow-up/edit — mint a fresh id
         * ONLY when there is no active chat (a brand-new conversation).
         *
         * The old code minted a new `Date.now()` id on EVERY send unless the chat
         * was a "continue in a fresh chat" fork. That single line caused three
         * reported bugs at once:
         *   1. the follow-up prompt was saved under a DIFFERENT chat id than the
         *      one on screen, so it vanished from the conversation on refresh;
         *   2. one conversation fragmented into many sidebar entries;
         *   3. the edit's workspace was keyed under a new projectId, detached from
         *      the original build's files.
         * "Start new chat" is a full page load (<a href="/">), which resets this
         * atom, so a defined id here reliably means "continue this conversation".
         */
        const existingChatId = chatId.get();

        /*
         * ROOT FIX: use crypto.randomUUID() instead of Date.now() for the
         * chatId/projectId. Date.now() can collide if two builds start in the
         * same millisecond (observed: two concurrent builds shared the same
         * projectId, causing file overwrites and broken isolation). UUIDs
         * are guaranteed unique — no race condition possible.
         *
         * Note: existingChatId is preserved for continuation (edit round),
         * so this only generates a new ID for the FIRST message in a chat.
         */
        const workerChatId = existingChatId ?? crypto.randomUUID();
        chatId.set(workerChatId);

        /*
         * Clear the aborted-job marker — the user is sending a new message,
         * which (if palmkitJobId exists from a prior build/abort) will be
         * treated as an edit on that job's workspace. The restore effect is
         * now allowed to re-attach if this build also gets aborted later.
         */
        abortedJobIdRef.current = null;

        /*
         * Title the chat from its FIRST prompt only. Setting it on every send
         * renamed the whole conversation to the latest edit prompt — so only
         * derive a title when the chat doesn't have one yet, and never overwrite.
         */
        if (!descriptionAtom.get()) {
          descriptionAtom.set(finalMessageContent.slice(0, 50));
        }

        // Add user message to chat so the conversation is visible and persisted
        const extUserText = finalMessageContent;

        /*
         * Treat this as an EDIT when the chat already has a build to edit:
         *   - the live worker state is ready (a build finished this session), OR
         *   - the chat carries a persisted jobId (a REOPENED/restored chat whose
         *     worker state hasn't rehydrated yet).
         * Without the second case, editing a project opened from history rebuilt
         * it from scratch — throwing away the user's existing files/customizations
         * — because editFromJobId was undefined. We resolve the prior job here and
         * reuse it for both the placeholder label and the edit handoff below.
         */
        const priorJobId =
          (extWorkerState.status === 'ready_for_preview' && extWorkerState.jobId) ||
          chatMetadata.get()?.palmkitJobId ||
          undefined;

        /*
         * `isEditJob` was previously used to label the assistant placeholder
         * ("⚡ Editing project…" vs "⚡ Building project…"). The placeholder
         * is now just "⚡" (a marker, no descriptive text), so `isEditJob`
         * is no longer needed for the label. The `priorJobId` itself is
         * still used below for the edit handoff (`editFromJobId`).
         */

        /*
         * Build the new messages array BEFORE calling setMessages.
         * We need the array to pass to storeMessageHistory immediately —
         * setMessages is async so `messages` state won't update until next render.
         * Previously, storeMessageHistory(messages) was called with the STALE
         * messages array (before the user message was added), so the chat
         * was never saved to IndexedDB.
         */
        const userMessage = {
          id: `${Date.now()}`,
          role: 'user' as const,
          content: extUserText,
          parts: createMessageParts(extUserText, imageDataList),
        };
        const assistantPlaceholder = {
          id: `${Date.now()}-assistant`,
          role: 'assistant' as const,

          /*
           * Just the ⚡ marker — no descriptive text. This is a build-turn
           * marker detected by `isBuildBannerContent` in Messages.client.tsx
           * to route the turn into the build-stream UI. The actual content
           * (the brain's summary) is filled in by `buildWorkerStreamContent`
           * when the build completes. During the build, the global
           * BuildStream panel is the single voice — no hardcoded banner.
           */
          content: '⚡',
        };
        const newMessages = [...messages, userMessage, assistantPlaceholder];

        setMessages(newMessages);

        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);
        setUploadedFiles([]);
        setImageDataList([]);
        textareaRef.current?.blur();

        /* Edit the existing project (same-session build OR a reopened chat). */
        const editFromJobId = priorJobId;

        /*
         * Pass the chat ID as projectId so the worker can key the workspace
         * files, worklog, and manifest under projects/{projectId}/workspace/.
         * This links the chat to its R2 workspace for restore-on-reload.
         */
        /*
         * Pass FULL conversation history to the brain — no truncation.
         *
         * Like Super Z: I see every message in full, no slicing, no truncation.
         * The brain should too. The model's context window (200K+ tokens) IS
         * the limit — not an arbitrary number we impose.
         *
         * When the context genuinely gets too full, the SessionAdvisor offers
         * "Continue in a fresh chat" with a compact handoff. That's the real
         * signal — not an artificial message count or character limit.
         *
         * We DO filter out hidden messages (annotations: ['hidden']) and empty
         * content, but we do NOT truncate or slice.
         */
        const conversationHistory = messages
          .filter((m) => {
            if (m.role !== 'user' && m.role !== 'assistant') {
              return false;
            }

            if (m.annotations?.includes('hidden')) {
              return false;
            }

            const content = typeof m.content === 'string' ? m.content : '';

            return content.length > 0;
          })
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: typeof m.content === 'string' ? m.content : '',
          }));

        await startExtJob(
          finalMessageContent,
          model,
          provider.name,
          editFromJobId,
          workerChatId,
          designScheme,
          conversationHistory,

          /*
           * Pass user-uploaded images (food photos, logos, etc.) so the
           * brain can actually use them in the build. Without this, the
           * user's uploads were silently dropped — the brain never saw
           * them and couldn't reference them in the project.
           */
          imageDataList,
        );

        /*
         * Save the chat to IndexedDB IMMEDIATELY with the NEW messages array.
         * Previously this used the stale `messages` variable which didn't
         * include the user message + assistant placeholder.
         *
         * chatId was already set above (line 887: chatId.set(workerChatId)),
         * so storeMessageHistory will use the correct chat ID.
         */
        storeMessageHistory(newMessages).catch((err) => {
          console.warn('[Palmkit] Failed to save worker chat on send:', err);
        });

        /*
         * Also update the URL to /chat/{workerChatId} so the browser
         * address bar reflects the current chat. This helps with:
         * - Page refresh (URL already points to the chat)
         * - Browser history (back button works)
         * - Bookmarking
         */
        /*
         * Only claim the URL for a BRAND-NEW chat (started from "/"). On a
         * follow-up we're already on this chat's /chat/<slug> URL, and
         * storeMessageHistory keeps that slug — replacing it with the internal
         * numeric id here would needlessly change the address bar mid-conversation.
         */
        if (!window.location.pathname.startsWith('/chat/')) {
          window.history.replaceState({}, '', `/chat/${workerChatId}`);
        }

        return;
      }

      if (!chatStarted) {
        setFakeLoading(true);

        /*
         * Skip the heavy starter-template clone on mobile: there we generate the
         * project directly and run it in the cloud sandbox (cleaner, no failing
         * in-browser install). Templates remain available on desktop.
         */
        if (autoSelectTemplate && !isMemoryConstrainedDevice()) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: userMessageText,
                  parts: createMessageParts(userMessageText, imageDataList),
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);

              const reloadOptions =
                uploadedFiles.length > 0
                  ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
                  : undefined;

              reload(reloadOptions);
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      textareaRef.current?.blur();
    };

    /*
     * Retry from the failure card: the unified "Build failed" card in the
     * BuildStream dispatches `palmkit:retry-build`; re-send the last user
     * message so the whole build runs again with the same prompt.
     */
    useEffect(() => {
      const onRetry = () => {
        if (isLoading) {
          return;
        }

        const lastUser = [...messages].reverse().find((m) => m.role === 'user');

        if (lastUser?.content) {
          const text = typeof lastUser.content === 'string' ? lastUser.content : '';

          if (text.trim()) {
            sendMessage({} as React.UIEvent, text);
          }
        }
      };

      window.addEventListener('palmkit:retry-build', onRetry);

      return () => window.removeEventListener('palmkit:retry-build', onRetry);
    }, [messages, isLoading]);

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    /*
     * Detect if the last assistant message has an open artifact tag but no closing tag —
     * indicates the stream was cut off (network drop, page refresh during streaming).
     */
    const lastMsg = messages[messages.length - 1];
    const isInterruptedGeneration =
      !externalWorkerEnabled &&
      !isLoading &&
      !fakeLoading &&
      chatStarted &&
      messages.length > 0 &&
      lastMsg?.role === 'assistant' &&
      typeof lastMsg.content === 'string' &&
      lastMsg.content.includes('<palmkitArtifact') &&
      !lastMsg.content.includes('</palmkitArtifact');

    return (
      <>
        {/* Desktop only — on mobile the unified bottom status bar (RemotePreviewTrigger) owns status. */}
        <div className="hidden sm:block">
          <GenerationStatusBar />
        </div>
        <BaseChat
          ref={animationScope}
          textareaRef={textareaRef}
          input={input}
          setInput={setInput}
          showChat={showChat}
          chatStarted={chatStarted}
          isStreaming={
            isLoading || fakeLoading || extWorkerState.status === 'pending' || extWorkerState.status === 'generating'
          }
          onStreamingChange={(streaming) => {
            streamingState.set(streaming);
          }}
          sendMessage={sendMessage}
          model={model}
          setModel={handleModelChange}
          provider={provider}
          setProvider={handleProviderChange}
          providerList={activeProviders}
          handleInputChange={(e) => {
            onTextareaChange(e);
            debouncedCachePrompt(e);
          }}
          handleStop={abort}
          description={description}
          importChat={importChat}
          exportChat={exportChat}
          messages={messages.map((message, i) => {
            if (message.role === 'user') {
              return message;
            }

            return {
              ...message,
              content: parsedMessages[i] || '',
            };
          })}
          uploadedFiles={uploadedFiles}
          setUploadedFiles={setUploadedFiles}
          imageDataList={imageDataList}
          setImageDataList={setImageDataList}
          actionAlert={actionAlert}
          clearAlert={() => workbenchStore.clearAlert()}
          supabaseAlert={supabaseAlert}
          clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
          deployAlert={deployAlert}
          clearDeployAlert={() => workbenchStore.clearDeployAlert()}
          llmErrorAlert={llmErrorAlert}
          clearLlmErrorAlert={clearApiErrorAlert}
          data={chatData}
          chatMode={chatMode}
          setChatMode={setChatMode}
          append={append}
          designScheme={designScheme}
          setDesignScheme={setDesignScheme}
          selectedElement={selectedElement}
          setSelectedElement={setSelectedElement}
          addToolResult={addToolResult}
          onWebSearchResult={handleWebSearchResult}
          onOpenProjectList={onOpenProjectList}
          isInterruptedGeneration={isInterruptedGeneration}
          onResumeGeneration={() => {
            append({ role: 'user', content: CONTINUE_PROMPT });
          }}
        />
      </>
    );
  },
);
