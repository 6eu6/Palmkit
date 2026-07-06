import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { authUserStore } from '~/lib/stores/auth';
import type { ClarifyQuestion } from '~/lib/clarify-rules';
import { classNames } from '~/utils/classNames';

/**
 * Clarifier — a pre-build question sheet for short/vague prompts.
 *
 * When the user sends a short prompt, we ask the LLM (api.clarify.ts) to
 * generate 2-4 focused questions with clickable answer options. The user picks
 * what they want (or types a custom answer), we append it to the prompt, and
 * the builder runs with a richer spec — at ~600 tokens per clarify call.
 *
 * Why dynamic (not the old hardcoded rules): the LLM sees the actual prompt and
 * asks only what's genuinely missing (features, design, data source, scope),
 * with options tailored to the request. Number of questions and options is
 * decided by the model — nothing hardcoded.
 *
 * UX: iOS bottom sheet on mobile, centered modal on desktop. Each question
 * shows clickable chips + a "custom" text input. 'Skip' builds with the
 * original prompt unchanged.
 */
interface ClarifierProps {
  open: boolean;
  prompt: string;
  model: string;
  provider: { name: string } | null;
  onBuild: (expandedPrompt: string) => void;
  onSkip: () => void;
}

interface ClarifyResponse {
  questions: ClarifyQuestion[];
  error?: string;
}

