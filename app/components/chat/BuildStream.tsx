/**
 * BuildStream — unified, chronological build timeline (Phase C, increment 1).
 *
 * Replaces the four separate panels (WorkerProgress, ThoughtProcessPanel,
 * TodosPanel, ActivityStream) with ONE cohesive CLI-style stream, in the
 * spirit of the AI-Elements ChainOfThought / Tool / Message components.
 *
 * Data source: the ordered `workerEventsStore` (the full job_events log) plus
 * `workerProgressStore`. Everything is derived in a single pass so the stream
 * is truly chronological — thinking, then a file, then a command, then more
 * thinking — exactly as it happened, grouped under the agent that produced it.
 *
 * Built with UnoCSS (presetUno utilities + presetIcons `i-ph:*`) and the
 * existing `palmkit-elements-*` theme tokens — no new dependencies.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workerEventsStore, workerProgressStore, type WorkerEvent } from '~/lib/stores/build-status';
import { liveStreamStore } from '~/lib/stores/live-stream';
import { classNames } from '~/utils/classNames';
import { PalmkitLoader } from '~/components/ui/PalmkitLoader';

/*
 * Stream micro-animations (M2): the typing caret and the gentle entrance of
 * new rows. Injected once — tiny, self-contained, theme-agnostic.
 */
const STREAM_STYLES = `
@keyframes pk-caret-blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0; } }
@keyframes pk-row-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
.pk-caret { display: inline-block; width: 0.55em; animation: pk-caret-blink 1s steps(1) infinite; }
.pk-row-in { animation: pk-row-in 0.25s ease-out; }
`;

/*
 * Emoji-free stream: every rendered text passes through stripEmoji so the
 * UI stays clean regardless of what the worker (or legacy events) put in
 * message strings. Icons — not emojis — carry the semantics of each row.
 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu;

export function stripEmoji(text: string): string {
  return (text ?? '')
    .replace(EMOJI_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/*
 * Tool → icon for the live activity chip ("what is the agent literally doing
 * right now"). Mirrors the icons used elsewhere in the stream.
 */
const LIVE_TOOL_ICON: Record<string, string> = {
  write_files: 'i-ph:pencil-simple-line-bold',
  write_file: 'i-ph:pencil-simple-line-bold',
  edit_file: 'i-ph:pencil-simple-line-bold',
  read_file: 'i-ph:eye-bold',
  list_files: 'i-ph:list-bullets-bold',
  search_code: 'i-ph:magnifying-glass-bold',
  run_shell: 'i-ph:terminal-bold',
  run_tests: 'i-ph:flask-bold',
  analyze_screenshot: 'i-ph:camera-bold',
  generate_image: 'i-ph:image-bold',
  generate_video: 'i-ph:film-strip-bold',
  update_todos: 'i-ph:list-checks-bold',
  spawn_subagent: 'i-ph:robot-bold',
  done: 'i-ph:flag-checkered-bold',
};

const LIVE_TOOL_LABEL: Record<string, string> = {
  write_files: 'Writing',
  write_file: 'Writing',
  edit_file: 'Editing',
  read_file: 'Reading',
  list_files: 'Listing files',
  search_code: 'Searching',
  run_shell: 'Running',
  run_tests: 'Testing',
  analyze_screenshot: 'Taking a screenshot',
  generate_image: 'Generating image',
  generate_video: 'Generating video',
  update_todos: 'Updating plan',
  spawn_subagent: 'Delegating',
  done: 'Wrapping up',
};

/*
 * LiveTail — M2's instant layer. Renders the model's in-flight text
 * (token-by-token, ahead of the durable rows) with a typing caret, plus a
 * chip for the tool call currently executing. Mounted only on the LIVE
 * turn; disappears the moment the durable stream catches up (the store is
 * cleared on every reconciliation).
 */
const LiveTail = memo(() => {
  const live = useStore(liveStreamStore);

  // 1s ticker for the live "Thinking · Ns" counter.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!live.thinking) {
      return undefined;
    }

    const t = setInterval(() => setTick((n) => n + 1), 1000);

    return () => clearInterval(t);
  }, [live.thinking.length > 0]);

  if (!live.active || (!live.text && !live.thinking && !live.tool)) {
    return null;
  }

  // Show readable tails — the full text lands in the folded stream anyway.
  const thinkTail = live.thinking.length > 600 ? `…${live.thinking.slice(-600)}` : live.thinking;
  const tail = live.text.length > 700 ? `…${live.text.slice(-700)}` : live.text;
  const thinkSecs = live.thinkingStartedAt ? Math.max(1, Math.round((Date.now() - live.thinkingStartedAt) / 1000)) : 0;
  const toolIcon = live.tool ? (LIVE_TOOL_ICON[live.tool.name] ?? 'i-ph:gear-bold') : '';
  const toolLabel = live.tool ? (LIVE_TOOL_LABEL[live.tool.name] ?? live.tool.name) : '';

  return (
    <div className="relative pl-5 pb-3 space-y-2">
      <div className="absolute left-[7px] top-0 bottom-0 w-px bg-palmkit-elements-borderColor/40" />
      {thinkTail && (
        <div className="rounded-lg border border-palmkit-elements-borderColor/50 bg-palmkit-elements-background-depth-2/60 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-palmkit-elements-textTertiary">
            <span className="i-ph:brain shrink-0 text-[13px]" />
            <span>Thinking</span>
            {thinkSecs > 0 && <span className="tabular-nums">· {thinkSecs}s</span>}
          </div>
          <div className="max-h-32 overflow-hidden text-xs italic leading-relaxed text-palmkit-elements-textTertiary whitespace-pre-wrap">
            {thinkTail}
            <span className="pk-caret text-[var(--pk-accent)]">▍</span>
          </div>
        </div>
      )}
      {tail && (
        <div className="text-sm leading-relaxed text-palmkit-elements-textSecondary whitespace-pre-wrap">
          {tail}
          <span className="pk-caret text-[var(--pk-accent)]">▍</span>
        </div>
      )}
      {live.tool && (
        <div className="pk-row-in inline-flex items-center gap-1.5 rounded-full border border-palmkit-elements-borderColor/60 bg-palmkit-elements-background-depth-2 px-2.5 py-1 text-xs text-palmkit-elements-textSecondary">
          <span className={classNames('shrink-0 text-[13px] text-[var(--pk-accent)]', toolIcon)} />
          <span className="font-medium">{toolLabel}</span>
          {live.tool.detail && <span className="max-w-[220px] truncate font-mono opacity-80">{live.tool.detail}</span>}
          <PalmkitLoader bare size={9} className="text-[var(--pk-accent)]" />
        </div>
      )}
    </div>
  );
});

LiveTail.displayName = 'LiveTail';

/*
 * ThoughtRow — a completed thinking segment from the durable stream.
 * Collapsed to a single-line preview by default (the thought already served
 * its purpose); expandable for users who want to read the model's mind.
 */
