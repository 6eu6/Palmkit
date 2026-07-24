/**
 * useStreamChat — React hook that wires StreamEventRouter to React state.
 *
 * Replaces useChat (from @ai-sdk/react) for the new /api/stream endpoint.
 * Provides:
 *   - sendMessage(text) — POST to /api/stream, route events
 *   - stop() — abort the current stream
 *   - isStreaming — live status
 *   - mode — current stream mode (discuss/build)
 *
 * The hook is presentation-agnostic — components subscribe to the stores
 * directly. This hook just drives the lifecycle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { StreamEventRouter } from '~/lib/stream/stream-router';
import {
  resetStreamStatus,
  clearActivity,
  clearChatMessages,
  clearReasoning,
  streamStatusStore,
} from '~/lib/stream/stores';

export interface UseStreamChatOptions {
  endpoint?: string;
  onStreamEnd?: (reason: 'complete' | 'cancelled' | 'error' | 'timeout') => void;
}

export interface UseStreamChatReturn {
  sendMessage: (text: string, options?: { chatMode?: 'discuss' | 'build' }) => Promise<void>;
  stop: () => void;
  isStreaming: boolean;
  mode: 'discuss' | 'build' | 'hybrid' | null;
}

/**
 * Generate a unique ID for messages. Uses crypto.randomUUID when available
 * (modern browsers + Node ≥16), falls back to a timestamp+random string
 * for older environments.
 */
function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function useStreamChat(options: UseStreamChatOptions = {}): UseStreamChatReturn {
  const { endpoint = '/api/stream', onStreamEnd } = options;
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const routerRef = useRef<StreamEventRouter | null>(null);

  const status = useStore(streamStatusStore);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      routerRef.current?.close();
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string, sendOptions?: { chatMode?: 'discuss' | 'build' }) => {
      if (isStreaming) {
        console.warn('[useStreamChat] already streaming — ignoring send');

        return;
      }

      // Clear previous state (new conversation turn)
      clearChatMessages();
      clearReasoning();
      clearActivity();
      resetStreamStatus();

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const router = new StreamEventRouter({
        onEvent: (event) => {
          if (event.kind === 'stream:end') {
            setIsStreaming(false);
            onStreamEnd?.(event.reason);
          }
        },
        onError: (err) => {
          console.error('[useStreamChat] stream error:', err);
          setIsStreaming(false);
        },
        onComplete: () => {
          setIsStreaming(false);
        },
      });
      routerRef.current = router;

      setIsStreaming(true);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ id: generateMessageId(), role: 'user', content: text }],
            chatMode: sendOptions?.chatMode,
            contextOptimization: false,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        await router.consume(response.body);
      } catch (err: unknown) {
        const error = err as { name?: string };

        if (error?.name !== 'AbortError') {
          console.error('[useStreamChat] fetch error:', err);
        }

        setIsStreaming(false);
      } finally {
        abortControllerRef.current = null;
        routerRef.current = null;
      }
    },
    [endpoint, isStreaming, onStreamEnd],
  );

  const stop = useCallback(() => {
    if (!isStreaming) {
      return;
    }

    abortControllerRef.current?.abort();
    routerRef.current?.close();
    setIsStreaming(false);
  }, [isStreaming]);

  return {
    sendMessage,
    stop,
    isStreaming,
    mode: status.mode,
  };
}
