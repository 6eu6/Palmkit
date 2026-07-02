/**
 * SessionAdvisor — an inline, in-thread nudge to CONTINUE the project in a
 * fresh chat once its context gets genuinely large.
 *
 * This is deliberately NOT a file-count rule and NOT a "you've sent N messages"
 * rule. Context length is about the amount of chat + operations the model has
 * to carry — NOT how many files a project happens to contain. A freshly
 * imported 100–300 file repo where the model only reads the few files it needs
 * should NOT be nagged; a long, edit-heavy chat that is genuinely filling the
 * model's context window should.
 *
 * So the trigger is a REAL, server-measured signal: on every build/edit the
 * worker records the PEAK input (prompt) tokens the model actually consumed on
 * its most demanding request, relative to that model's context window
 * (`contextPressureStore`). Only once that fraction crosses a meaningful line —
 * or the model literally ran out of room (truncated) — do we offer a single
 * minimalist action: fork this project into a fresh chat that keeps the full
 * project + its memory but starts with a clean, fast context. The old chat
 * stays exactly as it is — nothing is lost. It is dismissible per-chat.
 */
import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { contextPressureStore, previewFilesStore } from '~/lib/stores/build-status';
import { workbenchStore } from '~/lib/stores/workbench';
import { chatId, description, db } from '~/lib/persistence/useChatHistory';
import { continueInFreshChat } from '~/lib/chat/continueInFreshChat';
import { classNames } from '~/utils/classNames';

/*
 * Gather the project's files from every place they might live, so the fork
 * never fails with "No files to carry over". previewFilesStore is populated
 * during/after a build, but on a RESTORED chat (page reload) it can be empty
 * before the async workspace fetch finishes — while the workbench file tree is
 * already hydrated from the snapshot. Merge both (text files only).
 */
function collectProjectFiles(preview: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...(preview ?? {}) };

  const tree = workbenchStore.files.get() ?? {};

  for (const [path, dirent] of Object.entries(tree)) {
    if (dirent?.type === 'file' && !dirent.isBinary && typeof dirent.content === 'string' && !(path in out)) {
      out[path] = dirent.content;
    }
  }

  return out;
}

/*
 * The single line grounded in the real tradeoff: once the model's most
 * demanding request on this project consumed ~60% of its context window, each
 * further edit sends an ever-larger share of that window, which measurably
 * slows the model down and dulls its focus. At that point a fresh chat (compact
 * handoff instead of a long history) is a genuine win. We only advise — never
 * block — and a hard truncation (the model ran OUT of room) always qualifies.
 */
const RATIO_THRESHOLD = 0.6;

function dismissKey(): string {
  if (typeof window === 'undefined') {
    return 'palmkit_session_advisor_root';
  }

  const id = window.location.pathname.split('/').filter(Boolean).pop() || 'root';

  return `palmkit_session_advisor_dismissed_${id}`;
}

export function SessionAdvisor() {
  const pressure = useStore(contextPressureStore);
  const files = useStore(previewFilesStore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    try {
      return localStorage.getItem(dismissKey()) === '1';
    } catch {
      return false;
    }
  });

  const ratio = pressure?.ratio ?? 0;
  const truncated = pressure?.truncated ?? false;
  const over = truncated || ratio >= RATIO_THRESHOLD;

  if (dismissed || !pressure || !over) {
    return null;
  }

  const pct = Math.min(100, Math.round(ratio * 100));

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(), '1');
    } catch {
      // ignore — non-fatal
    }

    setDismissed(true);
  };

  const handleFork = async () => {
    if (busy) {
      return;
    }

    setError(null);

    const sourceProjectId = chatId.get() || window.location.pathname.split('/').filter(Boolean).pop();

    if (!db || !sourceProjectId) {
      setError('Chat storage is unavailable — cannot continue in a fresh chat.');
      return;
    }

    const projectFiles = collectProjectFiles(files);

    if (Object.keys(projectFiles).length === 0) {
      setError('The project files are still loading — give it a second and try again.');
      return;
    }

    setBusy(true);

    try {
      const newUrlId = await continueInFreshChat({
        db,
        sourceProjectId,
        projectName: description.get() || 'your project',
        files: projectFiles,
      });

      // Full navigation so the fresh chat boots with a clean store/context.
      window.location.href = `/chat/${newUrlId}`;
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not continue in a fresh chat');
    }
  };

  return (
    <div className="flex items-start gap-3">
      {/* Assistant-style avatar so this reads as a message in the thread. */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-palmkit-elements-bg-depth-3 text-palmkit-elements-textSecondary">
        <span className="i-ph:git-fork text-[15px]" />
      </div>

      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-palmkit-elements-borderColor bg-palmkit-elements-bg-depth-2 px-4 py-3 text-sm">
        <p className="leading-relaxed text-palmkit-elements-textSecondary">
          {truncated ? (
            <>
              The last change{' '}
              <span className="font-medium text-palmkit-elements-textPrimary">ran out of context room</span> — the model
              hit its window and had to cut the response short.
            </>
          ) : (
            <>
              This chat is getting long — the last change already used{' '}
              <span className="font-medium text-palmkit-elements-textPrimary tabular-nums">~{pct}%</span> of the
              model&apos;s context window.
            </>
          )}{' '}
          Each further edit sends more of that window, which slows the model down and dulls its focus. Continue in a
          fresh chat with a <span className="font-medium">full copy of the project and its memory</span> — clean, fast
          context, nothing lost.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleFork}
            disabled={busy}
            className={classNames(
              'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-medium transition-colors',
              'bg-palmkit-elements-button-primary-background text-palmkit-elements-button-primary-text',
              'hover:bg-palmkit-elements-button-primary-backgroundHover disabled:opacity-60',
            )}
          >
            <span className={busy ? 'i-svg-spinners:90-ring-with-bg text-[15px]' : 'i-ph:git-fork text-[15px]'} />
            {busy ? 'Setting up…' : 'Continue in a fresh chat'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 font-medium text-palmkit-elements-textSecondary transition-colors hover:bg-palmkit-elements-bg-depth-3 hover:text-palmkit-elements-textPrimary disabled:opacity-60"
          >
            Keep editing here
          </button>
        </div>

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
