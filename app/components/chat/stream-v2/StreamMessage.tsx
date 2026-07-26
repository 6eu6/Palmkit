/**
 * StreamMessage — Professional Streaming Display (v2, AI Elements)
 * ================================================================
 *
 * Replaces the old colored StreamMessage with a clean, monochrome
 * implementation using the AI Elements library.
 *
 * Components used:
 *   - Reasoning     → AI thinking (auto-open during stream, auto-collapse after)
 *   - Tool          → Tool calls (collapsible, monochrome)
 *   - Sources       → Web search source citations
 *   - Shimmer       → Loading text animation
 *   - Task          → Build phase tracking (code mode)
 *   - Suggestion    → Follow-up suggestions after response
 *
 * Mode-specific behavior:
 *   chat:  Reasoning + Markdown + Sources (minimal)
 *   work:  Reasoning + Markdown + Tool + Sources + FormatConversion
 *   code:  Reasoning + Markdown + Tool + Task(build) + Sources
 */

import { memo, lazy, Suspense } from 'react';
import { useStore } from '@nanostores/react';
import { Markdown } from '~/components/chat/Markdown';
import { ToolInvocations } from '~/components/chat/ToolInvocations';
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
}

// ─── Typing cursor (monochrome, subtle) ─────────────────────────
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
  const hasContent = Boolean(content && content.length > 0);
  const hasSources = sources.length > 0;

  // Determine current phase for the loading indicator
  const showLoading = isStreaming && !hasContent && !hasThinking && !hasTools;

  return (
    <div className="overflow-hidden w-full">
      <style>{CURSOR_STYLE}</style>

      {/* Loading state — visible while waiting for first token */}
      {showLoading && (
        <div className="flex items-center gap-2 py-3 text-xs text-palmkit-elements-textSecondary">
          <div
            className="w-3 h-3 rounded-full border-2 border-palmkit-elements-textSecondary border-t-transparent"
            style={{ animation: 'ai-connect-pulse 1s linear infinite' }}
          />
          <Shimmer>Connecting to model…</Shimmer>
        </div>
      )}

      {/* Streaming indicator — visible during generation */}
      {isStreaming && hasContent && (
        <div className="flex items-center gap-1.5 mb-2 text-[10px] text-palmkit-elements-textSecondary">
          <div className="i-ph:pencil-simple text-xs" />
          <span>Generating…</span>
        </div>
      )}

      {/* Reasoning — auto-open during stream, auto-collapse after */}
      {hasThinking && <Reasoning isStreaming={isStreaming} steps={reasoningSteps} />}

      {/* Main content — markdown with typing cursor */}
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

      {/* Tool invocations — rich UI via ToolInvocations (which uses ToolResultRenderer) */}
      {hasTools && (
        <div className="mt-2">
          <ToolInvocations
            toolInvocations={toolInvocations!}
            toolCallAnnotations={toolCallAnnotations}
            addToolResult={addToolResult}
          />
        </div>
      )}

      {/* Sources — web search citations */}
      {hasSources && !isStreaming && <Sources sources={sources} />}

      {/* Format conversion buttons — work mode only, after streaming */}
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

      {/* Build timeline — code mode only, lazy loaded */}
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
