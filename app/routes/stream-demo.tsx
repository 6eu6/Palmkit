/**
 * Stream Demo Page — `/stream-demo`
 *
 * Live preview of the new stream architecture. Mounts the StreamContainer
 * with a useStreamChat hook wired to a text input. Used for:
 *   - Manual QA during development
 *   - Screenshot capture for documentation
 *   - A/B comparison with the old /chat flow
 *
 * The page is intentionally minimal — no sidebar, no workbench, no
 * settings. Just the chat thread + activity panel + status bar + input.
 *
 * Remove this route once the new stream is promoted to /chat.
 */

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useStreamChat } from '~/lib/stream/use-stream-chat';
import { StreamContainer } from '~/components/chat/stream/StreamContainer';
import { StreamIcon } from '~/components/icons/stream/StreamIcon';

export default function StreamDemoPage() {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, stop, isStreaming, mode } = useStreamChat({
    onStreamEnd: (reason) => {
      console.log('[demo] stream ended:', reason);
    },
  });

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (!inputRef.current) {
      return;
    }

    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
  }, [input]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const text = input.trim();

    if (!text || isStreaming) {
      return;
    }

    setInput('');
    void sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-palmkit-elements-background-depth-1">
      {/* Top bar — minimal */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-palmkit-elements-borderColor">
        <div className="flex items-center gap-2">
          <StreamIcon name="ph:sparkle-duotone" size={18} className="text-palmkit-elements-textPrimary" />
          <h1 className="text-sm font-medium text-palmkit-elements-textPrimary">Stream Demo</h1>
          {mode && (
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-palmkit-elements-background-depth-3 text-palmkit-elements-textSecondary uppercase tracking-wider">
              {mode}
            </span>
          )}
        </div>
        <a
          href="/"
          className="text-xs text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
        >
          Back to app
        </a>
      </header>

      {/* Main — stream container fills available space */}
      <main className="flex-1 min-h-0">
        <StreamContainer />
      </main>

      {/* Input — fixed bottom */}
      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 p-4 border-t border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Streaming response...' : 'Ask anything or describe what to build'}
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none rounded-lg bg-palmkit-elements-background-depth-2 border border-palmkit-elements-borderColor px-4 py-3 text-sm text-palmkit-elements-textPrimary placeholder:text-palmkit-elements-textTertiary focus:outline-none focus:border-palmkit-elements-button-primary-background disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            className="shrink-0 flex items-center gap-1.5 px-4 py-3 rounded-lg bg-palmkit-elements-button-danger-background text-palmkit-elements-button-danger-text hover:bg-palmkit-elements-button-danger-backgroundHover transition-colors text-sm font-medium"
          >
            <StreamIcon name="ph:stop-duotone" size={14} />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="shrink-0 flex items-center gap-1.5 px-4 py-3 rounded-lg bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text hover:bg-palmkit-elements-button-primary-backgroundHover transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <StreamIcon name="ph:sparkle-duotone" size={14} />
            Send
          </button>
        )}
      </form>
    </div>
  );
}
