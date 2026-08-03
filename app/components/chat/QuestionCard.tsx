/**
 * The card the model shows when it needs an answer before it can build.
 *
 * The rule this exists to serve: ask only when the answer changes the work.
 * A model that already knows enough is expected to start, so an empty block
 * renders nothing and a turn with no block is the normal case.
 *
 * Every question gets a free-text box whether or not it offers options,
 * because the answer the model did not think of is the one worth having, and
 * the whole card can be skipped — "decide for me" is a legitimate answer and
 * sends the model back to work rather than leaving the turn stranded.
 */
import { memo, useState } from 'react';
import type { Message } from 'ai';
import type { ParsedQuestion } from '~/lib/runtime/message-parser';
import { classNames } from '~/utils/classNames';

interface QuestionCardProps {
  questions: ParsedQuestion[];
  append?: (message: Message) => void;
  model?: string;
  provider?: string;
}

/** What the user picked, per question key. */
type Picks = Record<string, { chosen: string[]; text: string }>;

function emptyPicks(questions: ParsedQuestion[]): Picks {
  return Object.fromEntries(questions.map((q) => [q.key, { chosen: [], text: '' }]));
}

export const QuestionCard = memo(({ questions, append, model, provider }: QuestionCardProps) => {
  const [picks, setPicks] = useState<Picks>(() => emptyPicks(questions));
  const [sent, setSent] = useState<string | null>(null);

  if (questions.length === 0) {
    return null;
  }

  const answered = questions.some((q) => picks[q.key]?.chosen.length || picks[q.key]?.text.trim());

  const toggle = (q: ParsedQuestion, label: string) => {
    setPicks((prev) => {
      const current = prev[q.key] ?? { chosen: [], text: '' };
      const has = current.chosen.includes(label);

      const chosen = q.multiple
        ? has
          ? current.chosen.filter((c) => c !== label)
          : [...current.chosen, label]
        : has
          ? []
          : [label];

      return { ...prev, [q.key]: { ...current, chosen } };
    });
  };

  const send = (body: string) => {
    setSent(body);

    append?.({
      id: `answers-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${body}` }] as never,
    });
  };

  const submit = () => {
    /*
     * Written as prose rather than as JSON: this goes back to the model as a
     * user message, and a plain answer reads the same to it as if the user
     * had typed it.
     */
    const lines = questions
      .map((q) => {
        const pick = picks[q.key] ?? { chosen: [], text: '' };
        const parts = [...pick.chosen, pick.text.trim()].filter(Boolean);

        return parts.length ? `${q.ask} ${parts.join(', ')}` : '';
      })
      .filter(Boolean);

    if (lines.length) {
      send(lines.join('\n'));
    }
  };

  if (sent) {
    return (
      <div className="mt-3 rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 px-3.5 py-2.5 text-sm text-palmkit-elements-textSecondary">
        <div className="i-ph:check-circle-fill mr-1.5 inline-block align-[-2px] text-green-500" />
        Answered — building with that.
      </div>
    );
  }

  return (
    <div className="mt-3.5 rounded-xl border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-1 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-palmkit-elements-textSecondary">
        <div className="i-ph:question text-base" />A couple of things first
      </div>

      <div className="flex flex-col gap-4">
        {questions.map((q) => {
          const pick = picks[q.key] ?? { chosen: [], text: '' };

          return (
            <div key={q.key} className="flex flex-col gap-2">
              <div className="text-sm text-palmkit-elements-textPrimary">{q.ask}</div>

              {q.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((option) => {
                    const active = pick.chosen.includes(option.label);

                    return (
                      <button
                        key={option.label}
                        type="button"
                        title={option.hint}
                        onClick={() => toggle(q, option.label)}
                        className={classNames(
                          'rounded-full border px-3 py-1.5 text-xs transition-colors',
                          active
                            ? 'border-transparent bg-palmkit-elements-item-backgroundAccent text-palmkit-elements-item-contentAccent'
                            : 'border-palmkit-elements-borderColor text-palmkit-elements-textSecondary hover:bg-palmkit-elements-background-depth-2',
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <input
                type="text"
                value={pick.text}
                onChange={(e) =>
                  setPicks((prev) => ({
                    ...prev,
                    [q.key]: { ...(prev[q.key] ?? { chosen: [] }), text: e.target.value },
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && answered) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={q.options.length ? 'Or say it in your own words…' : 'Type your answer…'}
                className="w-full rounded-lg border border-palmkit-elements-borderColor bg-palmkit-elements-background-depth-2 px-3 py-2 text-sm text-palmkit-elements-textPrimary placeholder:text-palmkit-elements-textTertiary focus:border-palmkit-elements-borderColorActive focus:outline-none"
              />
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!answered}
          onClick={submit}
          className={classNames(
            'rounded-lg px-3.5 py-1.5 text-sm transition-opacity',
            answered
              ? 'bg-palmkit-elements-item-backgroundAccent text-palmkit-elements-item-contentAccent hover:opacity-90'
              : 'cursor-not-allowed bg-palmkit-elements-background-depth-2 text-palmkit-elements-textTertiary',
          )}
        >
          Continue
        </button>

        <button
          type="button"
          onClick={() => send('Decide for me — pick sensible defaults and build it.')}
          className="rounded-lg px-3 py-1.5 text-sm text-palmkit-elements-textSecondary hover:bg-palmkit-elements-background-depth-2"
        >
          Decide for me
        </button>
      </div>
    </div>
  );
});
