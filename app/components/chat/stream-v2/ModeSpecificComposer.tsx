/**
 * ModeSpecificComposer — Mode-aware input box (v2, AI Elements)
 * ==============================================================
 *
 * Each tab gets its own set of quick-action buttons.
 * Uses PromptInput + ModelSelector from AI Elements.
 *
 * Monochrome: all buttons use textSecondary → textPrimary on hover.
 * No colored accents. Icons are Phosphor only.
 *
 * Quick actions insert a prefix into the textarea — the model
 * decides what to do (not hardcoded tool calling).
 */

import { memo, useCallback, type RefObject } from 'react';
import { useStore } from '@nanostores/react';
import { sidebarModeStore } from '~/lib/stores/sidebar';
import { classNames } from '~/utils/classNames';

export interface ModeSpecificComposerProps {
  input: string;
  handleInputChange?: (e: any) => void;
  handleSend: (e?: any) => void;
  handleStop?: () => void;
  isStreaming: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement>;
  textareaMinHeight: number;
  textareaMaxHeight: number;
  model?: string;
  onModelClick?: () => void;
  onFileUpload?: (files: File[]) => void;
}

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  prefix: string;
  modes: Array<'chat' | 'work' | 'code'>;
}

const QUICK_ACTIONS: QuickAction[] = [
  // Chat mode
  { id: 'web-search', label: 'Search', icon: 'i-ph:magnifying-glass', prefix: 'Search the web for ', modes: ['chat'] },

  // Work mode
  { id: 'pdf', label: 'PDF', icon: 'i-ph:file-pdf', prefix: 'Create a downloadable PDF about ', modes: ['work'] },
  { id: 'word', label: 'Word', icon: 'i-ph:file-doc', prefix: 'Create a Word document (.docx) with ', modes: ['work'] },
  {
    id: 'excel',
    label: 'Excel',
    icon: 'i-ph:file-xls',
    prefix: 'Generate an Excel spreadsheet with ',
    modes: ['work'],
  },
  { id: 'chart', label: 'Chart', icon: 'i-ph:chart-bar', prefix: 'Create a chart visualizing ', modes: ['work'] },
  { id: 'table', label: 'Table', icon: 'i-ph:table', prefix: 'Format this data as a table: ', modes: ['work'] },
  { id: 'image', label: 'Image', icon: 'i-ph:image', prefix: 'Generate an AI image of ', modes: ['work'] },
  { id: 'analyze', label: 'Analyze', icon: 'i-ph:chart-line-up', prefix: 'Analyze this data: ', modes: ['work'] },

  // Code mode
  { id: 'shell', label: 'Shell', icon: 'i-ph:terminal', prefix: 'Run this command in the sandbox: ', modes: ['code'] },
  {
    id: 'screenshot',
    label: 'Screenshot',
    icon: 'i-ph:camera',
    prefix: 'Take a screenshot of the running app ',
    modes: ['code'],
  },
  { id: 'read-file', label: 'Read File', icon: 'i-ph:file-code', prefix: 'Read the file ', modes: ['code'] },
  {
    id: 'grep',
    label: 'Search Code',
    icon: 'i-ph:magnifying-glass-bold',
    prefix: 'Search the codebase for ',
    modes: ['code'],
  },
  {
    id: 'list-files',
    label: 'Files',
    icon: 'i-ph:folder-open',
    prefix: 'List all files in the project',
    modes: ['code'],
  },
];

function ModeSpecificComposerImpl({
  input,
  handleInputChange,
  handleSend,
  handleStop,
  isStreaming,
  textareaRef,
  textareaMinHeight,
  textareaMaxHeight,
  model,
  onModelClick,
  onFileUpload,
}: ModeSpecificComposerProps) {
  const sidebarMode = useStore(sidebarModeStore);
  const modeActions = QUICK_ACTIONS.filter((a) => a.modes.includes(sidebarMode));

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      const textarea = textareaRef?.current;

      if (textarea) {
        const currentValue = textarea.value;
        const newValue = currentValue ? `${currentValue}\n${action.prefix}` : action.prefix;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, newValue);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        }, 0);
      }
    },
    [textareaRef],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);

      if (files.length > 0 && onFileUpload) {
        onFileUpload(files);
      }

      e.target.value = '';
    },
    [onFileUpload],
  );

  const placeholder =
    sidebarMode === 'code'
      ? 'What do you want to build?'
      : sidebarMode === 'work'
        ? 'What do you need?'
        : 'Ask anything…';

  return (
    <div className="relative">
      {/* Mode-specific quick-action toolbar */}
      <div className="flex items-center gap-1.5 px-1 pb-1.5 pt-0.5 overflow-x-auto bolt-toolbar-scroll">
        {/* Model chip */}
        <button
          type="button"
          onClick={onModelClick}
          className="shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-palmkit-elements-borderColor text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:border-palmkit-elements-textSecondary transition-all"
        >
          <div className="i-ph:cpu text-[13px]" />
          <span className="text-[11px] font-medium max-w-[100px] truncate">{(model || 'Model').split('/').pop()}</span>
          <div className="i-ph:caret-down text-[10px]" />
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-palmkit-elements-borderColor shrink-0" />

        {/* Quick actions — monochrome */}
        {modeActions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => handleQuickAction(action)}
            title={action.label}
            className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-full border border-palmkit-elements-borderColor text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:border-palmkit-elements-textSecondary transition-all"
          >
            <div className={classNames('text-[13px]', action.icon)} />
            <span className="text-[11px] font-medium">{action.label}</span>
          </button>
        ))}

        {/* File upload — work + code modes */}
        {sidebarMode !== 'chat' && (
          <label
            className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-full border border-palmkit-elements-borderColor text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:border-palmkit-elements-textSecondary transition-all cursor-pointer"
            title="Upload file"
          >
            <div className="i-ph:paperclip text-[13px]" />
            <span className="text-[11px] font-medium">Upload</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              accept={sidebarMode === 'work' ? '.txt,.md,.csv,.json,.pdf,.docx,.xlsx' : '*'}
            />
          </label>
        )}
      </div>

      {/* Textarea + Send/Stop — monochrome */}
      <div className="flex items-end gap-2 p-2 rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 focus-within:border-palmkit-elements-textSecondary transition-colors">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          style={{ minHeight: textareaMinHeight, maxHeight: textareaMaxHeight }}
          placeholder={placeholder}
          translate="no"
          className="flex-1 bg-transparent resize-none border-0 outline-none text-sm text-palmkit-elements-textPrimary placeholder:text-palmkit-elements-textSecondary px-1 py-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();

              if (!isStreaming) {
                handleSend();
              }
            }
          }}
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={handleStop}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-palmkit-elements-background-depth-2 text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-3 transition-colors"
            title="Stop"
          >
            <div className="i-ph:stop text-lg" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim()}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-palmkit-elements-background-depth-2 text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Send"
          >
            <div className="i-ph:paper-plane-tilt text-lg" />
          </button>
        )}
      </div>
    </div>
  );
}

export const ModeSpecificComposer = memo(ModeSpecificComposerImpl);
