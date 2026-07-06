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
import { memo, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workerEventsStore, workerProgressStore, type WorkerEvent } from '~/lib/stores/build-status';
import { classNames } from '~/utils/classNames';
import { PalmkitLoader } from '~/components/ui/PalmkitLoader';

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

type Row =
  | { kind: 'thinking'; text: string }
  | { kind: 'file'; path: string; lines?: number; chars?: number; changeKind?: string }
  | { kind: 'command'; text: string }
  | { kind: 'read'; text: string }
  | { kind: 'screenshot'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'progress'; text: string }
  | { kind: 'summary'; text: string };

interface Section {
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
  Builder: 'i-ph:hammer-bold',
  Tester: 'i-ph:flask-bold',
  Researcher: 'i-ph:magnifying-glass-bold',
  System: 'i-ph:gear-six-bold',
};

const AGENT_ACCENT: Record<string, string> = {
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
 * RADICAL STREAM IMPROVEMENT: only the LAST `build_summary` event is rendered
 * as a `summary` row — earlier ones (from repair rounds or retry rounds) are
 * skipped so the user sees exactly one clean summary at the end, not duplicates.
 */
function foldEvents(events: WorkerEvent[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { agent: 'System', role: 'system', rows: [], running: false };
  sections.push(current);

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

  // reasoning accumulation state (per contiguous run)
  let reasoningBuf = '';
  let reasoningStep: number | undefined;

  const flushReasoning = () => {
    const text = reasoningBuf.trim();

    if (text) {
      current.rows.push({ kind: 'thinking', text });
    }

    reasoningBuf = '';
    reasoningStep = undefined;
  };

  for (const ev of events) {
    if (isHeartbeat(ev)) {
      continue;
    }

    const p = (ev.payload ?? {}) as Record<string, any>;

    if (ev.type === 'reasoning') {
      const step = p.stepId as number | undefined;
      const text = (p.text as string | undefined) ?? '';

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
        current.running = false;
        current.durationMs = (p.durationMs as number) ?? current.durationMs;
        current.success = (p.success as boolean) ?? true;
        break;
      }
      case 'todos_updated': {
        const todos = (p.todos as TodoItem[] | undefined) ?? [];
        current.todos = todos;

        const counts = p.counts as { done: number; total: number } | undefined;
        current.todoCounts = counts
          ? { done: counts.done, total: counts.total }
          : { done: todos.filter((t) => t.status === 'done').length, total: todos.length };
        break;
      }
      case 'file_written': {
        const path = (p.path as string) ?? (p.filePath as string) ?? ev.message;

        // dedupe: same path already listed in this section → skip
        const seen = current.rows.some((r) => r.kind === 'file' && r.path === path);

        if (!seen) {
          current.rows.push({
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
            current.rows.push({ kind: 'summary', text: p.text as string });
          }

          break;
        }

        if (/^🔧/.test(m) || /repair attempt/i.test(m)) {
          // Build-verification repair round kicking off.
          current.rows.push({ kind: 'system', text: m.replace(/^🔧\s*/, '') });
        } else if (/^⚠️/.test(m) || /Build still has errors/i.test(m)) {
          current.rows.push({ kind: 'error', text: m.replace(/^⚠️\s*/, '') });
        } else if (p.command || /Run:/.test(m) || /^⚡/.test(m)) {
          current.rows.push({
            kind: 'command',
            text: (p.command as string) ?? m.replace(/^.*?Run:\s*/, '').replace(/^⚡\s*/, ''),
          });
        } else if (/Read:/.test(m) || /^📖/.test(m)) {
          current.rows.push({ kind: 'read', text: m.replace(/^📖\s*/, '') });
        } else if (/Screenshot/i.test(m) || /^📸/.test(m)) {
          current.rows.push({ kind: 'screenshot', text: m.replace(/^📸\s*/, '') });
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
        if (ev.message.includes('cancelled by user') || ev.message.includes('saving partial state')) {
          current.rows.push({ kind: 'system', text: ev.message });
        } else {
          current.rows.push({ kind: 'error', text: ev.message });
        }

        break;
      }
      case 'planning_started':
      case 'planning_completed':
      case 'file_generation_started':
      case 'file_generation_completed':
      case 'validation_passed':
      case 'upload_started':
      case 'snapshot_uploaded':
      case 'edit_completed':
      case 'ready_for_preview': {
        current.rows.push({ kind: 'system', text: ev.message });
        break;
      }

      /*
       * Edit heartbeat — generateEdit is one synchronous LLM call (no file
       * streaming), so without these periodic "still working…" pings the chat
       * would look frozen for the whole edit window. Render the heartbeat as a
       * subtle progress line (not a new section) so it doesn't clutter the log.
       */
      case 'edit_progress': {
        const rows = current.rows;
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

  // Drop the leading System section if it ended up empty.
  return sections.filter((s, i) => !(i === 0 && s.rows.length === 0));
}

/* ── Presentational pieces ──────────────────────────────────────────────── */

/*
 * The model's reasoning/narration — the "thinking" and explanation of what it's
 * doing. Shown EXPANDED by default so the build reads like a conversation (the
 * agent talking through its work), not a hidden line. Long runs can be folded by
 * tapping; very long ones start folded so a single huge thought doesn't dominate.
 */
const Thinking = memo(({ text }: { text: string }) => {
  const [open, setOpen] = useState(text.length <= 1200);
  const preview = text.length > 220 ? `${text.slice(0, 220)}…` : text;

  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className="group flex w-full items-start gap-2 bg-transparent text-left"
    >
      <span className="i-ph:brain mt-0.5 shrink-0 text-palmkit-elements-textTertiary" />
      <span
        className={classNames(
          'whitespace-pre-wrap text-sm leading-relaxed text-palmkit-elements-textSecondary',
          open ? '' : 'line-clamp-2',
        )}
      >
        {open ? text : preview}
      </span>
    </button>
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
  <div className="flex items-start gap-2 font-mono text-sm">
    <span className="i-ph:terminal-window mt-0.5 shrink-0 text-palmkit-elements-textTertiary" />
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

  return (
    <div className="relative pl-5">
      {/* timeline rail */}
      <div className="absolute left-[7px] top-6 bottom-0 w-px bg-palmkit-elements-borderColor/60" />
      <div className="mb-2 flex items-center gap-2">
        <span className={classNames('z-10 -ml-5 shrink-0', icon, accent)} />
        <span className={classNames('text-sm font-medium', accent)}>{section.agent}</span>
        {section.running ? (
          <PalmkitLoader bare size={12} className="text-[var(--pk-accent)]" />
        ) : (
          <span className="flex items-center gap-1 text-xs text-palmkit-elements-textTertiary">
            <span
              className={classNames(
                section.success === false ? 'i-ph:x-circle-fill text-red-400' : 'i-ph:check-circle-fill text-green-400',
              )}
            />
            {fmtDur(section.durationMs)}
          </span>
        )}
      </div>
      <div className="space-y-1.5 pb-4">
        {section.rows.map((row, i) => {
          switch (row.kind) {
            case 'thinking':
              return <Thinking key={i} text={row.text} />;
            case 'file':
              return <FileRow key={i} row={row} />;
            case 'command':
              return <CommandRow key={i} text={row.text} />;
            case 'summary':
              return <SummaryRow key={i} text={row.text} />;
            case 'read':
              return (
                <div key={i} className="flex items-center gap-2 font-mono text-sm text-palmkit-elements-textTertiary">
                  <span className="i-ph:eye shrink-0" />
                  <span className="truncate">{row.text}</span>
                </div>
              );
            case 'screenshot':
              return (
                <div key={i} className="flex items-center gap-2 text-sm text-palmkit-elements-textTertiary">
                  <span className="i-ph:camera shrink-0" />
                  <span>{row.text}</span>
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
    const sections = useMemo(() => foldEvents(events), [events]);

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
      const msg = (fail?.message ?? '').replace(/^[❌⚠️\s]+/, '').trim();

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

        {/* a hair-thin progress line under the status while building */}
        {!done && !failed && (
          <div className="mt-2 h-px w-full overflow-hidden bg-palmkit-elements-borderColor/50">
            <div
              className="h-full bg-[var(--pk-accent)] transition-all duration-700 ease-out"
              style={{ width: `${displayProgress}%` }}
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
            {sections.map((s, i) => (
              <SectionView key={i} section={s} />
            ))}
          </div>
        )}
      </div>
    );
  },
);

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