const ThoughtRow = memo(({ text }: { text: string }) => {
  const [expanded, setExpanded] = useState(false);
  const preview =
    text
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.slice(0, 90) ?? '';

  return (
    <div className="rounded-lg border border-palmkit-elements-borderColor/50 bg-palmkit-elements-background-depth-2/60">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-palmkit-elements-textTertiary"
      >
        <span className="i-ph:brain shrink-0 text-[13px]" />
        <span className="shrink-0">Thought</span>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-left font-normal italic opacity-70">{preview}</span>
        )}
        <span
          className="i-ph:caret-down ml-auto shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {expanded && (
        <div className="border-t border-palmkit-elements-borderColor/40 px-3 py-2 text-xs italic leading-relaxed text-palmkit-elements-textTertiary whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
});

ThoughtRow.displayName = 'ThoughtRow';

/*
 * Lightweight inline markdown renderer for the build summary.
 *
 * We intentionally do NOT use the full <Markdown> component here because it
 * pulls in shiki (syntax highlighter) + Artifact + CodeBlock + ThoughtBox —
 * heavy modules that would inflate the BuildStream bundle (which is mounted
 * on every chat view). The summary is simple markdown (bold, bullets, inline
 * code, paragraphs), so a minimal regex-based renderer is enough and keeps
 * the bundle lean.
 */
const SummaryMarkdown = memo(({ text }: { text: string }) => {
  const lines = (text ?? '').split('\n');

  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        // Empty line → spacer
        if (!line.trim()) {
          return <div key={i} className="h-1" />;
        }

        // Bullet list item (- or *)
        const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);

        if (bulletMatch) {
          return (
            <div key={i} className="flex gap-2 pl-2">
              <span className="text-palmkit-elements-textTertiary">•</span>
              <span className="flex-1">{renderInline(bulletMatch[1])}</span>
            </div>
          );
        }

        // Heading (**text** on its own line, or ## text)
        if (/^#{1,3}\s+/.test(line)) {
          const headingText = line.replace(/^#{1,3}\s+/, '');
          return (
            <div key={i} className="font-semibold text-palmkit-elements-textPrimary">
              {renderInline(headingText)}
            </div>
          );
        }

        // Regular paragraph
        return (
          <div key={i} className="text-palmkit-elements-textPrimary">
            {renderInline(line)}
          </div>
        );
      })}
    </div>
  );
});

SummaryMarkdown.displayName = 'SummaryMarkdown';

/*
 * ScreenshotRow — shows the actual screenshot the model captured, inline
 * in the stream. This is the "eye" the agent was missing. The user sees
 * EXACTLY what the model sees, and the model's visual reasoning follows
 * in a VisionRow.
 */
const ScreenshotRow = memo(({ dataUrl, viewport }: { dataUrl: string; viewport?: string }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-palmkit-elements-borderColor overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-palmkit-elements-background-depth-2 px-3 py-2 text-xs font-medium text-palmkit-elements-textSecondary hover:bg-palmkit-elements-background-depth-3"
      >
        <span className="i-ph:camera shrink-0" />
        <span>Screenshot{viewport ? ` (${viewport})` : ''}</span>
        <span
          className="ml-auto i-ph:caret-down shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {expanded && (
        <div className="bg-black/30 p-2">
          <img
            src={dataUrl}
            alt={`Preview screenshot${viewport ? ` (${viewport})` : ''}`}
            className="max-w-full rounded-md"
            style={{ maxHeight: '400px', objectFit: 'contain', margin: '0 auto', display: 'block' }}
          />
        </div>
      )}
    </div>
  );
});

ScreenshotRow.displayName = 'ScreenshotRow';

/*
 * VisionRow — the VLM's analysis of the screenshot. Shown as a distinct
 * "vision" row with an eye icon so the user can see the model's visual
 * reasoning: "The hero is centered, colors are consistent, but the headline
 * is clipped at the top."
 */
const VisionRow = memo(({ text }: { text: string }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 text-xs font-medium text-blue-300"
      >
        <span className="i-ph:eye shrink-0" />
        <span>Vision analysis</span>
        <span
          className="ml-auto i-ph:caret-down shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {expanded && (
        <div className="mt-2 text-xs leading-relaxed text-palmkit-elements-textSecondary whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
});

VisionRow.displayName = 'VisionRow';

/*
 * SubagentRow — shows a sub-agent's task and result inline.
 * When running: spinner + task description.
 * When done: collapsible with the sub-agent's findings.
 * When error: red warning with the error.
 */
const SubagentRow = memo(
  ({ task, result, status }: { task: string; result?: string; status: 'running' | 'done' | 'error' }) => {
    const [expanded, setExpanded] = useState(false);

    if (status === 'running') {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2.5 text-sm text-cyan-300">
          <span className="i-svg-spinners:90-ring-with-bg shrink-0" />
          <span className="truncate">Sub-agent: {task}</span>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-sm text-red-300">
          <span className="i-ph:warning-circle shrink-0" />
          <span className="truncate">Sub-agent failed: {task}</span>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-cyan-300"
        >
          <span className="i-ph:robot shrink-0" />
          <span className="truncate">Sub-agent: {task}</span>
          <span className="i-ph:check-circle-fill ml-auto shrink-0 text-green-400" />
          <span
            className="i-ph:caret-down shrink-0 transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
          />
        </button>
        {expanded && result && (
          <div className="border-t border-cyan-500/20 px-3 py-2 text-xs leading-relaxed text-palmkit-elements-textSecondary whitespace-pre-wrap">
            {result}
          </div>
        )}
      </div>
    );
  },
);

SubagentRow.displayName = 'SubagentRow';

/*
 * ImageRow — shows a generated image inline in the stream.
 * The user can see the image and decide if it's good enough, or
 * request changes in the next message.
 */
const ImageRow = memo(({ dataUrl, name, size }: { dataUrl: string; name: string; size?: number }) => {
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-emerald-300">
        <span className="i-ph:image shrink-0" />
        <span>Generated image: {name}</span>
        {size && <span className="text-emerald-400/60">({Math.round(size / 1024)}KB)</span>}
      </div>
      <div className="bg-black/30 p-2">
        <img
          src={dataUrl}
          alt={`Generated asset: ${name}`}
          className="max-w-full rounded-md"
          style={{ maxHeight: '300px', objectFit: 'contain', margin: '0 auto', display: 'block' }}
        />
      </div>
    </div>
  );
});

ImageRow.displayName = 'ImageRow';

/*
 * VideoRow — shows the video generation lifecycle inline. When ready,
 * embeds the actual MP4 so the user can preview the generated video asset.
 */
