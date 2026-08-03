import React from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { ensureSignedIn } from '~/lib/stores/auth';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { ModelSelector } from '~/components/chat/ModelSelector';
import FilePreview from './FilePreview';
import { ScreenshotStateManager } from './ScreenshotStateManager';

import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import { SupabaseConnection } from './SupabaseConnection';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import type { ProviderInfo } from '~/types/model';
import { ColorSchemeDialog } from '~/components/ui/ColorSchemeDialog';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import { McpTools } from './MCPTools';
import { WebSearch } from './WebSearch.client';
import { ThinkingMeter, PlusMenu } from './ComposerControls';
import { useStore } from '@nanostores/react';
import { sidebarModeStore } from '~/lib/stores/sidebar';

interface ChatBoxProps {
  isModelSettingsCollapsed: boolean;
  setIsModelSettingsCollapsed: (collapsed: boolean) => void;
  provider: any;
  providerList: any[];
  modelList: any[];
  isModelLoading: string | undefined;
  uploadedFiles: File[];
  imageDataList: string[];
  textareaRef: React.RefObject<HTMLTextAreaElement> | undefined;
  input: string;
  handlePaste: (e: React.ClipboardEvent) => void;
  TEXTAREA_MIN_HEIGHT: number;
  TEXTAREA_MAX_HEIGHT: number;
  isStreaming: boolean;
  handleSendMessage: (event: React.UIEvent, messageInput?: string) => void;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  chatStarted: boolean;
  exportChat?: () => void;
  qrModalOpen: boolean;
  setQrModalOpen: (open: boolean) => void;
  handleFileUpload: () => void;
  setProvider?: ((provider: ProviderInfo) => void) | undefined;
  model?: string | undefined;
  setModel?: ((model: string) => void) | undefined;
  setUploadedFiles?: ((files: File[]) => void) | undefined;
  setImageDataList?: ((dataList: string[]) => void) | undefined;
  handleInputChange?: ((event: React.ChangeEvent<HTMLTextAreaElement>) => void) | undefined;
  handleStop?: (() => void) | undefined;
  onWebSearchResult?: (result: string) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: ((element: ElementInfo | null) => void) | undefined;
}

