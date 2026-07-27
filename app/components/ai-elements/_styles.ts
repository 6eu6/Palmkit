/**
 * AI Elements — Monochrome Design System
 * =======================================
 *
 * A library of React components modeled after svelte-ai-elements,
 * adapted for PalmKit's token system and Phosphor icon set.
 *
 * Design principles:
 *   1. MONOCHROME — only palmkit-elements-* tokens, no bright colors
 *   2. PHOSPHOR ICONS (i-ph:*) — no emojis, ever
 *   3. COLLAPSIBLE — every expandable section uses framer-motion
 *   4. COMPOUND — components compose via sub-components
 *   5. CONTENT-FIRST — chrome recedes, content is the hero
 *
 * Components (20 total):
 *   Shimmer, Reasoning, Tool, ChainOfThought, Plan, Task,
 *   Sources, InlineCitation, Suggestion, Queue,
 *   Confirmation, Checkpoint, Context, OpenInChat,
 *   Conversation, Message, ModelSelector, PromptInput,
 *   Image, WebPreview
 */

// Shared animation keyframes (injected once)
export const AI_ELEMENTS_STYLES = `
@keyframes ai-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.ai-shimmer-text {
  background: linear-gradient(
    90deg,
    var(--palmkit-elements-textSecondary) 0%,
    var(--palmkit-elements-textPrimary) 50%,
    var(--palmkit-elements-textSecondary) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: ai-shimmer 2s linear infinite;
}
.ai-shimmer-bg {
  background: linear-gradient(
    90deg,
    var(--palmkit-elements-background-depth-2) 0%,
    var(--palmkit-elements-background-depth-3) 50%,
    var(--palmkit-elements-background-depth-2) 100%
  );
  background-size: 200% 100%;
  animation: ai-shimmer 2s linear infinite;
}
@keyframes ai-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
.ai-fade-in { animation: ai-fade-in 0.3s ease-out; }
@keyframes ai-slide-in {
  from { opacity: 0; transform: translateX(-8px); }
  to { opacity: 1; transform: none; }
}
.ai-slide-in { animation: ai-slide-in 0.25s ease-out; }
`;