const VideoRow = memo(
  ({ name, url, status }: { name: string; url?: string; status: 'generating' | 'ready' | 'error' }) => {
    if (status === 'generating') {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/5 p-2.5 text-sm text-purple-300">
          <span className="i-svg-spinners:90-ring-with-bg shrink-0" />
          <span>Generating video "{name}"…</span>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-sm text-red-300">
          <span className="i-ph:warning-circle shrink-0" />
          <span>Video "{name}" failed — falling back to image</span>
        </div>
      );
    }

    return (
      <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-purple-300">
          <span className="i-ph:video shrink-0" />
          <span>Video "{name}" ready</span>
        </div>
        {url && (
          <div className="bg-black/30 p-2">
            <video
              src={url}
              autoPlay
              muted
              loop
              playsInline
              className="max-w-full rounded-md"
              style={{ maxHeight: '300px', margin: '0 auto', display: 'block' }}
            />
          </div>
        )}
      </div>
    );
  },
);

VideoRow.displayName = 'VideoRow';

/*
 * Render inline markdown: **bold**, `code`, and plain text.
 * Splits on a regex that captures the three patterns, then maps each piece
 * to the right React element.
 */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];

  // Match **bold**, `code`, or any other text
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token.startsWith('**')) {
      parts.push(
        <strong key={key++} className="font-semibold text-palmkit-elements-textPrimary">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-palmkit-elements-background-depth-3 px-1 py-0.5 font-mono text-xs text-palmkit-elements-textPrimary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

/* ── Row + section model ────────────────────────────────────────────────── */

interface TodoItem {
  text: string;
  status: 'pending' | 'in_progress' | 'done';
}

export type Row =
  | { kind: 'thinking'; text: string }
  | { kind: 'file'; path: string; lines?: number; chars?: number; changeKind?: string }
  | { kind: 'command'; text: string }
  | { kind: 'read'; text: string }
  | { kind: 'screenshot'; dataUrl: string; analysis?: string; viewport?: string }
  | { kind: 'vision'; text: string }
  | { kind: 'video'; url?: string; name: string; status: 'generating' | 'ready' | 'error' }
  | { kind: 'image'; dataUrl: string; name: string; size?: number }
  | { kind: 'subagent'; task: string; result?: string; status: 'running' | 'done' | 'error' }
  | { kind: 'thought'; text: string }
  | { kind: 'system'; text: string; icon?: string }
  | { kind: 'error'; text: string }
  | { kind: 'progress'; text: string }
  | { kind: 'summary'; text: string };

export interface Section {
  /** agent name, or 'System' for pre-agent / worker events */
  agent: string;
  role?: string;
  rows: Row[];
  todos?: TodoItem[];
  todoCounts?: { done: number; total: number };
  running: boolean;
  durationMs?: number;
  success?: boolean;
}

const AGENT_ICON: Record<string, string> = {
  Palmkit: 'i-ph:brain-bold',
  Brain: 'i-ph:brain-bold',
  Builder: 'i-ph:hammer-bold',
  Tester: 'i-ph:flask-bold',
  Researcher: 'i-ph:magnifying-glass-bold',
  System: 'i-ph:gear-six-bold',
};

const AGENT_ACCENT: Record<string, string> = {
  Palmkit: 'text-[var(--pk-accent)]',
  Brain: 'text-[var(--pk-accent)]',
  Builder: 'text-blue-400',
  Tester: 'text-purple-400',
  Researcher: 'text-amber-400',
  System: 'text-palmkit-elements-textTertiary',
};

/* Heartbeat / noise events we never render as their own row. */
function isHeartbeat(ev: WorkerEvent): boolean {
  const m = ev.message ?? '';
  return ev.type === 'file_chunk' && (/^⏳/.test(m) || /Building\.\.\./.test(m)) && !(ev.payload as any)?.command;
}

/**
 * Fold the ordered event log into agent sections with chronological rows.
 * Consecutive `reasoning` fragments are concatenated (they are token deltas)
 * and split into paragraphs on stepId changes.
 *
 * RADICAL STREAM REBUILD: No more "System" section. The stream opens
 * directly with the brain's first reasoning row — no empty gear-icon header,
 * no "Building your project..." banner. The brain IS the voice from the
 * first token. Worker plumbing events (planning_completed, file_generation_started,
 * validation_passed, upload_started, snapshot_uploaded, ready_for_preview) are
 * NOT rendered as visible rows — they're state-machine transitions, not chat
 * messages. Only the brain's reasoning, tool calls (write_file, run_shell),
 * and final summary are shown.
 *
 * Only the LAST `build_summary` event is rendered as a `summary` row —
 * earlier ones (from repair rounds or retry rounds) are skipped so the user
 * sees exactly one clean summary at the end, not duplicates.
 */
export function foldEvents(events: WorkerEvent[]): Section[] {
  const sections: Section[] = [];

  /*
   * LIVE STATUS — a single self-replacing "what is happening right now"
   * line. Heartbeats (⏳ Building… Ns) and agent_thinking events used to be
   * dropped entirely, so any silent stretch (model thinking, provider lag,
   * edit waiting for the previous build) showed the user NOTHING — measured
   * up to 735s of blank screen in production. Now they feed this status:
   * it renders as the section's last row ONLY while it is the most recent
   * signal, and disappears as soon as real rows resume.
   */
  let liveStatus: string | null = null;
  let liveStatusIsLast = false;

  /*
   * No initial "System" section. The first section is created when the first
   * `agent_started` event arrives (the brain starting). If events arrive
   * before any agent_started (rare — e.g. a job_failed with no agent), we
   * create a minimal "Worker" section on demand to host them.
   */
  let current: Section | null = null;

  /*
   * Pre-scan: find the seq of the LAST build_summary event. Only this one
   * will be rendered as a `summary` row; earlier build_summary events are
   * treated as no-ops (they were superseded by a later Builder run).
   */
  let lastBuildSummarySeq = -1;

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const p = (ev.payload ?? {}) as Record<string, any>;

    if (ev.type === 'file_chunk' && p.kind === 'build_summary' && p.isBuildSummary === true) {
      lastBuildSummarySeq = ev.seq;
      break;
    }
  }

  /*
   * reasoning accumulation state (per contiguous run), split by channel:
   * thoughtBuf = the model's thinking tokens; reasoningBuf = spoken narration.
   */
  let reasoningBuf = '';
  let reasoningStep: number | undefined;
  let thoughtBuf = '';

  /*
   * Ensure a section exists before pushing rows into it. If no agent has
   * started yet (no `agent_started` event), create a minimal "Worker"
   * section to host the row. This is rare — normally the brain's
   * `agent_started` arrives first.
   */
  const ensureSection = (): Section => {
    if (!current) {
      current = { agent: 'Worker', role: 'worker', rows: [], running: false };
      sections.push(current);
    }

    return current;
  };

  const flushReasoning = () => {
    /*
     * Thinking flushes BEFORE narration — chronologically the model thinks,
     * then speaks.
     */
    const thought = thoughtBuf.trim();

    if (thought) {
      ensureSection().rows.push({ kind: 'thought', text: thought });
    }

    thoughtBuf = '';

    const text = reasoningBuf.trim();

    if (text) {
      ensureSection().rows.push({ kind: 'thinking', text });
    }

    reasoningBuf = '';
    reasoningStep = undefined;
  };

  for (const ev of events) {
    if (isHeartbeat(ev)) {
      liveStatus = ev.message.replace(/^[⏳🧠]+\s*/u, '');
      liveStatusIsLast = true;
      continue;
    }

    const p = (ev.payload ?? {}) as Record<string, any>;

    /*
     * agent_thinking — the guaranteed pre-LLM signal ("processing your
     * request…") and the edit path's "waiting for the previous build…".
     */
    if (ev.type === 'file_chunk' && p.kind === 'agent_thinking') {
      liveStatus = ev.message.replace(/^[⏳🧠]+\s*/u, '');
      liveStatusIsLast = true;
      continue;
    }

    // Any other event supersedes the live status line.
    liveStatusIsLast = false;

    if (ev.type === 'reasoning') {
      const step = p.stepId as number | undefined;
      const text = (p.text as string | undefined) ?? '';

      // Channel split (S2): thinking accumulates separately from narration.
      if ((p.channel as string | undefined) === 'thinking') {
        thoughtBuf += text;
        continue;
      }

      // Narration arriving closes the thought that preceded it.
      if (thoughtBuf.trim()) {
        ensureSection().rows.push({ kind: 'thought', text: thoughtBuf.trim() });
        thoughtBuf = '';
      }

      if (reasoningBuf && step !== undefined && step !== reasoningStep) {
        reasoningBuf += '\n\n';
      }

      reasoningBuf += text;
      reasoningStep = step;
      continue;
    }

    /*
     * A non-reasoning event closes the current reasoning run — EXCEPT
     * todos_updated, which is not rendered as an inline row (it goes to
     * section.todos). The model often calls update_todos mid-sentence, so
     * flushing on it would split a single thought mid-word ("I'll buil" |
     * "d a simple app"). Skipping the flush keeps the thought contiguous.
     */
    if (ev.type !== 'todos_updated') {
      flushReasoning();
    }

    switch (ev.type) {
      case 'agent_started': {
        const agent = (p.agent as string) ?? 'Agent';
        current = { agent, role: (p.role as string) ?? agent, rows: [], running: true };
        sections.push(current);
        break;
      }
      case 'agent_completed': {
        if (!current) {
          break;
        }

        current.running = false;
        current.durationMs = (p.durationMs as number) ?? current.durationMs;
        current.success = (p.success as boolean) ?? true;
        break;
      }
      case 'todos_updated': {
        const sec = ensureSection();
        const todos = (p.todos as TodoItem[] | undefined) ?? [];
        sec.todos = todos;

        const counts = p.counts as { done: number; total: number } | undefined;
        sec.todoCounts = counts
          ? { done: counts.done, total: counts.total }
          : { done: todos.filter((t) => t.status === 'done').length, total: todos.length };
        break;
      }
      case 'file_written': {
        const sec = ensureSection();
        const path = (p.path as string) ?? (p.filePath as string) ?? ev.message;

        // dedupe: same path already listed in this section → skip
        const seen = sec.rows.some((r) => r.kind === 'file' && r.path === path);

        if (!seen) {
          sec.rows.push({
            kind: 'file',
            path,
            lines: p.lines as number | undefined,
            chars: (p.size as number | undefined) ?? (p.chars as number | undefined),
            changeKind: p.kind as string | undefined,
          });
        }

        break;
      }
      case 'file_chunk': {
        const m = ev.message ?? '';

        /*
         * RADICAL STREAM IMPROVEMENT — build_summary events carry the
         * Builder agent's final narration as the model's "response" to
         * the user. Render as a prominent, expanded summary section
         * (not a generic system row) so the user sees what was built,
         * the files created, key features, and tech stack — exactly like
         * Claude Code / Cursor / Super Z summarize their work.
         *
         * Only the LAST build_summary event is rendered — earlier ones
         * (from repair rounds or retries) are skipped to prevent
         * duplicate summary sections.
         */
        if (p.kind === 'build_summary' && p.text) {
          if (ev.seq === lastBuildSummarySeq) {
            ensureSection().rows.push({ kind: 'summary', text: p.text as string });
          }

          break;
        }

        /*
         * VISION — screenshot captured. The model took a screenshot of
         * the running preview AND it's shown inline so the user sees
         * exactly what the model sees. This is the "eyes" the agent was
         * missing before the radical rebuild.
         */
        if (p.kind === 'screenshot_captured' && p.dataUrl) {
          ensureSection().rows.push({
            kind: 'screenshot',
            dataUrl: p.dataUrl as string,
            viewport: p.viewport as string | undefined,
          });
          break;
        }

        /*
         * VISION — the VLM's analysis of the screenshot. Rendered as a
         * distinct "vision" row so the user can see the model's visual
         * reasoning: "The hero is centered, colors are consistent, but
         * the headline is clipped at the top."
         */
        if (p.kind === 'vision_analysis' && p.text) {
          ensureSection().rows.push({ kind: 'vision', text: p.text as string });
          break;
        }

        /*
         * VIDEO — generation lifecycle. Three states:
         *   - video_start: model is calling generate_video, show "generating"
         *   - video_ready: MP4 is ready, show inline with the URL
         *   - video_error: generation failed, show the error
         */
        if (p.kind === 'video_start' && p.name) {
          ensureSection().rows.push({ kind: 'video', name: p.name as string, status: 'generating' });
          break;
        }

        if (p.kind === 'video_ready' && p.name) {
          ensureSection().rows.push({
            kind: 'video',
            name: p.name as string,
            url: p.url as string | undefined,
            status: 'ready',
          });
          break;
        }

        if (p.kind === 'video_error' && p.name) {
          ensureSection().rows.push({ kind: 'video', name: p.name as string, status: 'error' });
          break;
        }

        /*
         * IMAGE — generated image shown inline for user visibility.
         * The user can see the image and request changes in the next message.
         */
        if (p.kind === 'image_ready' && p.dataUrl) {
          ensureSection().rows.push({
            kind: 'image',
            dataUrl: p.dataUrl as string,
            name: p.name as string,
            size: p.sizeBytes as number | undefined,
          });
          break;
        }

        /*
         * SUB-AGENT — the brain delegated a focused task to a sub-agent.
         * Shows the task being worked on and the result when done.
         */
        if (p.kind === 'subagent_start' && p.task) {
          ensureSection().rows.push({ kind: 'subagent', task: p.task as string, status: 'running' });
          break;
        }

        if (p.kind === 'subagent_complete' && p.task) {
          ensureSection().rows.push({
            kind: 'subagent',
            task: p.task as string,
            result: p.result as string | undefined,
            status: 'done',
          });
          break;
        }

        if (p.kind === 'subagent_error' && p.task) {
          ensureSection().rows.push({ kind: 'subagent', task: p.task as string, status: 'error' });
          break;
        }

        /*
         * Checkpoint (M1 git), salvaged completion, and stall-retry events —
         * short factual status lines the stream should show, previously
         * dropped by the fallback chain below.
         */
        if (p.kind === 'checkpoint' || p.kind === 'salvaged_success' || p.reason === 'stall_retry') {
          const icon =
            p.kind === 'checkpoint'
              ? 'i-ph:clock-counter-clockwise'
              : p.kind === 'salvaged_success'
                ? 'i-ph:check-circle'
                : 'i-ph:arrow-clockwise';
          ensureSection().rows.push({ kind: 'system', text: stripEmoji(m), icon });
          break;
        }

        if (/^🔧/.test(m) || /repair attempt/i.test(m)) {
          // Build-verification repair round kicking off.
          ensureSection().rows.push({ kind: 'system', text: stripEmoji(m), icon: 'i-ph:wrench' });
        } else if (/^⚠️/.test(m) || /Build still has errors/i.test(m)) {
          ensureSection().rows.push({ kind: 'error', text: stripEmoji(m) });
        } else if (p.command || /Run:/.test(m) || /^⚡/.test(m)) {
          ensureSection().rows.push({
            kind: 'command',
            text: stripEmoji((p.command as string) ?? m.replace(/^.*?Run:\s*/, '')),
          });
        } else if (/Read:/.test(m) || /^📖/.test(m)) {
          ensureSection().rows.push({ kind: 'read', text: stripEmoji(m) });
        } else if (/Screenshot/i.test(m) || /^📸/.test(m)) {
          /*
           * Don't render the text-only screenshot messages here — they're
           * either the old broken take_screenshot or the new analyze_screenshot
           * which emits its own screenshot_captured/vision_analysis events.
           * Skip to avoid duplicate rows.
           */
          break;
        }

        break;
      }
      case 'job_failed':
      case 'validation_failed':
      case 'build_check_failed': {
        /*
         * Cancel messages (from the orchestrator's cancel path) use
         * "Build cancelled by user" — these are NOT errors. Render them as
         * 'system' rows (neutral), not 'error' rows (red). The failure card
         * below also checks for cancel vs real failure.
         */
        const sec = ensureSection();

        if (ev.message.includes('cancelled by user') || ev.message.includes('saving partial state')) {
          sec.rows.push({ kind: 'system', text: stripEmoji(ev.message), icon: 'i-ph:hand-palm' });
        } else {
          sec.rows.push({ kind: 'error', text: stripEmoji(ev.message) });
        }

        break;
      }

      /*
       * Worker plumbing events — NOT rendered as visible rows. These are
       * state-machine transitions (planning_completed, file_generation_started,
       * validation_passed, upload_started, snapshot_uploaded, ready_for_preview).
       * The brain's own reasoning, tool calls, and done() summary are the
       * chat-stream voice; these events are silent state changes the front-end
       * state machine consumes via useExternalWorker's pollJob (which reads
       * `data.status` directly, not these events).
       *
       * The messages are also now empty strings (set in job-processor.ts), so
       * even if we did render them, they'd be empty rows. Skipping them
       * entirely keeps the stream clean.
       */
      case 'planning_started':
      case 'planning_completed':
      case 'file_generation_started':
      case 'file_generation_completed':
      case 'validation_passed':
      case 'upload_started':
      case 'snapshot_uploaded':
      case 'edit_completed':
      case 'ready_for_preview':
      case 'edit_started':
        break;

      /*
       * Edit heartbeat — was a periodic "Building…" ping. Now skipped: the
       * brain's reasoning events stream live, so there's no frozen window to
       * bridge. Empty messages are also dropped here as a safety net.
       */
      case 'edit_progress': {
        if (!ev.message || !ev.message.trim()) {
          break;
        }

        const sec = ensureSection();
        const rows = sec.rows;
        const last = rows[rows.length - 1];

        if (last && last.kind === 'progress') {
          // Replace the previous heartbeat so we don't stack one per ping.
          rows[rows.length - 1] = { kind: 'progress', text: ev.message };
        } else {
          rows.push({ kind: 'progress', text: ev.message });
        }

        break;
      }
      default:
        break;
    }
  }

  flushReasoning();

  /*
   * If the newest signal is a heartbeat / agent_thinking, surface it as the
   * live status row at the end of the stream (spinner + text). It vanishes
   * automatically once any real row supersedes it on the next fold.
   */
  if (liveStatusIsLast && liveStatus) {
    ensureSection().rows.push({ kind: 'progress', text: liveStatus });
  }

  /*
   * Drop any sections that ended up with zero rows AND zero todos — they
   * would render as empty headers (the old "System" gear-icon bug). With
   * the new no-initial-section design this is mostly a safety net, but it
   * also catches the rare case where an agent_started arrived but the agent
   * produced nothing renderable before completing.
   */
  return sections.filter((s) => s.rows.length > 0 || (s.todos && s.todos.length > 0));
}

/* ── Presentational pieces ──────────────────────────────────────────────── */

/*
 * The model's reasoning/narration — the "thinking" and explanation of what it's
 * doing. Shown EXPANDED by default so the build reads like a conversation (the
 * agent talking through its work), not a hidden line. Long runs can be folded by
 * tapping; very long ones start folded so a single huge thought doesn't dominate.
 */
const Thinking = memo(({ text }: { text: string }) => {
  const [open, setOpen] = useState(text.length <= 800);
  const preview = text.length > 300 ? `${text.slice(0, 300)}…` : text;

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 rounded-lg bg-palmkit-elements-background-depth-2/50 px-2.5 py-2 text-left transition-colors hover:bg-palmkit-elements-background-depth-2"
      >
        <span className="i-ph:brain mt-0.5 shrink-0 text-[var(--pk-accent)] opacity-60" />
        <span
          className={classNames(
            'whitespace-pre-wrap text-sm leading-relaxed text-palmkit-elements-textSecondary',
            open ? '' : 'line-clamp-3',
          )}
        >
          {open ? text : preview}
        </span>
        {text.length > 800 && (
          <span
            className={classNames(
              'ml-auto shrink-0 text-xs text-palmkit-elements-textTertiary transition-transform',
              open ? 'i-ph:caret-up' : 'i-ph:caret-down',
            )}
          />
        )}
      </button>
    </div>
  );
});

