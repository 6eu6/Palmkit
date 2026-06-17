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
import { SendButton } from './SendButton.client';
import { IconButton } from '~/components/ui/IconButton';
import { toast } from 'react-toastify';
import { SpeechRecognitionButton } from '~/components/chat/SpeechRecognition';
import { SupabaseConnection } from './SupabaseConnection';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import styles from './BaseChat.module.scss';
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

export const ChatBox: React.FC<ChatBoxProps> = (props) => {
  return (
    <div
      className={classNames(
        'relative w-full max-w-chat mx-auto z-prompt',
        'rounded-2xl',
        'bg-palmkit-elements-prompt-background',
        'border border-palmkit-elements-borderColor',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]',
        'transition-shadow duration-200',
        'focus-within:shadow-[0_0_0_1px_var(--palmkit-elements-borderColorActive)]',
        'focus-within:border-palmkit-elements-borderColorActive',
      )}
    >
      {/* Animated border effect - subtle monochrome shimmer */}
      <svg className={classNames(styles.PromptEffectContainer)}>
        <defs>
          <linearGradient
            id="line-gradient"
            x1="20%"
            y1="0%"
            x2="-14%"
            y2="10%"
            gradientUnits="userSpaceOnUse"
            gradientTransform="rotate(-45)"
          >
            <stop offset="0%" stopColor="var(--palmkit-gradient-start)" stopOpacity="0%"></stop>
            <stop offset="40%" stopColor="var(--palmkit-gradient-mid)" stopOpacity="40%"></stop>
            <stop offset="50%" stopColor="var(--palmkit-gradient-end)" stopOpacity="40%"></stop>
            <stop offset="100%" stopColor="var(--palmkit-gradient-start)" stopOpacity="0%"></stop>
          </linearGradient>
          <linearGradient id="shine-gradient">
            <stop offset="0%" stopColor="white" stopOpacity="0%"></stop>
            <stop offset="40%" stopColor="#ffffff" stopOpacity="60%"></stop>
            <stop offset="50%" stopColor="#ffffff" stopOpacity="60%"></stop>
            <stop offset="100%" stopColor="white" stopOpacity="0%"></stop>
          </linearGradient>
        </defs>
        <rect className={classNames(styles.PromptEffectLine)} pathLength="100" strokeLinecap="round"></rect>
        <rect className={classNames(styles.PromptShine)} x="48" y="24" width="70" height="1"></rect>
      </svg>

      {/* Model settings - collapsible section */}
      <div>
        <ClientOnly>
          {() => (
            <div className={props.isModelSettingsCollapsed ? 'hidden' : ''}>
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
          )}
        </ClientOnly>
      </div>

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
        <div className="flex mx-2 mt-1 gap-2 items-center justify-between rounded-lg border border-palmkit-elements-borderColor text-palmkit-elements-textPrimary py-1 px-2.5 text-xs">
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

      {/* Main input area — Mistral-inspired clean design */}
      <div className="relative">
        <textarea
          ref={props.textareaRef}
          className={classNames(
            'w-full pl-4 pr-12 pt-3.5 pb-1 outline-none resize-none',
            'text-palmkit-elements-textPrimary placeholder-palmkit-elements-textTertiary',
            'bg-transparent text-sm leading-relaxed',
            'transition-colors duration-150',
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

                reader.onload = (e) => {
                  const base64Image = e.target?.result as string;
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
          placeholder={props.chatMode === 'build' ? 'What do you want to build?' : 'Ask anything...'}
          translate="no"
        />

        {/* Send / Stop button — positioned inside textarea */}
        <ClientOnly>
          {() => (
            <SendButton
              show={props.input.length > 0 || props.isStreaming || props.uploadedFiles.length > 0}
              isStreaming={props.isStreaming}
              disabled={!props.providerList || props.providerList.length === 0}
              onClick={(event) => {
                if (props.isStreaming) {
                  props.handleStop?.();
                  return;
                }

                if (props.input.length > 0 || props.uploadedFiles.length > 0) {
                  props.handleSendMessage?.(event);
                }
              }}
            />
          )}
        </ClientOnly>
      </div>

      {/* Action toolbar — Mistral-style bottom bar */}
      <div className="flex items-center justify-between px-2 pb-2 pt-0">
        {/* Left: attachment and tool actions */}
        <div className="flex items-center gap-0.5">
          <IconButton
            title="Attach file"
            className="!p-1.5 rounded-lg text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive transition-all duration-150"
            onClick={() => props.handleFileUpload()}
          >
            <div className="i-ph:paperclip text-[18px]"></div>
          </IconButton>

          <WebSearch onSearchResult={(result) => props.onWebSearchResult?.(result)} disabled={props.isStreaming} />

          <IconButton
            title="Enhance prompt"
            disabled={props.input.length === 0 || props.enhancingPrompt}
            className={classNames(
              '!p-1.5 rounded-lg transition-all duration-150',
              props.enhancingPrompt
                ? 'text-palmkit-elements-textTertiary'
                : 'text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
            )}
            onClick={() => {
              props.enhancePrompt?.();
              toast.success('Prompt enhanced!');
            }}
          >
            {props.enhancingPrompt ? (
              <div className="i-svg-spinners:90-ring-with-bg text-palmkit-elements-loader-progress text-[18px] animate-spin"></div>
            ) : (
              <div className="i-palmkit:stars text-[18px]"></div>
            )}
          </IconButton>

          <SpeechRecognitionButton
            isListening={props.isListening}
            onStart={props.startListening}
            onStop={props.stopListening}
            disabled={props.isStreaming}
          />

          {/* Mode toggle */}
          {props.chatStarted && (
            <IconButton
              title={props.chatMode === 'discuss' ? 'Switch to Build mode' : 'Switch to Discuss mode'}
              className={classNames(
                '!p-1.5 rounded-lg transition-all duration-150',
                props.chatMode === 'discuss'
                  ? '!text-palmkit-elements-textPrimary !bg-palmkit-elements-item-backgroundActive'
                  : 'text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive',
              )}
              onClick={() => {
                props.setChatMode?.(props.chatMode === 'discuss' ? 'build' : 'discuss');
              }}
            >
              <div className={`i-ph:chats text-[18px]`} />
            </IconButton>
          )}

          <div className="flex items-center gap-0.5">
            <ColorSchemeDialog designScheme={props.designScheme} setDesignScheme={props.setDesignScheme} />
            <McpTools />
          </div>
        </div>

        {/* Right: model indicator + supabase */}
        <div className="flex items-center gap-0.5">
          <SupabaseConnection />
          <IconButton
            title="Model Settings"
            className={classNames(
              '!p-1.5 rounded-lg transition-all duration-150 flex items-center gap-1',
              props.isModelSettingsCollapsed
                ? 'text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-item-backgroundActive'
                : 'text-palmkit-elements-textPrimary bg-palmkit-elements-item-backgroundActive',
            )}
            onClick={() => props.setIsModelSettingsCollapsed(!props.isModelSettingsCollapsed)}
            disabled={!props.providerList || props.providerList.length === 0}
          >
            <div className={`i-ph:caret-${props.isModelSettingsCollapsed ? 'right' : 'down'} text-[14px]`} />
            {props.isModelSettingsCollapsed ? (
              <span className="text-[11px] font-medium max-w-[60px] sm:max-w-[80px] truncate text-palmkit-elements-textTertiary">
                {props.model}
              </span>
            ) : (
              <span />
            )}
          </IconButton>
        </div>
      </div>

      {/* Mobile keyboard hint */}
      {props.input.length > 1 && (
        <div className="flex sm:hidden items-center justify-end px-3 pb-2">
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
