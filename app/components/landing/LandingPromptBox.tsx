/*
 * LandingPromptBox — a lovable-style prompt input rendered on the marketing
 * landing page. Visitors type what they want to build; on submit we stash the
 * prompt in sessionStorage and route them to /login. After they authenticate,
 * Chat.client.tsx picks the prompt back up and auto-sends it, so the journey
 * from "idea typed on the landing page" → "running app" is seamless.
 */
import { useNavigate } from '@remix-run/react';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

/* ─── Brand colors (mirror Landing.tsx) ─── */
const TEAL = '#00A8B5';
const MINT = '#4CD4B0';
const TEAL_GLOW = 'rgba(0, 168, 181, 0.25)';
const TEAL_TEXT = '#5eead4';

/** sessionStorage key shared with Chat.client.tsx */
export const PENDING_PROMPT_KEY = 'palmkit_pending_prompt';

const SUGGESTIONS = [
  'A pricing page with a monthly/yearly toggle',
  'A habit tracker that works offline',
  'A portfolio site with dark mode',
];

export function LandingPromptBox() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, trimmed);
    } catch {
      /* sessionStorage may be unavailable (private mode) — fall back to URL. */
      navigate(`/login?redirectTo=${encodeURIComponent(`/?prompt=${encodeURIComponent(trimmed)}`)}`);
      return;
    }

    // Route to login; after auth the user lands at "/" where Chat lives.
    navigate('/login?redirectTo=/');
  }, [value, navigate]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline — standard chat UX.
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
    <div className="w-full max-w-2xl mx-auto">
      {/* Prompt box */}
      <div
        className="relative rounded-2xl border transition-all duration-200"
        style={{
          borderColor: focused ? 'rgba(0, 168, 181, 0.45)' : 'rgba(0, 168, 181, 0.16)',
          background: 'rgba(10, 10, 18, 0.55)',
          boxShadow: focused ? `0 0 0 4px ${TEAL_GLOW}, 0 12px 40px rgba(0,0,0,0.35)` : '0 12px 40px rgba(0,0,0,0.3)',
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
          aria-label="Describe what you want to build"
          placeholder="What do you want to build?"
          className="block w-full resize-none bg-transparent px-4 sm:px-5 py-4 pr-16 text-sm sm:text-base text-palmkit-elements-textPrimary placeholder:text-palmkit-elements-textTertiary focus:outline-none"
          style={{ minHeight: 56, maxHeight: 200 }}
        />
        {/* Send button */}
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Start building"
          className="absolute right-3 bottom-3 h-10 w-10 rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:cursor-not-allowed"
          style={{
            background: canSend ? `linear-gradient(135deg, ${TEAL} 0%, ${MINT} 140%)` : 'rgba(255,255,255,0.06)',
            color: '#fff',
            boxShadow: canSend ? `0 4px 14px ${TEAL_GLOW}` : 'none',
            opacity: canSend ? 1 : 0.5,
          }}
        >
          <span className="i-ph:arrow-up-bold text-base" />
        </button>
      </div>

      {/* Helper line */}
      <p className="mt-3 text-center text-xs text-palmkit-elements-textTertiary">
        Bring your own AI key · No credit card · Deploy in seconds
      </p>

      {/* Quick suggestions */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => pickSuggestion(s)}
            className="text-[11px] sm:text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-palmkit-elements-background-depth-2"
            style={{
              borderColor: 'rgba(0, 168, 181, 0.14)',
              color: TEAL_TEXT,
              background: 'rgba(0, 168, 181, 0.04)',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