function ext(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');

  return dot > 0 ? base.slice(dot + 1) : '';
}

const FILE_ICON: Record<string, string> = {
  tsx: 'i-ph:file-tsx',
  ts: 'i-ph:file-ts',
  jsx: 'i-ph:file-jsx',
  js: 'i-ph:file-js',
  css: 'i-ph:file-css',
  html: 'i-ph:file-html',
  json: 'i-ph:brackets-curly',
  md: 'i-ph:file-text',
  vue: 'i-ph:file-vue',
};

const FileRow = memo(({ row }: { row: Extract<Row, { kind: 'file' }> }) => {
  const deleted = row.changeKind === 'delete';
  const edited = row.changeKind === 'edit';

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={classNames(
          'shrink-0',
          deleted
            ? 'i-ph:file-x text-red-400'
            : edited
              ? 'i-ph:pencil-simple text-amber-400'
              : 'i-ph:file-plus text-green-400',
        )}
      />
      <span
        className={classNames('shrink-0 text-palmkit-elements-textTertiary', FILE_ICON[ext(row.path)] ?? 'i-ph:file')}
      />
      <span className="truncate font-mono text-palmkit-elements-textPrimary">{row.path}</span>
      {(row.lines || row.chars) && (
        <span className="ml-auto shrink-0 text-xs text-palmkit-elements-textTertiary tabular-nums">
          {row.lines ? `${row.lines}L` : ''}
          {row.lines && row.chars ? ' · ' : ''}
          {row.chars ? `${row.chars}B` : ''}
        </span>
      )}
    </div>
  );
});

