import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, finalizeMessageParser } from '~/lib/hooks';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/prompts';
import { description, useChatHistory, chatMetadata } from '~/lib/persistence';
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
} from '~/lib/stores/build-status';
import type { BuildCompleteness, BuildJobStatus } from '~/lib/stores/build-status';
import { useExternalWorker, useExternalWorkerFlag } from '~/lib/hooks/use-external-worker';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import { PENDING_PROMPT_KEY } from '~/components/landing/LandingPromptBox';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
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

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat, takeDebouncedSnapshot } =
    useChatHistory();
  const title = useStore(description);
  const [projectListOpen, setProjectListOpen] = useState(false);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      <RestoreOverlay />
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
          takeDebouncedSnapshot={takeDebouncedSnapshot}
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

/** Build the assistant message content from Oracle-worker events — creates a streaming-like experience. */
function buildWorkerStreamContent(state: import('~/lib/hooks/use-external-worker').ExternalWorkerState): string {
  if (state.status === 'failed_clean') {
    return `❌ **Build failed**\n\n${state.error ?? 'Unknown error'}`;
  }

  const lines: string[] = [];
  const isDone = state.status === 'ready_for_preview';

  lines.push(
    isDone
      ? `✅ **Build complete** — ${state.files.length} file${state.files.length !== 1 ? 's' : ''} generated`
      : '🔨 **Building your project...**',
  );

  for (const event of state.events) {
    switch (event.type) {
      case 'planning_started':
        lines.push('', '📋 Planning app structure...');
        break;
      case 'planning_completed':
        lines.push('✓ Plan ready');
        break;
      case 'file_generation_started':
        lines.push('', '⚙️ Generating files...');
        break;
      case 'file_written': {
        const path = event.payload?.filePath as string | undefined;
        const lc = event.payload?.lineCount as number | undefined;

        if (path) {
          lines.push(`  \`+${path}\`${lc != null ? `  (${lc} lines)` : ''}`);
        }

        break;
      }
      case 'build_check_started':
        lines.push('', '🔧 Verifying build...');
        break;
      case 'build_check_passed':
        lines.push('✓ Build verified');
        break;
      case 'ready_for_preview':
        lines.push('', 'Switch to the **Preview** tab to see your project.');
        break;
      case 'job_failed':
        lines.push('', `❌ ${event.message}`);
        break;
      default:
        break;
    }
  }

  return lines.join('\n');
}

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
  takeDebouncedSnapshot: (chatIdx: string, files: FileMap, chatSummary?: string) => Promise<void>;
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
    onOpenProjectList,
  }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
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
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const pendingEditPrompt = useStore(pendingEditPromptStore);
    const mcpSettings = useMCPStore((state) => state.settings);

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
        chatMode,
        designScheme,
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

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();

    // Phase 2: External Worker feature flag + hook.
    const externalWorkerEnabled = useExternalWorkerFlag();
    const { state: extWorkerState, startJob: startExtJob } = useExternalWorker();

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
      });

      /* Phase 5: sync job events to workerEventsStore for the progress UI */
      setWorkerEvents(extWorkerState.events);

      /* Phase 10: sync real progress percentage + current step */
      setWorkerProgress(extWorkerState.progress, extWorkerState.currentStep);

      /* Phase 8: track job ID for ZIP export + persist to chat metadata for restore-on-reload */
      if (extWorkerState.status === 'ready_for_preview' && extWorkerState.jobId) {
        setCurrentJobId(extWorkerState.jobId);

        /*
         * Persist jobId + appType to chat metadata so preview can be restored on page reload.
         * Without this, reload loses the job reference AND the app type, so the preview
         * can't decide whether to use blob URL (static), WebContainer (React desktop),
         * or E2B (mobile/Python) — the user sees "No preview available".
         */
        const currentMetadata = chatMetadata.get();

        if (currentMetadata?.palmkitJobId !== extWorkerState.jobId) {
          chatMetadata.set({
            ...currentMetadata,
            gitUrl: currentMetadata?.gitUrl ?? '',
            palmkitJobId: extWorkerState.jobId,
            palmkitAppType: extWorkerState.appType ?? undefined,
          });

          /*
           * CRITICAL: Save the chat to IndexedDB so it persists across refreshes.
           * Without this, refreshing the page loses the entire conversation because
           * worker builds don't create IndexedDB records by default.
           *
           * This also makes the chat appear in the sidebar (Projects list).
           */
          if (messages.length > 0) {
            storeMessageHistory(messages).catch((err) => {
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

          const isWorkerMessage =
            last.content.startsWith('⚡') ||
            last.content.startsWith('🔨') ||
            last.content.startsWith('✅') ||
            last.content.startsWith('❌');

          if (!isWorkerMessage) {
            return prev;
          }

          const newContent = buildWorkerStreamContent(extWorkerState);

          if (newContent === last.content) {
            return prev;
          }

          return [...prev.slice(0, -1), { ...last, content: newContent }];
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
        }
      }
    }, [files, isLoading, messages, takeDebouncedSnapshot]);

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
         * even when the workbench has no files (e.g. WebContainer didn't boot).
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

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

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

        // Add user message to chat so the conversation is visible and persisted
        const extUserText = finalMessageContent;
        const isEditJob = extWorkerState.status === 'ready_for_preview' && Boolean(extWorkerState.jobId);
        setMessages([
          ...messages,
          {
            id: `${Date.now()}`,
            role: 'user',
            content: extUserText,
            parts: createMessageParts(extUserText, imageDataList),
          },

          // Placeholder assistant message — shows progress until build completes
          {
            id: `${Date.now()}-assistant`,
            role: 'assistant',
            content: isEditJob ? '⚡ Editing project…' : '⚡ Building project…',
          },
        ]);

        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);
        setUploadedFiles([]);
        setImageDataList([]);
        resetEnhancer();
        textareaRef.current?.blur();

        /* Phase 7: if there's a completed build in this session, treat as edit */
        const editFromJobId =
          extWorkerState.status === 'ready_for_preview' && extWorkerState.jobId ? extWorkerState.jobId : undefined;

        await startExtJob(finalMessageContent, model, provider.name, editFromJobId);

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

              resetEnhancer();

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

        resetEnhancer();

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

      resetEnhancer();

      textareaRef.current?.blur();
    };

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
          showChat={showChat}
          chatStarted={chatStarted}
          isStreaming={isLoading || fakeLoading}
          onStreamingChange={(streaming) => {
            streamingState.set(streaming);
          }}
          enhancingPrompt={enhancingPrompt}
          promptEnhanced={promptEnhanced}
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
          enhancePrompt={() => {
            enhancePrompt(
              input,
              (input) => {
                setInput(input);
                scrollTextArea();
              },
              model,
              provider,
              apiKeys,
            );
          }}
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
