import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getClarifyQuestions, type ClarifyQuestion } from '~/lib/clarify-rules';
import { classNames } from '~/utils/classNames';

/**
 * Clarifier — a pre-build question sheet for short/vague prompts.
 *
 * When the user sends a short prompt ("build a todo app"), instead of building
 * immediately (and guessing the spec), we surface 1–2 concrete questions with
 * clickable answer chips. The user picks what they want, we append it to the
 * prompt, and the builder runs with a richer spec — at ZERO extra model cost
 * (no LLM call; pure keyword heuristics in clarify-rules.ts).
 *
 * UX: on mobile it slides up as a bottom sheet (iOS pattern); on desktop it's a
 * centered modal. The user can always skip ("Build directly").
 */
interface ClarifierProps {
  open: boolean;
  prompt: string;
  onBuild: (expandedPrompt: string) => void;
  onSkip: () => void;
}

export function Clarifier({ open, prompt, onBuild, onSkip }: ClarifierProps) {
  const questions: ClarifyQuestion[] = open ? getClarifyQuestions(prompt) : [];
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (append: string) => {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(append)) {
        next.delete(append);
      } else {
        next.add(append);
      }

      return next;
    });
  };

  const handleBuild = () => {
    const additions = [...selected].join('، ');
    const expanded = additions.length > 0 ? `${prompt.trim()}، ${additions}` : prompt.trim();
    setSelected(new Set());
    onBuild(expanded);
  };

  const handleSkip = () => {
    setSelected(new Set());
    onSkip();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleSkip}
          />

          {/* Sheet — bottom on mobile, centered on desktop */}
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
              <div className="px-5 pt-4 pb-3 border-b border-palmkit-elements-borderColor">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-[15px] font-semibold text-palmkit-elements-textPrimary">قبل أن أبدأ البناء</h3>
                    <p className="text-[12px] text-palmkit-elements-textSecondary mt-0.5">
                      اختر ما يناسبك لتوصيل نتيجة أدق (اختياري)
                    </p>
                  </div>
                  <button
                    onClick={handleSkip}
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

              {/* Questions */}
              <div className="px-5 py-4 space-y-4">
                {questions.map((q, qi) => (
                  <div key={qi}>
                    <p className="text-[13px] font-medium text-palmkit-elements-textPrimary mb-2">{q.prompt}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {q.options.map((opt) => {
                        const isOn = selected.has(opt.append);
                        return (
                          <button
                            key={opt.label}
                            onClick={() => toggle(opt.append)}
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
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="px-5 py-3 border-t border-palmkit-elements-borderColor flex gap-2">
                <button
                  onClick={handleSkip}
                  className="flex-1 h-10 rounded-xl text-[13px] font-medium text-palmkit-elements-textSecondary hover:bg-palmkit-elements-item-backgroundActive transition"
                >
                  تخطّي
                </button>
                <button
                  onClick={handleBuild}
                  className="flex-[2] h-10 rounded-xl text-[13px] font-semibold bg-[var(--pk-accent)] text-[var(--pk-on-accent)] hover:opacity-90 active:scale-[0.98] transition shadow-sm"
                >
                  {selected.size > 0 ? `ابنِ الآن (${selected.size})` : 'ابنِ الآن'}
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
