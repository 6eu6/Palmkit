/**
 * useMemory — client-side hook for the 3-tier memory system.
 *
 * Responsibilities:
 *   1. Before sending a message: fetch memory block (GET /api/memory)
 *   2. Include memoryBlock in the chat request body
 *   3. After stream completes: trigger async extraction (POST /api/memory)
 *
 * The extraction runs as fire-and-forget — doesn't block the user.
 * Batched: only triggers every 3-5 messages (not every single message).
 */

import { useCallback, useRef } from 'react';
import { useStore } from '@nanostores/react';
import { chatId } from '~/lib/persistence';

const EXTRACTION_INTERVAL = 3; // trigger extraction every N messages

interface MemoryResponse {
  profile: string;
  facts: Array<{ key: string; value: string; mode: string; score: number }>;
  memoryBlock: string;
}

export function useMemory() {
  const messageCountRef = useRef(0);
  const currentChatId = useStore(chatId);

  /**
   * Fetch the memory block for system prompt injection.
   * Called before sending a chat message.
   */
  const fetchMemoryBlock = useCallback(async (query: string, mode: string): Promise<string> => {
    try {
      const params = new URLSearchParams({ query, mode });
      const response = await fetch(`/api/memory?${params}`, {
        credentials: 'same-origin',
      });

      if (!response.ok) {
        return '';
      }

      const data: MemoryResponse = await response.json();

      return data.memoryBlock || '';
    } catch {
      return '';
    }
  }, []);

  /**
   * Trigger async memory extraction after a conversation turn.
   * Called after the stream completes.
   *
   * Batched: only triggers every EXTRACTION_INTERVAL messages.
   */
  const triggerExtraction = useCallback(
    async (messages: Array<{ role: string; content: string }>, mode: string) => {
      messageCountRef.current += 1;

      if (messageCountRef.current < EXTRACTION_INTERVAL) {
        return;
      }

      messageCountRef.current = 0;

      try {
        await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            messages: messages.slice(-8), // last 8 turns
            conversationId: currentChatId,
            mode,
          }),
        });
      } catch {
        // Silent — extraction is best-effort
      }
    },
    [currentChatId],
  );

  return {
    fetchMemoryBlock,
    triggerExtraction,
  };
}
