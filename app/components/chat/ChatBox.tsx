import React from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { ensureSignedIn } from '~/lib/stores/auth';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { APIKeyManager } from './APIKeyManager';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import FilePreview from './FilePreview';
import { ScreenshotStateManager } from './ScreenshotStateManager';
import { toast } from 'react-toastify';
import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import { SupabaseConnection } from './SupabaseConnection';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import type { ProviderInfo } from '~/types/model';
import { ColorSchemeDialog } from '~/components/ui/ColorSchemeDialog';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import { McpTools } from './MCPTools';
import { WebSearch } from './WebSearch.client';

interface ChatBoxProps {
  isModelSettingsCollapsed: boolean;
  setIsModelSettingsCollapsed: (collapsed: boolean) => void;
  provider: any;
  providerList: any[];
  modelList: any[];
  apiKeys: Record<string, string>;
  isModelLoading: string | undefined;
  onApiKeysChange: (providerName: string, apiKey: string) => void;
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
  enhancingPrompt?: boolean | undefined;
  enhancePrompt?: (() => void) | undefined;
  onWebSearchResult?: (result: string) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: ((element: ElementInfo | null) => void) | undefined;
}

/* A single ghost icon button used across the in-box toolbar. */
function ToolButton({
  icon,
  title,
  onClick,
  disabled,
  loading,
  active,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 active:scale-90',
        active
          ? 'bg-palmkit-elements-item-backgroundActive text-palmkit-elements-textPrimary'
          : 'text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
      )}
    >
      {loading ? (
        <div className="i-svg-spinners:90-ring-with-bg text-[18px]" />
      ) : (
        <div className={`${icon} text-[18px]`} />
      )}
    </button>
  );
}

/* Prominent send / stop button that lives inside the box (reference-style). */
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
        'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 active:scale-95',
        'disabled:opacity-30 disabled:cursor-not-allowed',
      )}
      style={{
        background: isStreaming ? 'rgba(239, 68, 68, 0.92)' : 'var(--palmkit-elements-textPrimary)',
      }}
    >
      <div className="text-palmkit-elements-bg-depth-1 text-base">
        {isStreaming ? <div className="i-ph:stop-bold" /> : <div className="i-ph:arrow-up-bold" />}
      </div>
    </button>
  );
}

/* ---------- Main ChatBox ---------- */
export const ChatBox: React.FC<ChatBoxProps> = (props) => {
  const canSend = props.input.length > 0 || props.uploadedFiles.length > 0;

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
        'focus-within:border-palmkit-elements-borderColorActive',
        'focus-within:shadow-[0_0_0_1px_var(--palmkit-elements-borderColorActive)]',
      )}
    >
      {/* Collapsible model settings (provider + model + API key) */}
      <ClientOnly>
        {() => (
          <div
            className={classNames(
              'overflow-hidden transition-all',
              props.isModelSettingsCollapsed ? 'max-h-0' : 'max-h-[420px]',
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
                apiKeys={props.apiKeys}
                modelLoading={props.isModelLoading}
              />
              {(props.providerList || []).length > 0 &&
                props.provider &&
                !LOCAL_PROVIDERS.includes(props.provider.name) && (
                  <APIKeyManager
                    provider={props.provider}
                    apiKey={props.apiKeys[props.provider.name] || ''}
                    setApiKey={(key) => {
                      props.onApiKeysChange(props.provider.name, key);
                    }}
                  />
                )}
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

      {/* In-box toolbar — every action lives here, no popups.
          ALL buttons are visible on ALL screen sizes. On narrow screens
          (mobile), the left toolbar scrolls horizontally — the standard
          mobile pattern used by messaging apps (Telegram, WhatsApp, etc.). */}
      <div className="bolt-toolbar-fade flex items-center gap-1 px-2 pb-2 pt-1">
        {/* Left: model chip + tools (scrolls horizontally on small screens) */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto bolt-toolbar-scroll">
          {/* Model chip — toggles the settings panel */}
          <button
            type="button"
            title="Model settings"
            onClick={() => props.setIsModelSettingsCollapsed(!props.isModelSettingsCollapsed)}
            disabled={!props.providerList || props.providerList.length === 0}
            className={classNames(
              'shrink-0 flex items-center gap-1 h-8 pl-1.5 pr-2 rounded-lg transition-all duration-150',
              'text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
            )}
          >
            <div className={`i-ph:caret-${props.isModelSettingsCollapsed ? 'right' : 'down'} text-[12px]`} />
            <span className="text-[11px] font-medium max-w-[110px] truncate">{props.model || 'Model'}</span>
          </button>

          <div className="shrink-0 w-px h-5 mx-0.5 bg-palmkit-elements-borderColor" />

          {/* ALL tools — visible on every screen size, scroll horizontally on mobile */}
          <ToolButton icon="i-ph:paperclip" title="Attach image" onClick={props.handleFileUpload} />

          <ToolButton
            icon="i-palmkit:stars"
            title="Enhance prompt"
            onClick={() => {
              props.enhancePrompt?.();
              toast.success('Prompt enhanced!');
            }}
            disabled={props.input.length === 0 || props.enhancingPrompt}
            loading={props.enhancingPrompt}
          />

          {/* Self-contained dialog / action triggers */}
          <ClientOnly>
            {() => (
              <WebSearch
                onSearchResult={props.onWebSearchResult ?? ((_r: string) => undefined)}
                disabled={props.isStreaming}
              />
            )}
          </ClientOnly>
          <ColorSchemeDialog designScheme={props.designScheme} setDesignScheme={props.setDesignScheme} />
          <McpTools />
          <SupabaseConnection />
        </div>

        {/* Right: mode toggle + mic + send (always visible, never scrolls) */}
        <div className="flex items-center gap-1 shrink-0 pl-1">
          {props.chatStarted && (
            <button
              type="button"
              title="Toggle build / discuss"
              className={classNames(
                'shrink-0 h-8 px-2.5 rounded-lg text-[11px] font-medium transition-all duration-150',
                props.chatMode === 'build'
                  ? 'bg-palmkit-elements-item-backgroundActive text-palmkit-elements-textPrimary'
                  : 'text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
              )}
              onClick={() => props.setChatMode?.(props.chatMode === 'discuss' ? 'build' : 'discuss')}
            >
              {props.chatMode === 'discuss' ? 'Discuss' : 'Build'}
            </button>
          )}

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

      {/* Mobile keyboard hint */}
      {props.input.length > 1 && (
        <div className="flex sm:hidden items-center justify-end px-3 pb-1.5">
          <div className="text-[10px] text-palmkit-elements-textTertiary">
            <kbd className="px-1 py-0.5 rounded bg-palmkit-elements-bg-depth-2 text-[10px]">Enter</kbd> send{' '}
            <kbd className="px-1 py-0.5 rounded bg-palmkit-elements-bg-depth-2 text-[10px]">Shift+Enter</kbd> new line
          </div>
        </div>
      )}

      <ExpoQrModal open={props.qrModalOpen} onClose={() => props.setQrModalOpen(false)} />
    </div>
  );
};