export function Clarifier({ open, prompt, model, provider, onBuild, onSkip }: ClarifierProps) {
  const authUser = useStore(authUserStore);
  const [questions, setQuestions] = useState<ClarifyQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-question selections: questionIndex -> Set of chosen appends.
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});

  // Per-question custom text inputs.
  const [customText, setCustomText] = useState<Record<number, string>>({});
  const reqIdRef = useRef(0);

  // Fetch questions when the sheet opens.
  useEffect(() => {
    if (!open) {
      setQuestions([]);
      setSelected({});
      setCustomText({});
      setError(null);
      setLoading(false);

      return;
    }

    // Skip the API call if logged-out (no API key to use).
    if (!authUser || !provider) {
      setQuestions([]);
      return;
    }

    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setQuestions([]);
    setSelected({});
    setCustomText({});

    fetch('/api/clarify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, model, provider }),
    })
      .then(async (res) => res.json() as Promise<ClarifyResponse>)
      .then((data) => {
        if (reqIdRef.current !== myReq) {
          return; // a newer request superseded this one
        }

        if (data.error) {
          setError(data.error);
        }

        setQuestions(data.questions ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (reqIdRef.current !== myReq) {
          return;
        }

        console.error('Clarify fetch failed:', e);
        setError('Clarification unavailable');
        setLoading(false);
      });
  }, [open, prompt, model, provider, authUser]);

  const toggle = (qi: number, append: string) => {
    setSelected((prev) => {
      const set = new Set(prev[qi] ?? []);

      if (set.has(append)) {
        set.delete(append);
      } else {
        set.add(append);
      }

      return { ...prev, [qi]: set };
    });
  };

  const totalSelected =
    Object.values(selected).reduce((sum, s) => sum + s.size, 0) +
    Object.values(customText).filter((t) => t.trim().length > 0).length;

  const handleBuild = () => {
    const additions: string[] = [];

    questions.forEach((q, qi) => {
      const chosen = selected[qi];

      if (chosen) {
        for (const append of chosen) {
          additions.push(append);
        }
      }

      const custom = customText[qi]?.trim();

      if (custom) {
        additions.push(` ${custom}`);
      }
    });

    const expanded = additions.length > 0 ? `${prompt.trim()}${additions.join('')}` : prompt.trim();
    onBuild(expanded);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onSkip}
          />

          <div className="fixed inset-0 z-[111] flex items-end sm:items-center justify-center pointer-events-none">
            <motion.div
              className={classNames(
                'pointer-events-auto w-full sm:max-w-md',
                'bg-palmkit-elements-background-depth-1',
                'border border-palmkit-elements-borderColor',
                'rounded-t-2xl sm:rounded-2xl shadow-2xl',
                'max-h-[85vh] overflow-y-auto modern-scrollbar',
              )}
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
              initial={{ y: '100%', opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: '100%', opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              {/* Header */}
              <div className="px-5 pt-4 pb-3 border-b border-palmkit-elements-borderColor sticky top-0 bg-palmkit-elements-background-depth-1 z-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-[15px] font-semibold text-palmkit-elements-textPrimary">قبل أن أبدأ البناء</h3>
                    <p className="text-[12px] text-palmkit-elements-textSecondary mt-0.5">
                      {loading ? 'أحلّل طلبك…' : 'اختر ما يناسبك لتوصيل نتيجة أدق (اختياري)'}
                    </p>
                  </div>
                  <button
                    onClick={onSkip}
                    aria-label="Close"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-palmkit-elements-textTertiary hover:bg-palmkit-elements-item-backgroundActive hover:text-palmkit-elements-textPrimary transition"
                  >
                    <div className="i-ph:x text-base" />
                  </button>
                </div>
              </div>

              {/* Original prompt preview */}
              <div className="px-5 py-2.5 bg-palmkit-elements-background-depth-2/50">
                <p className="text-[12px] text-palmkit-elements-textSecondary line-clamp-2">
                  <span className="i-ph:quotes text-[11px] mr-1 opacity-60" />
                  {prompt}
                </p>
              </div>

              {/* Body: loading / questions / error */}
              <div className="px-5 py-4 space-y-4">
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <div className="i-svg-spinners:90-ring-with-bg text-2xl text-palmkit-elements-textSecondary" />
                  </div>
                )}

                {!loading && error && questions.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-[13px] text-palmkit-elements-textTertiary">{error}</p>
                    <p className="text-[11px] text-palmkit-elements-textTertiary mt-1">سأبني بالـ prompt كما هو.</p>
                  </div>
                )}

                {!loading &&
                  questions.map((q, qi) => (
                    <div key={qi}>
                      <p className="text-[13px] font-medium text-palmkit-elements-textPrimary mb-2">{q.prompt}</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {q.options.map((opt, oi) => {
                          const isOn = selected[qi]?.has(opt.append);
                          return (
                            <button
                              key={oi}
                              onClick={() => toggle(qi, opt.append)}
                              className={classNames(
                                'px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all active:scale-95',
                                isOn
                                  ? 'bg-[var(--pk-accent)] text-[var(--pk-on-accent)] border-[var(--pk-accent)]'
                                  : 'bg-palmkit-elements-background-depth-2 text-palmkit-elements-textSecondary border-palmkit-elements-borderColor hover:border-[var(--pk-glass-border-hi)] hover:text-palmkit-elements-textPrimary',
                              )}
                            >
                              {isOn && <span className="i-ph:check text-[11px] mr-1" />}
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      {/* Custom answer input */}
                      <input
                        type="text"
                        value={customText[qi] ?? ''}
                        onChange={(e) => setCustomText((prev) => ({ ...prev, [qi]: e.target.value }))}
                        placeholder="أو اكتب إجابة مخصّصة…"
                        className={classNames(
                          'w-full px-3 py-1.5 rounded-lg text-[12px]',
                          'bg-palmkit-elements-background-depth-2',
                          'border border-palmkit-elements-borderColor',
                          'text-palmkit-elements-textPrimary',
                          'placeholder:text-palmkit-elements-textTertiary',
                          'focus:outline-none focus:border-[var(--pk-glass-border-hi)]',
                        )}
                      />
                    </div>
                  ))}

                {!loading && !error && questions.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-[13px] text-palmkit-elements-textTertiary">
                      طلبك واضح بما يكفي — سأبدأ البناء مباشرة.
                    </p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="px-5 py-3 border-t border-palmkit-elements-borderColor flex gap-2 sticky bottom-0 bg-palmkit-elements-background-depth-1">
                <button
                  onClick={onSkip}
                  className="flex-1 h-10 rounded-xl text-[13px] font-medium text-palmkit-elements-textSecondary hover:bg-palmkit-elements-item-backgroundActive transition"
                >
                  تخطّي
                </button>
                <button
                  onClick={handleBuild}
                  disabled={loading}
                  className="flex-[2] h-10 rounded-xl text-[13px] font-semibold bg-[var(--pk-accent)] text-[var(--pk-on-accent)] hover:opacity-90 active:scale-[0.98] transition shadow-sm disabled:opacity-50"
                >
                  {totalSelected > 0 ? `ابنِ الآن (${totalSelected})` : 'ابنِ الآن'}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
