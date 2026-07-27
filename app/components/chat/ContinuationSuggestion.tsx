/**
 * ContinuationSuggestion — the one-click "next step" chip shown when a chat was
 * opened via "Continue in a fresh chat".
 *
 * The server (/api/fork-chat) proposes a concrete next step; it's stored in the
 * chat's metadata. This renders it as a clickable chip: pressing it sends the
 * suggestion as the user's message. Free-form input stays fully available — the
 * user chooses. The chip clears itself once used or dismissed so it never nags.
 */
import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { chatMetadata, chatId, db } from '~/lib/persistence/useChatHistory';
import { updateChatMetadata } from '~/lib/persistence/db';

export function ContinuationSuggestion({
  sendMessage,
}: {
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
}) {
  const meta = useStore(chatMetadata);
  const [hidden, setHidden] = useState(false);

  const suggestion = meta?.continuationSuggestion;

  if (!suggestion || hidden) {
    return null;
  }

  const clear = async () => {
    setHidden(true);

    const id = chatId.get();

    if (db && id && meta) {
      try {
        const { continuationSuggestion: _drop, ...rest } = meta;
        await updateChatMetadata(db, id, rest);
        chatMetadata.set(rest);
      } catch {
        // best-effort — hiding locally is enough
      }
    }
  };

  const use = (event: React.UIEvent) => {
    sendMessage?.(event, suggestion);
    void clear();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={use}
        className="inline-flex items-center gap-1.5 rounded-full border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 px-3 py-1.5 text-sm text-palmkit-elements-textPrimary transition-colors hover:bg-palmkit-elements-background-depth-3"
      >
        <span className="i-ph:play-circle text-[15px] text-palmkit-elements-item-contentAccent" />
        <span className="truncate max-w-[22rem]">Continue: {suggestion}</span>
      </button>
      <button
        type="button"
        onClick={() => void clear()}
        className="rounded-full px-2.5 py-1.5 text-xs text-palmkit-elements-textTertiary transition-colors hover:text-palmkit-elements-textSecondary"
      >
        Dismiss
      </button>
    </div>
  );
}
