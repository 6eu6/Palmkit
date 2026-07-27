/**
 * OpenInChat — Share / open conversation button
 * ==============================================
 *
 * A button that allows sharing or opening a conversation in a new
 * chat session. Useful for forking or exporting conversations.
 *
 * <OpenInChat
 *   url="https://palmkit.app/chat/abc123"
 *   label="Open in new chat"
 * />
 *
 * Monochrome: textSecondary icon + text. Hover → textPrimary.
 */

import { memo } from 'react';
import { classNames } from '~/utils/classNames';

interface OpenInChatProps {
  url?: string;
  label?: string;
  onClick?: () => void;
  className?: string;
}

function OpenInChatImpl({ url, label = 'Open in chat', onClick, className }: OpenInChatProps) {
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (url) {
      window.open(url, '_blank');
    }
  };

  return (
    <button
      onClick={handleClick}
      title={label}
      className={classNames(
        'flex items-center gap-1 px-2 py-1 rounded text-[11px] text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary hover:bg-palmkit-elements-background-depth-2 transition-colors',
        className,
      )}
    >
      <div className="i-ph:arrow-square-out text-sm" />
      <span>{label}</span>
    </button>
  );
}

export const OpenInChat = memo(OpenInChatImpl);