const CommandRow = memo(({ text }: { text: string }) => (
  <div className="flex items-start gap-2 rounded-md bg-palmkit-elements-background-depth-2/40 px-2 py-1.5 font-mono text-sm">
    <span className="i-ph:terminal-window mt-0.5 shrink-0 text-green-400/70" />
    <span className="break-all text-palmkit-elements-textSecondary">
      <span className="text-green-400">$ </span>
      {text}
    </span>
  </div>
));

/*
 * RADICAL STREAM IMPROVEMENT — the model's final build summary, rendered as
 * a prominent expanded section at the end of the Builder's timeline.
 *
 * This is the Builder agent's own narration of what it built: the files
 * created, key features, and tech stack. It mirrors how Claude Code / Cursor /
 * Super Z summarize their work at the end of a build — a real response, not
 * a system event row.
 *
 * Always expanded (no truncation), with a subtle accent border so it stands
 * apart from the per-file commentary above it. Renders markdown (bold, lists,
 * code) via the existing Markdown component so **What was created:** shows as
 * a real heading, not literal asterisks.
 */
const SummaryRow = memo(({ text }: { text: string }) => {
  const cleaned = text.trim();

  return (
    <div
      className="mt-3 rounded-lg border p-3.5"
      style={{
        borderColor: 'color-mix(in srgb, var(--pk-accent) 30%, transparent)',
        background: 'color-mix(in srgb, var(--pk-accent) 6%, transparent)',
      }}
    >
      <div
        className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--pk-accent)' }}
      >
        <span className="i-ph:sparkle-bold" />
        <span>Build summary</span>
      </div>
      <div className="text-sm leading-relaxed text-palmkit-elements-textPrimary">
        <SummaryMarkdown text={cleaned} />
      </div>
    </div>
  );
});

