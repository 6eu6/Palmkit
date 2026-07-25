/**
 * StreamContainer — top-level layout for the new stream UX.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │ ChatThread (flex-1, scrollable)         │
 *   │                                         │
 *   │ [user message]                          │
 *   │ [assistant message with streaming caret]│
 *   └─────────────────────────────────────────┘
 *   │ ActivityPanel (collapsible, ~280px)     │  ← only if activity
 *   ├─────────────────────────────────────────┤
 *   │ StreamStatusBar (1 line)                │
 *   └─────────────────────────────────────────┘
 *
 * Replaces the chaotic BuildStream + Messages.client + ChatAlert combo
 * with a clean, layered structure.
 *
 * The component is presentation-only — all state comes from the stream
 * stores. Mount it once and let the StreamEventRouter populate the stores.
 */

import { memo } from 'react';
import { ChatThread } from './ChatThread';
import { ActivityPanel } from './ActivityPanel';
import { StreamStatusBar } from './StreamStatusBar';

function StreamContainerImpl() {
  return (
    <div className="flex flex-col h-full bg-palmkit-elements-background-depth-1">
      {/* Chat thread — takes all available space */}
      <div className="flex-1 min-h-0">
        <ChatThread />
      </div>

      {/* Activity panel — only renders when there's activity (returns null otherwise) */}
      <ActivityPanel />

      {/* Status bar — only renders during/after a stream */}
      <StreamStatusBar />
    </div>
  );
}

export const StreamContainer = memo(StreamContainerImpl);