/* Prominent send / stop button — brand accent (Design v2). */
function SendStopButton({
  isStreaming,
  canSend,
  disabled,
  onClick,
}: {
  isStreaming: boolean;
  canSend: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const enabled = isStreaming || canSend;

  return (
    <button
      type="button"
      aria-label={isStreaming ? 'Stop' : 'Send'}
      disabled={disabled || !enabled}
      onClick={(e) => {
        e.preventDefault();
        onClick(e);
      }}
      className={classNames(
        'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 active:scale-[.94]',
        'disabled:opacity-30 disabled:cursor-not-allowed',
      )}
      style={
        isStreaming
          ? { background: 'rgba(239, 68, 68, 0.92)', color: '#fff' }
          : {
              background: 'linear-gradient(145deg, var(--pk-accent), var(--pk-accent-deep))',
              color: 'var(--pk-on-accent)',
              boxShadow: enabled ? '0 2px 14px var(--pk-accent-dim)' : 'none',
            }
      }
    >
      <div className="text-base">
        {isStreaming ? <div className="i-ph:stop-bold" /> : <div className="i-ph:arrow-up-bold" />}
      </div>
    </button>
  );
}

/* ---------- Main ChatBox ---------- */
export const ChatBox: React.FC<ChatBoxProps> = (props) => {
  const canSend = props.input.length > 0 || props.uploadedFiles.length > 0;

  /*
   * Design v2 — compact composer. On phones the secondary tools (web search,
   * palette, MCP, Supabase) hide behind a single "+" toggle so the box stays
   * one clean row; on sm+ they are always visible.
   */
  const sidebarMode = useStore(sidebarModeStore);

  /*
   * The Chat/Code intent now lives in the sidebar's segmented control (v3), so
   * the old in-composer Build/Discuss toggle is gone. Keep the existing
   * build/discuss plumbing alive by mirroring the sidebar choice: the Code tab
   * builds a project, everything else is a plain discussion.
   */
  const setChatMode = props.setChatMode;
  React.useEffect(() => {
    setChatMode?.(sidebarMode === 'code' ? 'build' : 'discuss');
  }, [sidebarMode, setChatMode]);

  const onSendClick = (event: React.UIEvent) => {
    if (props.isStreaming) {
      props.handleStop?.();
      return;
    }

    if (canSend) {
      props.handleSendMessage?.(event);
    }
  };

  return (
    <div
      className={classNames(
        'relative w-full max-w-chat mx-auto z-prompt',
        'rounded-2xl',
        'bg-palmkit-elements-prompt-background backdrop-blur',
        'border border-palmkit-elements-borderColor',
        'shadow-[0_2px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_24px_rgba(0,0,0,0.4)]',
        'transition-all duration-200',
        'focus-within:border-[var(--pk-accent)]',
        'focus-within:shadow-[0_0_0_1px_var(--pk-accent),0_2px_24px_var(--pk-accent-dim)]',
      )}
    >
      {/* Collapsible model settings (provider + model + API key) */}
      <ClientOnly>
        {() => (
          <div
            className={classNames(
              'overflow-hidden transition-all',
              props.isModelSettingsCollapsed ? 'max-h-0' : 'max-h-[70vh] overflow-y-auto',
            )}
          >
            <div className="p-2 border-b border-palmkit-elements-borderColor/70">
              <ModelSelector
                key={props.provider?.name + ':' + props.modelList.length}
                model={props.model}
                setModel={props.setModel}
                modelList={props.modelList}
                provider={props.provider}
                setProvider={props.setProvider}
                providerList={props.providerList || (PROVIDER_LIST as ProviderInfo[])}
                modelLoading={props.isModelLoading}
              />
              {/*
               * Two things used to sit here and no longer do.
               *
               * The API key field: a password box beside the message box, whose
               * value lived in a browser cookie. Keys are now entered once in
               * Settings → Model providers, encrypted at rest, and never shown
               * again — the composer has no business holding a credential.
               *
               * "Models per task": five hardcoded roles filtered by a regex
               * that guessed capabilities from model names. Model assignment
               * belongs in settings, on top of the capability registry.
               */}
            </div>
          </div>
        )}
      </ClientOnly>

      {/* File previews */}
      <FilePreview
        files={props.uploadedFiles}
        imageDataList={props.imageDataList}
        onRemove={(index) => {
          props.setUploadedFiles?.(props.uploadedFiles.filter((_, i) => i !== index));
          props.setImageDataList?.(props.imageDataList.filter((_, i) => i !== index));
        }}
      />
      <ClientOnly>
        {() => (
          <ScreenshotStateManager
            setUploadedFiles={props.setUploadedFiles}
            setImageDataList={props.setImageDataList}
            uploadedFiles={props.uploadedFiles}
            imageDataList={props.imageDataList}
          />
        )}
      </ClientOnly>

      {/* Element inspector banner */}
      {props.selectedElement && (
        <div className="flex mx-2 mt-2 gap-2 items-center justify-between rounded-lg border border-palmkit-elements-borderColor text-palmkit-elements-textPrimary py-1 px-2.5 text-xs">
          <div className="flex gap-2 items-center lowercase">
            <code className="bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text rounded px-1.5 py-0.5 mr-0.5 text-[10px] font-bold">
              {props?.selectedElement?.tagName}
            </code>
            <span className="text-palmkit-elements-textSecondary">selected for inspection</span>
          </div>
          <button
            className="text-palmkit-elements-button-primary-text text-xs font-medium hover:underline"
            onClick={() => props.setSelectedElement?.(null)}
          >
            Clear
          </button>
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={props.textareaRef}
        className={classNames(
          'w-full px-4 pt-3.5 pb-1 outline-none resize-none',
          'text-palmkit-elements-textPrimary placeholder-palmkit-elements-textTertiary',
          'bg-transparent text-sm sm:text-[16px] leading-relaxed',
        )}
        onMouseDown={(e) => {
          if (!ensureSignedIn()) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onFocus={(e) => {
          if (!ensureSignedIn()) {
            e.currentTarget.blur();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();

          const files = Array.from(e.dataTransfer.files);
          files.forEach((file) => {
            if (file.type.startsWith('image/')) {
              const reader = new FileReader();

              reader.onload = (ev) => {
                const base64Image = ev.target?.result as string;
                props.setUploadedFiles?.([...props.uploadedFiles, file]);
                props.setImageDataList?.([...props.imageDataList, base64Image]);
              };
              reader.readAsDataURL(file);
            }
          });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            if (event.shiftKey) {
              return;
            }

            event.preventDefault();

            if (props.isStreaming) {
              props.handleStop?.();
              return;
            }

            if (event.nativeEvent.isComposing) {
              return;
            }

            props.handleSendMessage?.(event);
          }
        }}
        value={props.input}
        onChange={(event) => {
          if (!ensureSignedIn()) {
            return;
          }

          props.handleInputChange?.(event);
        }}
        onPaste={props.handlePaste}
        style={{
          minHeight: props.TEXTAREA_MIN_HEIGHT,
          maxHeight: props.TEXTAREA_MAX_HEIGHT,
        }}
        placeholder={props.chatMode === 'build' ? 'What do you want to build?' : 'Ask anything…'}
        translate="no"
      />

      {/* In-box toolbar (v3 — one clean row).
          Left: model chip · thinking meter · "+" menu (attach, connectors,
          skills/agents/workflows/libraries/projects, starter stack) · enhance.
          Right: mic · send. The Chat/Code intent moved to the sidebar. */}
      <div className="bolt-toolbar-fade flex items-center gap-1 px-2 pb-2 pt-1">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto bolt-toolbar-scroll">
          {/* Model chip — pill that opens the model/key sheet */}
          <button
            type="button"
            title="Model settings"
            onClick={() => props.setIsModelSettingsCollapsed(!props.isModelSettingsCollapsed)}
            disabled={!props.providerList || props.providerList.length === 0}
            className={classNames(
              'shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-full transition-all duration-150 border',
              props.isModelSettingsCollapsed
                ? 'border-palmkit-elements-borderColor text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:border-[var(--pk-glass-border-hi)]'
                : 'border-[var(--pk-accent)] text-[var(--pk-accent)] bg-[var(--pk-accent-dim)]',
            )}
          >
            <span className="text-[11px] font-medium max-w-[110px] truncate">
              {(props.model || 'Model').split('/').pop()}
            </span>
            <div className={`i-ph:caret-${props.isModelSettingsCollapsed ? 'down' : 'up'} text-[11px]`} />
          </button>

          {/* Thinking — Fast / Balanced / Deep, resolved against what the
              selected model can actually be asked to do. */}
          <ClientOnly>{() => <ThinkingMeter provider={props.provider?.name} model={props.model} />}</ClientOnly>

          {/*
           * Design theme — palette icon directly in the toolbar (before "+"),
           * so the most-used design control is one tap away on both mobile and
           * desktop. "+" stays the last icon (the catch-all for everything
           * else: attach, connectors, skills, templates).
           */}
          <ColorSchemeDialog designScheme={props.designScheme} setDesignScheme={props.setDesignScheme} />

          {/* "+" — attach, connectors, product surfaces, starter stack */}
          <PlusMenu
            onAttach={props.handleFileUpload}
            tools={
              <>
                <ClientOnly>
                  {() => (
                    <WebSearch
                      onSearchResult={props.onWebSearchResult ?? ((_r: string) => undefined)}
                      disabled={props.isStreaming}
                    />
                  )}
                </ClientOnly>
                <McpTools />
                <SupabaseConnection />
              </>
            }
          />
        </div>

        {/* Right: mic + send (always visible, never scrolls) */}
        <div className="flex items-center gap-1 shrink-0 pl-1">
          <ClientOnly>
            {() => (
              <SpeechRecognitionButton
                isListening={props.isListening}
                onStart={props.startListening}
                onStop={props.stopListening}
                disabled={props.isStreaming}
              />
            )}
          </ClientOnly>

          <ClientOnly>
            {() => (
              <SendStopButton
                isStreaming={props.isStreaming}
                canSend={canSend}
                disabled={!props.providerList || props.providerList.length === 0}
                onClick={onSendClick}
              />
            )}
          </ClientOnly>
        </div>
      </div>

      <ExpoQrModal open={props.qrModalOpen} onClose={() => props.setQrModalOpen(false)} />
    </div>
  );
};
