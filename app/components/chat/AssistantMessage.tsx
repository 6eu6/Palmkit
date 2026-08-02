import { memo, Fragment } from 'react';
import { Markdown } from './Markdown';
import type { JSONValue } from 'ai';
import { toast } from 'react-toastify';
import Popover from '~/components/ui/Popover';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import type { Message } from 'ai';
import type { ProviderInfo } from '~/types/model';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';
import { StreamMessage } from './stream-v2/StreamMessage';

interface AssistantMessageProps {
  content: string;
  annotations?: JSONValue[];
  messageId?: string;
  onRewind?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  onRetry?: () => void;
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;

  /** Sidebar mode — FormatConversionActions only shows in 'work' mode. */
  sidebarMode?: 'chat' | 'work' | 'code';

  /** Whether the assistant is currently streaming (hide conversion buttons while streaming). */
  isStreaming?: boolean;
  parts:
    | (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[]
    | undefined;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

function openArtifactInWorkbench(filePath: string) {
  filePath = normalizedFilePath(filePath);

  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
}

function normalizedFilePath(path: string) {
  let normalizedPath = path;

  if (normalizedPath.startsWith(WORK_DIR)) {
    normalizedPath = path.replace(WORK_DIR, '');
  }

  if (normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.slice(1);
  }

  return normalizedPath;
}

export const AssistantMessage = memo(
  ({
    content,
    annotations,
    messageId,
    onRewind,
    onRetry,
    onFork,
    append,
    chatMode,
    setChatMode,
    model,
    provider,
    sidebarMode: _sidebarMode,
    isStreaming,
    parts,
    addToolResult,
  }: AssistantMessageProps) => {
    const filteredAnnotations = (annotations?.filter(
      (annotation: JSONValue) =>
        annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
    ) || []) as { type: string; value: any } & { [key: string]: any }[];

    let chatSummary: string | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
      chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
    }

    let codeContext: string[] | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'codeContext')) {
      codeContext = filteredAnnotations.find((annotation) => annotation.type === 'codeContext')?.files;
    }

    const usage: {
      completionTokens: number;
      promptTokens: number;
      totalTokens: number;
    } = filteredAnnotations.find((annotation) => annotation.type === 'usage')?.value;

    /*
     * toolInvocations, reasoningParts, toolCallAnnotations are now handled
     * by UnifiedStreamRenderer — no longer needed here.
     */

    return (
      <div className="overflow-hidden w-full">
        <>
          <div className=" flex gap-2 items-center text-sm text-palmkit-elements-textSecondary mb-2">
            {(codeContext || chatSummary) && (
              <Popover side="right" align="start" trigger={<div className="i-ph:info" />}>
                {chatSummary && (
                  <div className="max-w-chat">
                    <div className="summary max-h-96 flex flex-col">
                      <h2 className="border border-palmkit-elements-borderColor rounded-md p4">Summary</h2>
                      <div style={{ zoom: 0.7 }} className="overflow-y-auto m4">
                        <Markdown>{chatSummary}</Markdown>
                      </div>
                    </div>
                    {codeContext && (
                      <div className="code-context flex flex-col p4 border border-palmkit-elements-borderColor rounded-md">
                        <h2>Context</h2>
                        <div className="flex gap-4 mt-4 palmkit" style={{ zoom: 0.6 }}>
                          {codeContext.map((x) => {
                            const normalized = normalizedFilePath(x);
                            return (
                              <Fragment key={normalized}>
                                <code
                                  className="bg-palmkit-elements-artifacts-inlineCode-background text-palmkit-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-palmkit-elements-item-contentAccent hover:underline cursor-pointer"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openArtifactInWorkbench(normalized);
                                  }}
                                >
                                  {normalized}
                                </code>
                              </Fragment>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="context"></div>
              </Popover>
            )}
            <div className="flex w-full items-center justify-between">
              {usage && (
                <div>
                  Tokens: {usage.totalTokens} (prompt: {usage.promptTokens}, completion: {usage.completionTokens})
                </div>
              )}
              <div className="flex gap-1 sm:gap-2 flex-row ml-auto">
                {/* Share button — top right — ALL tabs, ALL screen sizes */}
                {messageId && !isStreaming && (
                  <button
                    onClick={() => {
                      const url = window.location.href;
                      navigator.clipboard.writeText(url).then(() => {
                        toast.success('Chat link copied!');
                      });
                    }}
                    title="Share conversation"
                    className="i-ph:share-network text-lg sm:text-xl text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors p-1"
                  />
                )}
                {onRewind && messageId && (
                  <button
                    onClick={() => onRewind(messageId)}
                    title="Revert to this message"
                    className="i-ph:arrow-u-up-left text-lg sm:text-xl text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors p-1"
                  />
                )}
                {onFork && messageId && (
                  <button
                    onClick={() => onFork(messageId)}
                    title="Fork chat"
                    className="i-ph:git-fork text-lg sm:text-xl text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors p-1"
                  />
                )}
              </div>
            </div>
          </div>
        </>
        {/*
         * Stream v2: Unified content renderer.
         * Handles: reasoning, markdown, tool invocations (with rich UI),
         * format conversion buttons (work mode), and build timeline
         * (code mode, lazy-loaded).
         *
         * The header above (tokens, rewind, fork, code context) stays
         * in AssistantMessage — only the content area is delegated.
         */}
        <StreamMessage
          content={content}
          parts={parts}
          annotations={annotations as Message['annotations']}
          messageId={messageId}
          append={append}
          model={model}
          provider={provider}
          chatMode={chatMode}
          setChatMode={setChatMode}
          addToolResult={addToolResult}
          isStreaming={isStreaming}
          buildJobId={filteredAnnotations.find((a) => a.type === 'palmkit-build')?.jobId as string | undefined}
          onRetry={onRetry}
        />
      </div>
    );
  },
);