SummaryRow.displayName = 'SummaryRow';

const Todos = memo(({ todos, counts }: { todos: TodoItem[]; counts?: { done: number; total: number } }) => (
  <div className="rounded-md border border-palmkit-elements-borderColor/60 bg-palmkit-elements-background-depth-3/40 p-2">
    <div className="mb-1 flex items-center gap-1.5 text-xs text-palmkit-elements-textTertiary">
      <span className="i-ph:list-checks" />
      <span>Plan {counts ? `(${counts.done}/${counts.total})` : ''}</span>
    </div>
    <ul className="space-y-0.5">
      {todos.map((t, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          {t.status === 'in_progress' ? (
            <PalmkitLoader bare size={12} className="shrink-0 text-[var(--pk-accent)]" />
          ) : (
            <span
              className={classNames(
                'shrink-0 text-[13px]',
                t.status === 'done'
                  ? 'i-ph:check-circle-fill text-green-400'
                  : 'i-ph:circle text-palmkit-elements-textTertiary',
              )}
            />
          )}
          <span
            className={classNames(
              t.status === 'done'
                ? 'text-palmkit-elements-textTertiary line-through'
                : t.status === 'in_progress'
                  ? 'text-palmkit-elements-textPrimary'
                  : 'text-palmkit-elements-textSecondary',
            )}
          >
            {t.text}
          </span>
        </li>
      ))}
    </ul>
  </div>
));

/**
 * Human, phase-aware label for the live header — mirrors how coding agents show
 * their current stage ("Planning…", "Verifying build…") instead of a single
 * static "Building…". Falls back to "Building…" for unknown/empty steps.
 */
function phaseLabel(step: string): string {
  switch (step) {
    case 'queued':
      return 'Preparing…';
    case 'plan':
    case 'planning':
      return 'Planning…';
    case 'generate':
    case 'file_generation':
      return 'Building…';
    case 'validate':
      return 'Validating…';
    case 'build_check':
      return 'Verifying build…';
    case 'uploading':
      return 'Finalizing…';
    default:
      return 'Building…';
  }
}

