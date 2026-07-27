import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { authModalStore } from '~/lib/stores/auth';

export const PENDING_PROMPT_KEY = 'palmkit_pending_prompt';

const SUGGESTIONS = ['A habit tracker with streaks', 'A split-bill calculator', 'A recipe finder'];

/**
 * LandingPromptBox — Liquid Glass input box for the hero section.
 *
 * Design: frosted glass card with a solid light input bar inside.
 * The input bar has high contrast (light bg, dark text) for readability
 * over the landscape image. Send button is a warm accent pill.
 *
 * On submit: saves prompt to sessionStorage, opens AuthModal.
 */
export function LandingPromptBox(_props?: { variant?: 'hero' | 'plain' }) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autosize = useCallback(() => {
    const el = textareaRef.current;

    if (!el) {
      return;
    }

    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, trimmed);
    } catch {
      /* sessionStorage may be blocked */
    }

    authModalStore.set(true);
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const pickSuggestion = (s: string) => {
    setValue(s);
    requestAnimationFrame(() => {
      autosize();
      textareaRef.current?.focus();
    });
  };

  const canSend = value.trim().length > 0;

  return (
    <div className="w-full">
      {/* ── Liquid Glass container ── */}
      <div
        className="relative rounded-[20px] overflow-hidden"
        style={{
          padding: '12px',
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(30px) saturate(160%)',
          WebkitBackdropFilter: 'blur(30px) saturate(160%)',
          boxShadow: `0 16px 50px -12px rgba(0,0,0,${focused ? '0.7' : '0.5'}), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.04)`,
          border: '1px solid rgba(255,255,255,0.06)',
          transition: 'box-shadow 0.3s ease',
        }}
      >
        {/* Specular highlight */}
        <div
          className="absolute inset-0 pointer-events-none rounded-[20px]"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 40%, transparent 70%)',
          }}
        />

        {/* Status indicator */}
        <div className="relative flex items-center gap-2 px-2 pt-1 pb-2">
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style={{ background: '#D8825C' }}
            />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: '#D8825C' }} />
          </span>
          <span className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Palmkit is ready
          </span>
        </div>

        {/* ── Input bar — solid bg for contrast ── */}
        <div
          className="relative rounded-[14px] flex items-end gap-2 p-2"
          style={{
            background: 'rgba(255,255,255,0.92)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              autosize();
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            aria-label="Describe the app you want to build"
            placeholder="Describe the app you want to build…"
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] leading-relaxed focus:outline-none"
            style={{ color: '#1a1a1a', minHeight: 36 }}
          />

          {/* Send button — warm accent pill */}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send prompt"
            className="shrink-0 h-9 px-4 rounded-[10px] text-[12px] font-semibold transition-all hover:scale-[1.03] active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
            style={{
              background: canSend ? '#D8825C' : 'rgba(0,0,0,0.08)',
              color: canSend ? '#16120c' : 'rgba(0,0,0,0.3)',
              boxShadow: canSend ? '0 3px 12px -2px rgba(216,130,92,0.4)' : 'none',
            }}
          >
            Send
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              className="inline-block ml-1 -mt-0.5"
              aria-hidden
            >
              <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path
                d="M5 3.5 H12 V10.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* Suggestion chips */}
        <div className="relative flex flex-wrap items-center gap-1.5 px-2 pt-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pickSuggestion(s)}
              className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-white/8"
              style={{
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.6)',
                background: 'rgba(255,255,255,0.04)',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
