/**
 * Message — Composable chat message primitives
 * =============================================
 *
 * Composable chat message with markdown responses, attachments,
 * branching, and action slots.
 *
 * <Message role="assistant">
 *   <Message.Content>
 *     Markdown content here…
 *   </Message.Content>
 *   <Message.Actions>
 *     <Context usage={...} />
 *   </Message.Actions>
 * </Message>
 *
 * Monochrome: user messages have a subtle background tint,
 * assistant messages are plain. Icons: i-ph:user / i-ph:bot for avatars.
 */

import { memo, type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';
import { Markdown } from '~/components/chat/Markdown';

interface MessageProps {
  role: 'user' | 'assistant';
  children: ReactNode;
  isStreaming?: boolean;
  className?: string;
}

function MessageImpl({ role, children, isStreaming: _isStreaming = false, className }: MessageProps) {
  const isUser = role === 'user';

  return (
    <div className={classNames('flex gap-3 py-3 ai-fade-in', isUser && 'flex-row-reverse', className)}>
      {/* Avatar */}
      <div
        className={classNames(
          'shrink-0 w-7 h-7 rounded-full flex items-center justify-center border border-palmkit-elements-borderColor',
          isUser ? 'bg-palmkit-elements-background-depth-2' : 'bg-palmkit-elements-background-depth-1',
        )}
      >
        <div className={classNames('text-sm text-palmkit-elements-textSecondary', isUser ? 'i-ph:user' : 'i-ph:bot')} />
      </div>

      {/* Content */}
      <div className={classNames('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>{children}</div>
    </div>
  );
}

// ─── Content sub-component ──────────────────────────────────────

interface MessageContentProps {
  children: ReactNode;
  className?: string;
}

function MessageContentImpl({ children, className }: MessageContentProps) {
  // If children is a string, render as markdown
  if (typeof children === 'string') {
    return (
      <div className={classNames('prose prose-sm max-w-none', className)}>
        <Markdown html>{children}</Markdown>
      </div>
    );
  }

  return <div className={classNames('text-sm text-palmkit-elements-textPrimary', className)}>{children}</div>;
}

// ─── Actions sub-component ──────────────────────────────────────

function MessageActionsImpl({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={classNames('flex items-center gap-2 mt-2', className)}>{children}</div>;
}

// ─── Export compound ────────────────────────────────────────────

export const Message = Object.assign(memo(MessageImpl), {
  Content: memo(MessageContentImpl),
  Actions: memo(MessageActionsImpl),
});
