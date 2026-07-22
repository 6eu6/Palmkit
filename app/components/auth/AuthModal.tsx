import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — COMPACT horizontal card.
 *
 * Design goals:
 *   - SHORT and WIDE (not tall/narrow)
 *   - OAuth buttons SIDE BY SIDE (not stacked)
 *   - Minimal vertical space — no wasted empty areas
 *   - Two themes: dark + light (matches landing page theme)
 *   - Professional scale + fade animation
 *
 * Layout (top to bottom, minimal):
 *   [logo + title]          ← one row
 *   [GitHub] [X]           ← side by side, one row
 *   ─── or ───             ← thin divider
 *   [email input]          ← one row
 *   [password input]       ← one row
 *   [submit button]        ← one row
 *   [toggle link]          ← one row
 *   Total: 7 rows (was 8+ with more spacing)
 */
export function AuthModal() {
  const open = useStore(authModalStore);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [redirectTo, setRedirectTo] = useState('/');
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      setRedirectTo(window.location.pathname + window.location.search);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAuthModal();
      }
    };

    if (open) {
      window.addEventListener('keydown', onKey);
    }

    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) {
    return null;
  }

  /*
   * Theme detection: check the landing page's data-landing-theme attribute.
   * Two versions: dark + light — both fully styled.
   */
  const isDark =
    typeof document !== 'undefined' &&
    (document.documentElement.getAttribute('data-landing-theme') === 'dark' ||
      !document.documentElement.getAttribute('data-landing-theme'));

  // Theme tokens
  const T = isDark
    ? {
        bg: 'rgba(20, 17, 12, 0.85)',
        text: '#ECE4D4',
        subtext: 'rgba(236, 228, 212, 0.5)',
        border: 'rgba(236, 228, 212, 0.08)',
        inputBg: 'rgba(236, 228, 212, 0.03)',
        accent: '#D8825C',
        accentFg: '#16120c',
        divider: 'rgba(236, 228, 212, 0.06)',
        mark: '/palmkit-mark-ondark.png',
      }
    : {
        bg: 'rgba(231, 224, 210, 0.85)',
        text: '#221E16',
        subtext: 'rgba(34, 30, 22, 0.5)',
        border: 'rgba(34, 30, 22, 0.1)',
        inputBg: 'rgba(34, 30, 22, 0.03)',
        accent: '#9C4A2E',
        accentFg: '#FBF7EE',
        divider: 'rgba(34, 30, 22, 0.08)',
        mark: '/palmkit-mark.png',
      };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'auth-fade 0.2s ease forwards' }}
    >
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0"
        style={{
          background: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Card — compact, wide, short */}
      <div
        className="relative rounded-[18px]"
        style={{
          width: '340px',
          maxWidth: 'calc(100vw - 32px)',
          padding: '20px',
          background: T.bg,
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          boxShadow: `0 16px 40px -8px rgba(0,0,0,${isDark ? '0.55' : '0.35'}), inset 0 1px 0 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.04)`,
          border: `1px solid ${T.border}`,
          animation: 'auth-pop 0.28s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'Inter', system-ui, sans-serif",
          color: T.text,
        }}
      >
        {/* Close */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ color: T.subtext }}
        >
          <span className="i-ph:x text-xs" />
        </button>

        {/* Header — logo + title INLINE (saves vertical space) */}
        <div className="flex items-center gap-2.5 mb-3.5">
          <img src={T.mark} alt="" className="w-8 h-8 select-none flex-shrink-0" style={{ pointerEvents: 'none' }} />
          <div>
            <h2
              className="text-sm font-bold tracking-tight leading-tight"
              style={{ color: T.text, fontFamily: "'Boska', Georgia, serif" }}
            >
              {mode === 'login' ? 'Welcome back' : 'Create account'}
            </h2>
            <p className="text-[10px] leading-tight" style={{ color: T.subtext }}>
              {mode === 'login' ? 'Log in to your account' : 'Start building apps'}
            </p>
          </div>
        </div>

        {/* OAuth — SIDE BY SIDE (not stacked) */}
        <div className="flex gap-2 mb-2.5">
          <a
            href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="flex-1 h-9 rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 border transition-colors hover:bg-white/5"
            style={{ borderColor: T.border, color: T.subtext, background: T.inputBg }}
          >
            <span className="i-ph:github-logo-fill text-sm" />
            GitHub
          </a>
          <a
            href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="flex-1 h-9 rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 border transition-colors hover:bg-white/5"
            style={{ borderColor: T.border, color: T.subtext, background: T.inputBg }}
          >
            <span className="i-ph:x-logo-fill text-sm" />X
          </a>
        </div>

        {/* Divider — compact */}
        <div className="flex items-center gap-2 mb-2.5">
          <div className="h-px flex-1" style={{ background: T.divider }} />
          <span className="text-[9px] uppercase tracking-wide" style={{ color: T.subtext }}>
            or
          </span>
          <div className="h-px flex-1" style={{ background: T.divider }} />
        </div>

        {/* Form — tight spacing */}
        <Form method="post" action={mode === 'login' ? '/login' : '/signup'} className="flex flex-col gap-2">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="Email"
            className="w-full h-9 px-3 rounded-lg text-[12px] border focus:outline-none focus:ring-1 transition-all"
            style={{ background: T.inputBg, borderColor: T.border, color: T.text }}
          />
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            placeholder="Password"
            className="w-full h-9 px-3 rounded-lg text-[12px] border focus:outline-none focus:ring-1 transition-all"
            style={{ background: T.inputBg, borderColor: T.border, color: T.text }}
          />
          {actionData?.error && (
            <p className="text-[10px] px-1" style={{ color: '#fca5a5' }}>
              {actionData.error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-9 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-50"
            style={{ background: T.accent, color: T.accentFg }}
          >
            {busy ? '…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </Form>

        {/* Toggle — inline */}
        <p className="mt-2.5 text-center text-[10px]" style={{ color: T.subtext }}>
          {mode === 'login' ? 'No account? ' : 'Have one? '}
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="font-semibold"
            style={{ color: T.accent }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>

      <style>{`
        @keyframes auth-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes auth-pop { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}