function fmtDur(ms?: number): string {
  if (!ms) {
    return '';
  }

  const s = Math.round(ms / 1000);

  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

const SectionView = memo(({ section }: { section: Section }) => {
  const accent = AGENT_ACCENT[section.agent] ?? 'text-palmkit-elements-textSecondary';
  const icon = AGENT_ICON[section.agent] ?? 'i-ph:robot';

  /*
   * RADICAL REBUILD: the stream shows a clean continuous timeline. The
   * agent section header is shown as a SUBTLE badge (small icon + name +
   * duration) only when the section has content — NOT as a big divider.
   * This gives context (which agent is acting) without making the stream
   * look like a segmented pipeline. The rows flow continuously below.
   */
  const hasRows = section.rows.length > 0 || (section.todos && section.todos.length > 0);

  return (
    <div className="relative">
      {hasRows && (
        <div className="flex items-center gap-1.5 mb-1.5 text-xs">
          <span className={classNames('shrink-0 text-[13px]', icon, accent)} />
          <span className={classNames('font-medium', accent)}>{section.agent}</span>
          {section.running ? (
            <PalmkitLoader bare size={10} className="text-[var(--pk-accent)]" />
          ) : (
            <span className="flex items-center gap-0.5 text-palmkit-elements-textTertiary">
              <span
                className={classNames(
                  'text-[11px]',
                  section.success === false
                    ? 'i-ph:x-circle-fill text-red-400'
                    : 'i-ph:check-circle-fill text-green-400',
                )}
              />
              {fmtDur(section.durationMs) && <span className="tabular-nums">{fmtDur(section.durationMs)}</span>}
            </span>
          )}
        </div>
      )}
      <div className="relative pl-5 space-y-1.5 pb-3">
        {/* timeline rail */}
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-palmkit-elements-borderColor/40" />
        {section.rows.map((row, i) => {
          const inner = (() => {
            switch (row.kind) {
              case 'thinking':
                return <Thinking key={i} text={row.text} />;
              case 'file':
                return <FileRow key={i} row={row} />;
              case 'command':
                return <CommandRow key={i} text={row.text} />;
              case 'summary':
                return <SummaryRow key={i} text={row.text} />;
              case 'screenshot':
                return <ScreenshotRow key={i} dataUrl={row.dataUrl} viewport={row.viewport} />;
              case 'vision':
                return <VisionRow key={i} text={row.text} />;
              case 'video':
                return <VideoRow key={i} name={row.name} url={row.url} status={row.status} />;
              case 'image':
                return <ImageRow key={i} dataUrl={row.dataUrl} name={row.name} size={row.size} />;
              case 'subagent':
                return <SubagentRow key={i} task={row.task} result={row.result} status={row.status} />;
              case 'read':
                return (
                  <div key={i} className="flex items-center gap-2 font-mono text-sm text-palmkit-elements-textTertiary">
                    <span className="i-ph:eye shrink-0" />
                    <span className="truncate">{row.text}</span>
                  </div>
                );
              case 'error':
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300"
                  >
                    <span className="i-ph:warning-circle mt-0.5 shrink-0" />
                    <span className="whitespace-pre-wrap">{row.text}</span>
                  </div>
                );
              case 'system':
                return (
                  <div key={i} className="flex items-center gap-2 text-xs text-palmkit-elements-textTertiary">
                    <span className="i-ph:dot-outline-fill shrink-0" />
                    <span>{row.text}</span>
                  </div>
                );
              case 'progress':
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-palmkit-elements-textTertiary animate-pulse"
                  >
                    <span className="i-svg-spinners:90-ring-with-bg shrink-0 text-sm" />
                    <span>{row.text}</span>
                  </div>
                );
              default:
                return null;
            }
          })();

          if (!inner) {
            return null;
          }

          // Gentle entrance for newly appended rows (M2 stream polish).
          return (
            <div key={i} className="pk-row-in">
              {inner}
            </div>
          );
        })}
        {section.todos && section.todos.length > 0 && <Todos todos={section.todos} counts={section.todoCounts} />}
      </div>
    </div>
  );
});

/* ── Public component ───────────────────────────────────────────────────── */

/**
 * Presentational timeline — renders any event log + progress. Both the live
 * global BuildStream and the per-turn TurnBuildStream (past builds) delegate
 * here, so a completed turn's stream looks identical to the live one.
 *
 * `collapsible` renders a header toggle (used for past turns, collapsed by
 * default so the thread stays scannable; the live stream is always expanded).
 */
