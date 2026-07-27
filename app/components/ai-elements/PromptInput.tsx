/**
 * PromptInput — Message input with attachments
 * =============================================
 *
 * The Prompt Input component allows a user to send a message with
 * file attachments to a large language model. It includes a textarea,
 * file upload capabilities, and a submit button.
 *
 * <PromptInput
 *   value={text}
 *   onChange={setText}
 *   onSubmit={handleSend}
 *   isStreaming={false}
 *   onStop={handleStop}
 *   onFileUpload={handleFiles}
 *   placeholder="Ask anything…"
 * />
 *
 * Monochrome: border + background-depth-1. Submit button uses
 * textPrimary when enabled, textSecondary when disabled.
 * Icons: i-ph:paper-plane-tilt for send, i-ph:stop for stop,
 * i-ph:paperclip for attach.
 */

import { memo, useRef, type KeyboardEvent } from 'react';
import { classNames } from '~/utils/classNames';

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isStreaming?: boolean;
  onStop?: () => void;
  onFileUpload?: (files: File[]) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
}

function PromptInputImpl({
  value,
  onChange,
  onSubmit,
  isStreaming = false,
  onStop,
  onFileUpload,
  placeholder = 'Ask anything…',
  minHeight = 44,
  maxHeight = 200,
  className,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      if (!isStreaming && value.trim()) {
        onSubmit();
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);

    if (files.length > 0 && onFileUpload) {
      onFileUpload(files);
    }

    e.target.value = '';
  };

  return (
    <div
      className={classNames(
        'flex items-end gap-2 p-2 rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 focus-within:border-palmkit-elements-textSecondary transition-colors',
        className,
      )}
    >
      {/* File upload button */}
      {onFileUpload && (
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach files"
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-2 transition-colors"
        >
          <div className="i-ph:paperclip text-lg" />
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        </button>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ minHeight, maxHeight }}
        className="flex-1 bg-transparent resize-none border-0 outline-none text-sm text-palmkit-elements-textPrimary placeholder:text-palmkit-elements-textSecondary px-1 py-1"
        translate="no"
      />

      {/* Send / Stop button */}
      {isStreaming ? (
        <button
          onClick={onStop}
          title="Stop"
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-palmkit-elements-background-depth-2 text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-3 transition-colors"
        >
          <div className="i-ph:stop text-lg" />
        </button>
      ) : (
        <button
          onClick={onSubmit}
          disabled={!value.trim()}
          title="Send"
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-palmkit-elements-background-depth-2 text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-3 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="i-ph:paper-plane-tilt text-lg" />
        </button>
      )}
    </div>
  );
}

export const PromptInput = memo(PromptInputImpl);
