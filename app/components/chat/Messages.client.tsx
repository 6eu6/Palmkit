import type { Message } from 'ai';
import { Fragment } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { TurnBuildStream } from './TurnBuildStream';
import { activeBuildJobIdStore } from '~/lib/stores/build-status';
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
