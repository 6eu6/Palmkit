import type { Message } from 'ai';
import { Fragment, memo } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { TurnBuildStream } from './TurnBuildStream';
import { activeBuildJobIdStore, workerEventsStore, workerProgressStore } from '~/lib/stores/build-status';
import { PalmkitLoader } from '~/components/ui/PalmkitLoader';
import { useLocation } from '@remix-run/react';
import { db, chatId } from '~/lib/persistence/useChatHistory';
import { forkChat } from '~/lib/persistence/db';
import { toast } from 'react-toastify';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import type { ProviderInfo } from '~/types/model';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

/**
 * A build turn's real UI is the clean BuildStream timeline. In the brief window
 * right after the user sends — before the first worker event/progress arrives —
 * that stream has no data yet, so this shows a minimal "Working…" line so the
 * user always sees the build is running. It hides itself the instant the global
 * BuildStream has something to render, leaving a single clean stream (no
 * duplicate, and none of the old hardcoded "⚡ Building project…" banner).
 */
const LiveBuildPlaceholder = memo(() => {
  const events = useStore(workerEventsStore);
  const { progress } = useStore(workerProgressStore);

  if (events.length > 0 || progress > 0) {
    return null;
  }

  return (
    <div className="mb-5 flex items-center gap-2">
      <PalmkitLoader bare size={15} className="shrink-0 text-[var(--pk-accent)]" />
      <span className="text-sm font-medium text-palmkit-elements-textPrimary">Working…</span>
    </div>
  );
});
LiveBuildPlaceholder.displayName = 'LiveBuildPlaceholder';

/**
 * True when an assistant message body is JUST the worker build banner
 * (⚡/🔨/✅/❌ …) — i.e. this turn IS a build, whose real representation is the
 * BuildStream timeline, not the hardcoded text line.
 */
function isBuildBannerContent(content: unknown): boolean {
  return typeof content === 'string' && /^\s*[⚡🔨✅❌]/.test(content);
}

export const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  (props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { id, isStreaming = false, messages = [] } = props;
    const location = useLocation();
    const activeBuildJobId = useStore(activeBuildJobIdStore);

    /* Extract the per-turn build jobId stamped on an assistant message. */
    const getBuildJobId = (annotations: Message['annotations']): string | null => {
      if (!Array.isArray(annotations)) {
        return null;
      }

      for (const a of annotations) {
        if (a && typeof a === 'object' && (a as any).type === 'palmkit-build' && (a as any).jobId) {
          return (a as any).jobId as string;
        }
      }

      return null;
    };

    const handleRewind = (messageId: string) => {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('rewindTo', messageId);
      window.location.search = searchParams.toString();
    };

    const handleFork = async (messageId: string) => {
      try {
        if (!db || !chatId.get()) {
          toast.error('Chat persistence is not available');
          return;
        }

        const urlId = await forkChat(db, chatId.get()!, messageId);
        window.location.href = `/chat/${urlId}`;
      } catch (error) {
        toast.error('Failed to fork chat: ' + (error as Error).message);
      }
    };

    return (
      <div id={id} className={props.className} ref={ref}>
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, content, id: messageId, annotations, parts } = message;
              const isUserMessage = role === 'user';
              const isFirst = index === 0;
              const isHidden = annotations?.includes('hidden');

              if (isHidden) {
                return <Fragment key={index} />;
              }

              /*
               * Per-turn build stream: if this assistant turn ran a build whose
               * job is NOT the live one, render its saved timeline inline
               * (collapsed). The live build is drawn by the global BuildStream,
               * so we skip it here to avoid a duplicate.
               */
              const buildJobId = !isUserMessage ? getBuildJobId(annotations) : null;
              const showTurnStream = !!buildJobId && buildJobId !== activeBuildJobId;

              /*
               * A build turn — the in-progress one (its content is the worker
               * banner, before its jobId annotation is stamped) or a finished/
               * failed one (carries a palmkit-build jobId). Its clean timeline is
               * drawn by TurnBuildStream (past) or the global BuildStream (live),
               * so we render the stream AS the turn and drop the old hardcoded
               * "⚡ Building project…" text banner entirely.
               */
              const isBuildTurn = !isUserMessage && (!!buildJobId || isBuildBannerContent(content));

              return (
                <div
                  key={index}
                  className={classNames('flex gap-4 py-3 w-full rounded-lg', {
                    'mt-4': !isFirst,
                  })}
                >
                  <div className="grid grid-col-1 w-full">
                    {isUserMessage ? (
                      <UserMessage content={content} parts={parts} />
                    ) : isBuildTurn ? (
                      showTurnStream ? (
                        <TurnBuildStream jobId={buildJobId!} />
                      ) : (
                        <LiveBuildPlaceholder />
                      )
                    ) : (
                      <>
                        <AssistantMessage
                          content={content}
                          annotations={message.annotations}
                          messageId={messageId}
                          onRewind={handleRewind}
                          onFork={handleFork}
                          append={props.append}
                          chatMode={props.chatMode}
                          setChatMode={props.setChatMode}
                          model={props.model}
                          provider={props.provider}
                          parts={parts}
                          addToolResult={props.addToolResult}
                        />
                        {showTurnStream && <TurnBuildStream jobId={buildJobId!} />}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          : null}
        {isStreaming && (
          <div className="text-center w-full  text-palmkit-elements-item-contentAccent i-svg-spinners:3-dots-fade text-4xl mt-4"></div>
        )}
      </div>
    );
  },
);