export const BuildStreamView = memo(
  ({
    events,
    progress,
    currentStep,
    defaultOpen = true,
    past = false,
  }: {
    events: WorkerEvent[];
    progress: number;
    currentStep: string;
    defaultOpen?: boolean;

    /**
     * A PAST turn (a finished build earlier in the thread) — rendered as a
     * collapsible one-line summary so the thread stays scannable, exactly like a
     * coding chat folds an old "Worked for 36s ›". The LIVE turn is never
     * collapsible: it flows openly as the assistant's current reply.
     */
    past?: boolean;
  }) => {
    const [open, setOpen] = useState(defaultOpen);
    const live = useStore(liveStreamStore);
    const sections = useMemo(() => {
      const folded = foldEvents(events);

      /*
       * De-duplicate status strips: while the LIVE layer is speaking
       * (thinking/text/tool streaming), the folded heartbeat row ("Building…
       * Ns") is redundant noise — the header already shows the phase and the
       * live layer shows the substance. Drop trailing progress rows then.
       */
      const liveSpeaking = live.active && (live.thinking || live.text || live.tool);

      if (liveSpeaking && folded.length > 0) {
        const last = folded[folded.length - 1];

        while (last.rows.length > 0 && last.rows[last.rows.length - 1].kind === 'progress') {
          last.rows.pop();
        }
      }

      return folded;
    }, [events, live.active, live.thinking, live.text, live.tool]);

    const done = currentStep === 'done' || events.some((e) => e.type === 'ready_for_preview');

    /*
     * If the build reached ready_for_preview AFTER a cancel (the worker
     * completed in the background), DON'T show the cancel/failure card —
     * the build succeeded. The cancel event is stale; the completion
     * supersedes it. Without this, the user sees "Build stopped" even
     * though the logs show "Build complete" and "Preview ready" — confusing.
     */
    const buildCompletedAfterCancel = done && events.some((e) => e.type === 'ready_for_preview');

    const failed = !buildCompletedAfterCancel && events.some((e) => e.type === 'job_failed');

    /*
     * Is this a user-initiated cancel (not a real failure)? The orchestrator
     * emits 'job_failed' with "cancelled by user" for cancels — we detect it
     * here so the failure card shows a neutral "Build stopped" instead of a
     * scary red "Build failed". The user CHOSE to stop — no error to fix.
     *
     * BUT: if the build completed after the cancel (ready_for_preview arrived),
     * we treat it as done, not cancelled — the cancel is stale.
     */
    const cancelEvent = buildCompletedAfterCancel
      ? undefined
      : [...events]
          .reverse()
          .find(
            (e) =>
              e.type === 'job_failed' &&
              (e.message.includes('cancelled by user') || e.message.includes('saving partial state')),
          );
    const isCancelled = Boolean(cancelEvent);

    if (events.length === 0 && progress === 0) {
      return null;
    }

    // Human-readable failure reason for the unified failure card.
    const failureReason = (() => {
      const fail = [...events].reverse().find((e) => e.type === 'job_failed');
      const msg = stripEmoji(fail?.message ?? '');

      return msg.length > 0 ? msg : null;
    })();

    // Did `npm run build` actually pass? Read the last completion event's flag.
    const buildVerified = (() => {
      for (let i = events.length - 1; i >= 0; i--) {
        const pl = events[i].payload as Record<string, unknown> | undefined;

        if (events[i].type === 'file_generation_completed' && pl && 'buildVerified' in pl) {
          return pl.buildVerified as boolean | null;
        }
      }
      return null;
    })();
    const hasBuildErrors = buildVerified === false;
    const fileCount = new Set(
      events
        .filter((e) => e.type === 'file_written')
        .map((e) => (e.payload as any)?.path ?? (e.payload as any)?.filePath ?? e.message),
    ).size;
    const displayProgress = done ? 100 : Math.max(progress, 5);

    /*
     * The most recent action — shown as a live monospace tail in the header
     * while building (e.g. "Writing App.tsx", "$ npm run build", "Read App.jsx"),
     * the way Le Chat/Cursor show the current step next to "Working". Scans the
     * folded sections from the end for the latest meaningful row.
     */
    const lastAction = (() => {
      for (let i = sections.length - 1; i >= 0; i--) {
        const rows = sections[i].rows;

        for (let j = rows.length - 1; j >= 0; j--) {
          const r = rows[j];

          if (r.kind === 'file') {
            const verb = r.changeKind === 'delete' ? 'Deleting' : r.changeKind === 'edit' ? 'Editing' : 'Writing';
            return `${verb} ${r.path.split('/').pop()}`;
          }

          if (r.kind === 'command') {
            return `$ ${r.text}`;
          }

          if (r.kind === 'read' || r.kind === 'system') {
            return r.text;
          }

          if (r.kind === 'thinking') {
            return 'Thinking…';
          }
        }
      }

      return currentStep === 'queued' ? 'Preparing…' : 'Working…';
    })();

    // Total agent time, for the "· Worked for Xs" summary once the build ends.
    const totalMs = sections.reduce((sum, sec) => sum + (sec.durationMs ?? 0), 0);

    // Only PAST turns fold; the live turn always flows open as the current reply.
    const toggle = () => setOpen((o) => !o);
    const showBody = past ? open : true;

    const statusLabel = failed
      ? 'Build failed'
      : done && hasBuildErrors
        ? 'Build has errors'
        : done && buildVerified === true
          ? 'Build verified'
          : done
            ? 'Build complete'
            : phaseLabel(currentStep);

    const summary = done
      ? [totalMs > 0 ? `Worked for ${fmtDur(totalMs)}` : '', fileCount > 0 ? `${fileCount} files` : '']
          .filter(Boolean)
          .join(' · ')
      : fileCount > 0
        ? `${fileCount} files`
        : '';

    /*
     * No card, no box — the build IS the assistant's turn, so it flows directly
     * in the conversation: a slim status line, then the reasoning + tool rows.
     * The status icon (loader / ✓ / ✗) is the only chrome; past turns get a
     * caret to fold, the live turn never does.
     */
    return (
      <div className="mb-5">
        <div
          className={classNames('flex items-center gap-2', past && 'cursor-pointer select-none')}
          onClick={past ? toggle : undefined}
        >
          {failed || done ? (
            <span
              className={classNames(
                'shrink-0',
                failed
                  ? 'i-ph:x-circle-fill text-red-400'
                  : hasBuildErrors
                    ? 'i-ph:warning-fill text-amber-400'
                    : 'i-ph:check-circle-fill text-green-400',
              )}
            />
          ) : (
            <PalmkitLoader bare size={15} className="shrink-0 text-[var(--pk-accent)]" />
          )}
          <span className="text-sm font-medium text-palmkit-elements-textPrimary">{statusLabel}</span>
          {/* live action tail while building (Le Chat style) */}
          {!done && !failed && (
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-palmkit-elements-textTertiary">
              {lastAction}
            </span>
          )}
          {summary && (
            <span
              className={classNames('shrink-0 text-xs text-palmkit-elements-textTertiary tabular-nums', {
                'ml-auto': done || failed,
              })}
            >
              {summary}
            </span>
          )}
          {past && (
            <span
              className={classNames(
                'shrink-0 text-palmkit-elements-textTertiary transition-transform',
                open ? 'i-ph:caret-up' : 'i-ph:caret-down',
              )}
            />
          )}
        </div>

        {/* progress bar while building — smooth gradient */}
        {!done && !failed && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-palmkit-elements-borderColor/30">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--pk-accent)] to-[var(--pk-accent)] transition-all duration-700 ease-out"
              style={{ width: `${displayProgress}%`, opacity: 0.8 }}
            />
          </div>
        )}

        {/* Unified failure/cancel alert — different styling for cancel vs real failure. */}
        {failed && (
          <div
            className={classNames(
              'mt-3 rounded-lg border px-3.5 py-3',
              isCancelled ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5',
            )}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={classNames(
                  'text-base shrink-0 mt-0.5',
                  isCancelled ? 'i-ph:pause-circle-fill text-amber-400' : 'i-ph:warning-circle-fill text-red-400',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-palmkit-elements-textPrimary">
                  {isCancelled ? 'Build stopped' : 'Build failed'}
                </p>
                <p className="mt-0.5 text-xs text-palmkit-elements-textSecondary break-words">
                  {isCancelled
                    ? 'You stopped this build. Partial files were saved — your next message will continue from here.'
                    : (failureReason ?? 'Something went wrong while building. You can retry or open the logs.')}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  {!isCancelled && (
                    <button
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('palmkit:retry-build'))}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all active:scale-95"
                      style={{ background: 'var(--pk-accent)', color: 'var(--pk-on-accent)' }}
                    >
                      <span className="i-ph:arrow-clockwise text-sm" />
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-palmkit-elements-borderColor px-3 py-1.5 text-xs font-medium text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
                  >
                    <span className="i-ph:list-magnifying-glass text-sm" />
                    Show logs
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* the reasoning + tool rows, flowing as the reply (no box) */}
        {showBody && (
          <div className="mt-3">
            <style>{STREAM_STYLES}</style>
            {sections.map((s, i) => (
              <SectionView key={i} section={s} />
            ))}
            {/* M2: instant layer — in-flight model text + current tool chip */}
            {!past && !done && !failed && <LiveTail />}
            {!past && !done && !failed && <StreamScrollPin depsA={events.length} />}
          </div>
        )}
      </div>
    );
  },
);

/*
 * StreamScrollPin — smart follow-the-stream scrolling. A zero-height
 * sentinel at the stream's end: while the user is near the bottom of the
 * scroll container, every new row / live delta keeps the view pinned to
 * the latest content; the moment they scroll up to read, we stop pulling
 * them down. No layout cost, no scroll hijacking.
 */
const StreamScrollPin = memo(({ depsA }: { depsA: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const live = useStore(liveStreamStore);

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    // Find the nearest scrollable ancestor (the chat scroller).
    let parent: HTMLElement | null = el.parentElement;

    while (parent) {
      const style = window.getComputedStyle(parent);

      if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
        break;
      }

      parent = parent.parentElement;
    }

    const scroller = parent ?? document.scrollingElement;

    if (!scroller) {
      return;
    }

    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;

    // Pinned = within ~160px of the bottom. Otherwise the user is reading.
    if (distanceFromBottom < 160) {
      el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }, [depsA, live.updatedAt]);

  return <div ref={ref} className="h-0" />;
});

StreamScrollPin.displayName = 'StreamScrollPin';

BuildStreamView.displayName = 'BuildStreamView';

export const BuildStream = memo(() => {
  const events = useStore(workerEventsStore);
  const { progress, currentStep } = useStore(workerProgressStore);

  return <BuildStreamView events={events} progress={progress} currentStep={currentStep} />;
});

BuildStream.displayName = 'BuildStream';
Thinking.displayName = 'Thinking';
FileRow.displayName = 'FileRow';
CommandRow.displayName = 'CommandRow';
Todos.displayName = 'Todos';
SectionView.displayName = 'SectionView';
