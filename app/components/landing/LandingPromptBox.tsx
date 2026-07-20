/*
 * LandingPromptBox — the hero focal point of the marketing landing.
 * Visitors type what they want to build; on submit we stash the prompt
 * in sessionStorage and route them to /login. After they authenticate,
 * Chat.client.tsx picks the prompt back up and auto-sends it, so the
 * journey from "idea typed on the landing page" → "running app" is
 * seamless.
 *
 * variant="hero"  → liquid-glass card floating over the landscape
 * variant="plain" → solid card for the secondary CTA (not used in the
 *                   current redesign but kept for compatibility)
 */
import { useNavigate } from '@remix-run/react';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

/** sessionStorage key shared with Chat.client.tsx */
export const PENDING_PROMPT_KEY = 'palmkit_pending_prompt';

const SUGGESTIONS = ['A habit tracker with streaks', 'A split-bill calculator', 'A recipe finder'];

export function LandingPromptBox({ variant = 'hero' }: { variant?: 'hero' | 'plain' }) {
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
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  const submit = useCallback(() => {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, trimmed);
    } catch {
      navigate(`/login?redirectTo=${encodeURIComponent(`/?prompt=${encodeURIComponent(trimmed)}`)}`);
      return;
    }
    navigate('/login?redirectTo=/');
  }, [value, navigate]);

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
      {variant === 'hero' ? (
        <HeroGlassBox
          value={value}
          focused={focused}
          canSend={canSend}
          textareaRef={textareaRef}
          onChange={(v) => {
            setValue(v);
            autosize();
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmit={submit}
          suggestions={SUGGESTIONS}
          onPick={pickSuggestion}
        />
      ) : (
        <PlainBox
          value={value}
          canSend={canSend}
          textareaRef={textareaRef}
          onChange={(v) => {
            setValue(v);
            autosize();
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmit={submit}
          suggestions={SUGGESTIONS}
          onPick={pickSuggestion}
        />
      )}
    </div>
  );
}

/* ── Hero variant — liquid glass over the landscape ── */

type BoxProps = {
  value: string;
  focused?: boolean;
  canSend: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSubmit: () => void;
  suggestions: string[];
  onPick: (s: string) => void;
};

function HeroGlassBox(props: BoxProps) {
  const { value, focused, canSend, textareaRef, onChange, onKeyDown, onFocus, onBlur, onSubmit, suggestions, onPick } =
    props;

  return (
    <div
      className="lk-glass relative w-full overflow-hidden rounded-[1.4rem] p-1.5 sm:rounded-[1.6rem]"
      style={{ boxShadow: focused ? '0 24px 70px -36px rgba(0,0,0,0.7)' : '0 24px 70px -36px rgba(0,0,0,0.6)' }}
    >
      {/* conversation area */}
      <div className="px-4 pt-3 pb-1.5 sm:px-5 sm:pt-4 sm:pb-2">
        <div
          className="flex items-center gap-2 text-[0.7rem] sm:text-xs"
          style={{ color: 'rgb(var(--lk-fg-raw) / 0.55)' }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style={{ background: 'var(--lk-accent)' }}
            />
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--lk-accent)' }}
            />
          </span>
          Palmkit is ready
        </div>
        <p
          className="lk-display mt-2.5 max-w-[34ch] text-[0.98rem] leading-snug sm:mt-3 sm:text-[1.05rem]"
          style={{ color: 'rgb(var(--lk-fg-raw) / 0.85)' }}
        >
          Tell me what to build. I&rsquo;ll draft the app, preview it live, and hand you the code.
        </p>
      </div>

      {/* input row */}
      <div
        className="relative m-1.5 mt-1 rounded-[1.1rem] border p-2 sm:rounded-[1.25rem] sm:p-2.5"
        style={{ borderColor: 'rgb(var(--lk-fg-raw) / 0.12)', background: 'rgb(var(--lk-fg-raw) / 0.03)' }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          rows={1}
          aria-label="Describe the app you want to build"
          placeholder="Describe the app you want to build…"
          className="lk-soft-scroll block w-full resize-none bg-transparent px-2 pb-1 pt-1.5 text-[0.92rem] leading-relaxed focus:outline-none sm:px-2.5 sm:pt-2 sm:pb-1.5 sm:text-[0.98rem]"
          style={{ color: 'var(--lk-fg)', minHeight: 40 }}
        />
        <div className="flex items-end justify-between gap-2 px-1 pb-0.5 pt-1.5 sm:gap-3 sm:px-1.5">
          <div className="flex flex-1 flex-wrap items-center gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPick(s)}
                className="rounded-full border px-2.5 py-1 text-[0.68rem] leading-none transition-colors duration-200 sm:text-[0.72rem]"
                style={{
                  borderColor: 'rgb(var(--lk-fg-raw) / 0.15)',
                  color: 'rgb(var(--lk-fg-raw) / 0.55)',
                  background: 'rgb(var(--lk-fg-raw) / 0.04)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label="Send prompt"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all duration-200 hover:brightness-110 active:scale-95 disabled:opacity-40"
            style={{
              background: 'var(--lk-accent)',
              color: 'var(--lk-accent-fg)',
              boxShadow: '0 4px 14px -6px rgb(var(--lk-glass-shadow) / 0.6)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path
                d="M5 3.5 H12 V10.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
    </div>
  );
}

/* ── Plain variant — solid card (kept for compatibility) ── */

function PlainBox(props: BoxProps) {
  const { value, canSend, textareaRef, onChange, onKeyDown, onFocus, onBlur, onSubmit, suggestions, onPick } = props;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div
        className="relative rounded-2xl border transition-all duration-200"
        style={{
          borderColor: 'rgb(var(--lk-bg-raw) / 0.16)',
          background: 'rgb(var(--lk-bg-raw) / 0.04)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          rows={1}
          aria-label="Describe what you want to build"
          placeholder="What do you want to build?"
          className="block w-full resize-none bg-transparent px-4 py-4 pr-16 text-sm focus:outline-none sm:text-base sm:px-5"
          style={{ color: 'var(--lk-fg)', minHeight: 56, maxHeight: 200 }}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          aria-label="Start building"
          className="absolute right-3 bottom-3 grid h-10 w-10 place-items-center rounded-xl transition-all active:scale-95 disabled:cursor-not-allowed"
          style={{
            background: canSend ? 'var(--lk-accent)' : 'rgb(var(--lk-bg-raw) / 0.06)',
            color: 'var(--lk-accent-fg)',
            opacity: canSend ? 1 : 0.5,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path
              d="M5 3.5 H12 V10.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-full border px-3 py-1.5 text-[11px] transition-colors sm:text-xs"
            style={{
              borderColor: 'rgb(var(--lk-bg-raw) / 0.14)',
              color: 'var(--lk-fg)',
              background: 'rgb(var(--lk-bg-raw) / 0.04)',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
