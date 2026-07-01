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
  | { kind: 'error'; text: string };

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
 */
function foldEvents(events: WorkerEvent[]): Section[] {
  const sections: Section[] = [];
  let current: Section = { agent: 'System', role: 'system', rows: [], running: false };
  sections.push(current);

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
        current.rows.push({ kind: 'error', text: ev.message });
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
      default:
        break;
    }
  }

  flushReasoning();

  // Drop the leading System section if it ended up empty.
  return sections.filter((s, i) => !(i === 0 && s.rows.length === 0));
}

/* ── Presentational pieces ──────────────────────────────────────────────── */

const Thinking = memo(({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const preview = text.length > 140 ? `${text.slice(0, 140)}…` : text;

  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className="group flex w-full items-start gap-2 bg-transparent text-left"
    >
      <span className="i-ph:brain mt-0.5 shrink-0 text-palmkit-elements-textTertiary" />
      <span
        className={classNames(
          'text-sm leading-relaxed text-palmkit-elements-textSecondary italic whitespace-pre-wrap',
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

const Todos = memo(({ todos, counts }: { todos: TodoItem[]; counts?: { done: number; total: number } }) => (
  <div className="rounded-md border border-palmkit-elements-borderColor/60 bg-palmkit-elements-bg-depth-3/40 p-2">
    <div className="mb-1 flex items-center gap-1.5 text-xs text-palmkit-elements-textTertiary">
      <span className="i-ph:list-checks" />
      <span>Plan {counts ? `(${counts.done}/${counts.total})` : ''}</span>
    </div>
    <ul className="space-y-0.5">
      {todos.map((t, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span
            className={classNames(
              'shrink-0 text-[13px]',
              t.status === 'done'
                ? 'i-ph:check-circle-fill text-green-400'
                : t.status === 'in_progress'
                  ? 'i-svg-spinners:90-ring-with-bg text-blue-400'
                  : 'i-ph:circle text-palmkit-elements-textTertiary',
            )}
          />
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
          <span className="i-svg-spinners:90-ring-with-bg text-xs text-palmkit-elements-textTertiary" />
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

export const BuildStream = memo(() => {
  const events = useStore(workerEventsStore);
  const { progress, currentStep } = useStore(workerProgressStore);

  const sections = useMemo(() => foldEvents(events), [events]);

  if (events.length === 0 && progress === 0) {
    return null;
  }

  const done = currentStep === 'done' || events.some((e) => e.type === 'ready_for_preview');
  const failed = events.some((e) => e.type === 'job_failed');

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

  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-bg-depth-2">
      {/* header */}
      <div className="border-b border-palmkit-elements-borderColor/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={classNames(
              'shrink-0',
              failed
                ? 'i-ph:x-circle-fill text-red-400'
                : done && hasBuildErrors
                  ? 'i-ph:warning-fill text-amber-400'
                  : done
                    ? 'i-ph:check-circle-fill text-green-400'
                    : 'i-svg-spinners:90-ring-with-bg text-blue-400',
            )}
          />
          <span className="text-sm font-medium text-palmkit-elements-textPrimary">
            {failed
              ? 'Build failed'
              : done && hasBuildErrors
                ? 'Build has errors'
                : done && buildVerified === true
                  ? 'Build verified'
                  : done
                    ? 'Build complete'
                    : 'Building…'}
          </span>
          {fileCount > 0 && (
            <span className="ml-auto text-xs text-palmkit-elements-textTertiary tabular-nums">{fileCount} files</span>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-palmkit-elements-bg-depth-1">
          <div
            className={classNames(
              'h-full rounded-full transition-all duration-700 ease-out',
              failed ? 'bg-red-400' : 'bg-green-400',
            )}
            style={{ width: `${displayProgress}%` }}
          />
        </div>
      </div>
      {/* chronological stream */}
      <div className="max-h-[52vh] overflow-y-auto px-4 py-3">
        {sections.map((s, i) => (
          <SectionView key={i} section={s} />
        ))}
      </div>
    </div>
  );
});

BuildStream.displayName = 'BuildStream';
Thinking.displayName = 'Thinking';
FileRow.displayName = 'FileRow';
CommandRow.displayName = 'CommandRow';
Todos.displayName = 'Todos';
SectionView.displayName = 'SectionView';
