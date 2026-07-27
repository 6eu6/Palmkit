/**
 * Conversation — Message list wrapper with auto-scroll
 * =====================================================
 *
 * Wraps messages and automatically scrolls to the bottom.
 * Includes a scroll button that appears when not at the bottom.
 *
 * <Conversation>
 *   {messages.map(msg => <Message key={msg.id} {...msg} />)}
 * </Conversation>
 *
 * Monochrome: scroll button uses background-depth-2 + textSecondary.
 * Icon: i-ph:arrow-down for scroll-to-bottom button.
 */

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { classNames } from '~/utils/classNames';

interface ConversationProps {
  children: ReactNode;
  className?: string;
}

function ConversationImpl({ children, className }: ConversationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

    if (isAtBottom) {
      container.scrollTop = scrollHeight;
    }
  }, [children]);

  // Show/hide scroll button based on scroll position
  const handleScroll = () => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShowScrollButton(!isAtBottom);
  };

  const scrollToBottom = () => {
    const container = containerRef.current;

    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  };

  return (
    <div className={classNames('relative', className)}>
      <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto modern-scrollbar">
        {children}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-3 transition-colors flex items-center justify-center shadow-md ai-fade-in"
          title="Scroll to bottom"
        >
          <div className="i-ph:arrow-down text-sm" />
        </button>
      )}
    </div>
  );
}

export const Conversation = memo(ConversationImpl);
