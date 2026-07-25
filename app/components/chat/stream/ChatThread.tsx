/**
 * ChatThread — displays only message:* events (user + assistant text).
 *
 * This is the "clean" chat surface — no activity noise, no diagnostic
 * events. Just the conversational back-and-forth.
 *
 * Activity (tool calls, build progress) is rendered by <ActivityPanel />
 * in a collapsible side panel, keeping the chat thread readable.
 */

import { memo, useEffect, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { chatMessagesStore } from '~/lib/stream/stores';
import { classNames } from '~/utils/classNames';
import { Markdown } from '~/components/chat/Markdown';

function ChatThreadImpl() {
  const messages = useStore(chatMessagesStore);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message / delta
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  return (
    <div
      className="flex flex-col gap-6 px-4 py-6 overflow-y-auto h-full"
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
    >
      {messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-palmkit-elements-textSecondary text-sm">
          No messages yet. Start a conversation.
        </div>
      )}

      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}

interface MessageBubbleProps {
  message: ReturnType<typeof chatMessagesStore.get>[number];
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isStreaming = !message.endedAt;

  return (
    <div className={classNames('flex gap-3 max-w-full', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div
        className={classNames(
          'w-8 h-8 rounded-md flex items-center justify-center shrink-0 text-xs font-medium',
          isUser
            ? 'bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text'
            : 'bg-palmkit-elements-background-depth-3 text-palmkit-elements-textPrimary',
        )}
        aria-hidden="true"
      >
        {isUser ? 'U' : 'P'}
      </div>

      {/* Bubble */}
      <div
        className={classNames(
          'flex-1 min-w-0 rounded-lg px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text ml-auto max-w-[80%]'
            : 'bg-palmkit-elements-background-depth-2 text-palmkit-elements-textPrimary max-w-[90%]',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none break-words">
            <Markdown>{message.text}</Markdown>
            {isStreaming && (
              <span
                className="inline-block w-1.5 h-4 ml-1 bg-palmkit-elements-textPrimary align-middle animate-pulse"
                aria-label="streaming"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatThread = memo(ChatThreadImpl);
