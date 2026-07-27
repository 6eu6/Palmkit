/**
 * StreamMessage — Professional Streaming Display (v2, AI Elements)
 * ================================================================
 *
 * Renders message parts IN ORDER (inline) — not separated into sections.
 * This means tool calls appear between text chunks, matching the natural
 * flow of the model's response during streaming.
 *
 * Components used:
 *   - Reasoning     → AI thinking (auto-open during stream, auto-collapse after)
 *   - Tool          → Tool calls (collapsible, monochrome)
 *   - Sources       → Web search source citations
 *   - Shimmer       → Loading text animation
 *
 * After streaming completes, action buttons appear:
 *   - Retry (regenerate response)
 *   - Copy (markdown only, no reasoning)
 *   - Like / Dislike
 */

import { memo, lazy, Suspense, useState, useCallback } from 'react';
import { useStore } from '@nanostores/react';
import { Markdown } from '~/components/chat/Markdown';
import { ToolInvocations } from '~/components/chat/ToolInvocations';
import { ToolResultRenderer } from '~/components/chat/tool-results/ToolResultRenderer';
import { FormatConversionActions } from '~/components/chat/tool-results/shared/FormatConversionActions';
import { sidebarModeStore } from '~/lib/stores/sidebar';
import type { Message } from 'ai';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';
import type { ToolCallAnnotation } from '~/types/context';
import type { ProviderInfo } from '~/types/model';

// AI Elements
import { Reasoning, type ReasoningStep } from '~/components/ai-elements/Reasoning';
import { Shimmer } from '~/components/ai-elements/Shimmer';
import { Sources, type SourceItem } from '~/components/ai-elements/Sources';
import WithTooltip from '~/components/ui/Tooltip';

// Lazy-load build timeline only in code mode
const BuildTimeline = lazy(() => import('./BuildTimeline').then((m) => ({ default: m.BuildTimeline })));

export interface StreamMessageProps {
  content: string;
  parts:
    (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[] | undefined;
  annotations?: Message['annotations'];
  messageId?: string;
  append?: (message: Message) => void;
  model?: string;
  provider?: ProviderInfo;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  isStreaming?: boolean;
  buildJobId?: string;
  onRetry?: () => void;
}

// ─── Typing cursor ──────────────────────────────────────────────
const TypingCursor = memo(() => (
  <span
    className="inline-block w-[2px] h-[1em] bg-palmkit-elements-textSecondary ml-0.5 align-text-bottom"
    style={{ animation: 'ai-cursor-blink 0.8s steps(2) infinite' }}
  />
));

const CURSOR_STYLE = `
@keyframes ai-cursor-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
@keyframes ai-connect-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
`;

// ─── Action buttons (retry, copy, like, dislike) ────────────────
interface ActionButtonsProps {
  content: string;
  isStreaming?: boolean;
  onRetry?: () => void;
}

const ActionButtons = memo(({ content, isStreaming, onRetry }: ActionButtonsProps) => {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'like' | 'dislike' | null>(null);

  const handleCopy = useCallback(() => {
    // Copy ONLY the markdown content (not reasoning/thinking parts)
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  // During streaming: show spinner. After: show all buttons.
  // But ALWAYS render the buttons too (just hide during streaming via CSS)
  // so they're available immediately when streaming ends.
  return (
    <div className="flex items-center gap-1 mt-3 -ml-1 opacity-60 hover:opacity-100 transition-opacity">
      {isStreaming && (
        <div className="flex items-center gap-1.5 text-[10px] text-palmkit-elements-textSecondary">
          <div className="i-ph:spinner text-sm animate-spin" />
          <span>Generating…</span>
        </div>
      )}
      {!isStreaming && (
        <>
          {/* Retry */}
          {onRetry && (
            <button
              onClick={onRetry}
              title="Retry"
              className="p-1.5 rounded-lg hover:bg-palmkit-elements-background-depth-2 text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
            >
              <div className="i-ph:arrow-clockwise text-base" />
            </button>
          )}

          {/* Copy */}
          <button
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy response'}
            className="p-1.5 rounded-lg hover:bg-palmkit-elements-background-depth-2 text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
          >
            {copied ? (
              <div className="i-ph:check text-base" />
            ) : (
              <div className="i-ph:copy text-base" />
            )}
          </button>

          {/* Like */}
          <button
            onClick={() => setFeedback(feedback === 'like' ? null : 'like')}
            title="Good response"
            className={`p-1.5 rounded-lg hover:bg-palmkit-elements-background-depth-2 transition-colors ${
              feedback === 'like'
                ? 'text-emerald-500'
                : 'text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary'
            }`}
          >
            <div className="i-ph:thumbs-up text-base" />
          </button>

          {/* Dislike */}
          <button
            onClick={() => setFeedback(feedback === 'dislike' ? null : 'dislike')}
            title="Bad response"
            className={`p-1.5 rounded-lg hover:bg-palmkit-elements-background-depth-2 transition-colors ${
              feedback === 'dislike'
                ? 'text-red-500'
                : 'text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary'
            }`}
          >
            <div className="i-ph:thumbs-down text-base" />
          </button>
        </>
      )}
    </div>
  );
});
ActionButtons.displayName = 'ActionButtons';

function StreamMessageImpl({
  content,
  parts,
  annotations,
  messageId,
  append,
  model,
  provider,
  chatMode,
  setChatMode,
  addToolResult,
  isStreaming,
  buildJobId,
  onRetry,
}: StreamMessageProps) {
  const sidebarMode = useStore(sidebarModeStore);

  const reasoningParts = parts?.filter((p) => p.type === 'reasoning') as ReasoningUIPart[] | undefined;
  const toolInvocations = parts?.filter((p) => p.type === 'tool-invocation') as ToolInvocationUIPart[] | undefined;
  const sourceParts = parts?.filter((p) => p.type === 'source') as SourceUIPart[] | undefined;

  const filteredAnnotations = (annotations?.filter(
    (a) => a && typeof a === 'object' && Object.keys(a as object).includes('type'),
  ) || []) as Array<{ type: string; value: any } & Record<string, any>>;

  const toolCallAnnotations = filteredAnnotations.filter(
    (a) => a.type === 'toolCall',
  ) as unknown as ToolCallAnnotation[];
  const validationAnnotation = filteredAnnotations.find((a) => a.type === 'validation');
  const buildAnnotation = filteredAnnotations.find((a) => a.type === 'palmkit-build');
  const isPastBuild = sidebarMode === 'code' && buildAnnotation && !isStreaming;

  // Convert reasoning parts to ReasoningStep[]
  const reasoningSteps: ReasoningStep[] =
    reasoningParts?.map((p) => ({
      text: (p as any).text || (p as any).reasoning || '',
    })) ?? [];

  // Convert source parts to SourceItem[]
  const sources: SourceItem[] =
    sourceParts?.map((s) => ({
      title: (s as any).title || 'Source',
      url: (s as any).url || '',
      snippet: (s as any).snippet,
    })) ?? [];

  const hasThinking = reasoningSteps.length > 0;
  const hasTools = (toolInvocations?.length ?? 0) > 0;
  // hasContent checks BOTH the content string AND parts (inline rendering)
  // because in v4, content may be empty while parts contain the text
  const hasTextParts = (parts?.filter(p => p.type === 'text').length ?? 0) > 0;
  const hasContent = Boolean((content && content.length > 0) || hasTextParts);
  const hasSources = sources.length > 0;

  const showLoading = isStreaming && !hasContent && !hasThinking && !hasTools;

  /*
   * Render parts IN ORDER — not separated into sections.
   * The parts array from AI SDK v4 preserves the natural flow:
   * [reasoning, text, tool-call, text, tool-call, text, source, ...]
   *
   * We group consecutive text parts together (for markdown rendering)
   * and render tool/reasoning parts at their natural position.
   */

  // Group parts into render blocks
  const renderBlocks: Array<{ type: 'reasoning' | 'text' | 'tools' | 'sources'; data: any }> = [];
  let textBuffer = '';

  if (parts && parts.length > 0) {
    for (const part of parts) {
      if (part.type === 'text') {
        textBuffer += (part as TextUIPart).text || '';
      } else {
        // Flush text buffer
        if (textBuffer) {
          renderBlocks.push({ type: 'text', data: textBuffer });
          textBuffer = '';
        }
        if (part.type === 'reasoning') {
          renderBlocks.push({ type: 'reasoning', data: part });
        } else if (part.type === 'tool-invocation') {
          renderBlocks.push({ type: 'tools', data: part });
        } else if (part.type === 'source') {
          renderBlocks.push({ type: 'sources', data: part });
        }
      }
    }
    // Flush remaining text
    if (textBuffer) {
      renderBlocks.push({ type: 'text', data: textBuffer });
    }
  }

  // Fallback: if no parts but content exists (v1 compat)
  const useInlineRendering = renderBlocks.length > 0;

  return (
    <div className="overflow-hidden w-full">
      <style>{CURSOR_STYLE}</style>

      {/* Loading state */}
      {showLoading && (
        <div className="flex items-center gap-2 py-3 text-xs text-palmkit-elements-textSecondary">
          <div
            className="w-3 h-3 rounded-full border-2 border-palmkit-elements-textSecondary border-t-transparent"
            style={{ animation: 'ai-connect-pulse 1s linear infinite' }}
          />
          <Shimmer>Connecting to model…</Shimmer>
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && hasContent && (
        <div className="flex items-center gap-1.5 mb-2 text-[10px] text-palmkit-elements-textSecondary">
          <div className="i-ph:pencil-simple text-xs" />
          <span>Generating…</span>
        </div>
      )}

      {useInlineRendering ? (
        /*
         * INLINE RENDERING — parts in their natural order.
         * Text chunks are rendered as markdown, tool calls as rich UI,
         * reasoning as collapsible blocks — all interleaved.
         */
        <>
          {renderBlocks.map((block, i) => {
            if (block.type === 'reasoning') {
              const step: ReasoningStep = {
                text: (block.data as any).text || (block.data as any).reasoning || '',
              };
              return <Reasoning key={`r-${i}`} isStreaming={isStreaming} steps={[step]} />;
            }
            if (block.type === 'text') {
              return (
                <div key={`t-${i}`} className="ai-fade-in">
                  <Markdown
                    append={append}
                    chatMode={chatMode}
                    setChatMode={setChatMode}
                    model={model}
                    provider={provider}
                    html
                  >
                    {block.data}
                  </Markdown>
                  {isStreaming && i === renderBlocks.length - 1 && <TypingCursor />}
                </div>
              );
            }
            if (block.type === 'tools') {
              /*
               * Render tool results INLINE — directly via ToolResultRenderer,
               * NOT wrapped in ToolInvocations (which adds "MCP Tool Invocations"
               * collapsible header). This makes PDF/docx/xlsx previews appear
               * right in the chat flow where the model generated them.
               */
              const toolPart = block.data as ToolInvocationUIPart;
              const inv = toolPart.toolInvocation;

              // If the tool call is still pending (no result yet), show a compact
              // "calling tool..." indicator
              if (inv.state === 'call' || inv.state === 'partial-call') {
                return (
                  <div key={`tool-${i}`} className="my-2 flex items-center gap-2 text-xs text-palmkit-elements-textSecondary">
                    <div className="i-ph:spinner text-sm animate-spin" />
                    <span>Calling {inv.toolName}…</span>
                  </div>
                );
              }

              // Tool has a result — render it directly via ToolResultRenderer
              // (shows PDF preview, docx preview, etc. inline, no MCP wrapper)
              return (
                <div key={`tool-${i}`} className="my-3">
                  <ToolResultRenderer
                    toolInvocation={inv}
                  />
                </div>
              );
            }
            if (block.type === 'sources' && !isStreaming) {
              const src: SourceItem = {
                title: (block.data as any).title || 'Source',
                url: (block.data as any).url || '',
                snippet: (block.data as any).snippet,
              };
              return <Sources key={`s-${i}`} sources={[src]} />;
            }
            return null;
          })}
        </>
      ) : (
        /*
         * FALLBACK RENDERING — no parts array (v1 compat or restored messages).
         * Renders content, then tools, then sources in separate sections.
         */
        <>
          {/* Reasoning */}
          {hasThinking && <Reasoning isStreaming={isStreaming} steps={reasoningSteps} />}

          {/* Main content */}
          {hasContent && (
            <div className="ai-fade-in">
              <Markdown
                append={append}
                chatMode={chatMode}
                setChatMode={setChatMode}
                model={model}
                provider={provider}
                html
              >
                {content}
              </Markdown>
              {isStreaming && <TypingCursor />}
            </div>
          )}

          {/* Tool invocations */}
          {hasTools && (
            <div className="mt-2">
              <ToolInvocations
                toolInvocations={toolInvocations!}
                toolCallAnnotations={toolCallAnnotations}
                addToolResult={addToolResult}
              />
            </div>
          )}

          {/* Sources */}
          {hasSources && !isStreaming && <Sources sources={sources} />}
        </>
      )}

      {/* Format conversion — work mode only */}
      {append && content && sidebarMode === 'work' && !isStreaming && (
        <FormatConversionActions
          content={content}
          messageId={messageId}
          sidebarMode={sidebarMode}
          isStreaming={isStreaming}
          onSendMessage={(msg) => {
            append({ role: 'user', content: msg } as Message);
          }}
        />
      )}

      {/* Action buttons — always show when content exists.
          ActionButtons internally hides itself during streaming. */}
      {hasContent && (
        <ActionButtons
          content={content}
          isStreaming={isStreaming}
          onRetry={onRetry || (() => window.dispatchEvent(new CustomEvent('palmkit:retry-build')))}
        />
      )}

      {/* Build timeline — code mode only */}
      {sidebarMode === 'code' && (
        <Suspense fallback={null}>
          <BuildTimeline
            buildJobId={buildJobId}
            isStreaming={isStreaming}
            validationAnnotation={validationAnnotation}
            isPastBuild={isPastBuild}
          />
        </Suspense>
      )}
    </div>
  );
}

export const StreamMessage = memo(StreamMessageImpl);
