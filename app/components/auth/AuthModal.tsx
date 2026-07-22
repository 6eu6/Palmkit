import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — compact glass popup card for login/signup.
 *
 * Design principles:
 *   - Compact card (380px max), centered, NOT full screen
 *   - Soft rounded corners (24px = rounded-3xl)
 *   - Translucent glass (NOT opaque) — background visible through blur
 *   - Professional animation: scale + slide-up + fade
 *   - Logo is non-interactive (pointer-events: none)
 *
 * Font system (site-wide):
 *   - Headings: Boska (serif display, from /fonts/)
 *   - Body/UI: Inter (sans-serif, from Google Fonts)
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

  const isDark =
    document.documentElement.getAttribute('data-landing-theme') === 'dark' ||
    !document.documentElement.getAttribute('data-landing-theme');
  const markSrc = isDark ? '/palmkit-mark-ondark.png' : '/palmkit-mark.png';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'auth-fade-in 0.2s ease forwards' }}
    >
      {/* Backdrop — dark blur, NOT opaque */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0"
        style={{
          background: 'rgba(0, 0, 0, 0.45)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      />

      {/* Glass Card — compact, soft corners, translucent */}
      <div
        className="relative w-full max-w-[360px] rounded-3xl p-7"
        style={{
          background: isDark ? 'rgba(22, 18, 12, 0.72)' : 'rgba(231, 224, 210, 0.72)',
          backdropFilter: 'blur(30px) saturate(160%)',
          WebkitBackdropFilter: 'blur(30px) saturate(160%)',
          boxShadow:
            '0 24px 60px -12px rgba(0,0,0,0.5), inset 0 1px 0 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)',
          animation: 'auth-card-in 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Close button */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: isDark ? 'rgba(236,228,212,0.45)' : 'rgba(34,30,22,0.45)' }}
        >
          <span className="i-ph:x text-base" />
        </button>

        {/* Logo — non-interactive (pointer-events: none) */}
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src={markSrc}
            alt=""
            className="w-11 h-11 mb-3 select-none"
            style={{ pointerEvents: 'none', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.2))' }}
          />
          <h2
            className="text-lg font-bold tracking-tight"
            style={{
              color: isDark ? '#ECE4D4' : '#221E16',
              fontFamily: "'Boska', Georgia, serif",
            }}
          >
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-xs mt-1" style={{ color: isDark ? 'rgba(236,228,212,0.5)' : 'rgba(34,30,22,0.5)' }}>
            {mode === 'login'
              ? 'Log in to keep your projects in sync.'
              : 'Sign up to start building apps from prompts.'}
          </p>
        </div>

        {/* OAuth buttons */}
        <div className="flex flex-col gap-2">
          <a
            href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 border transition-colors hover:bg-white/5"
            style={{
              borderColor: isDark ? 'rgba(236,228,212,0.1)' : 'rgba(34,30,22,0.1)',
              color: isDark ? 'rgba(236,228,212,0.85)' : 'rgba(34,30,22,0.85)',
              background: isDark ? 'rgba(236,228,212,0.03)' : 'rgba(34,30,22,0.03)',
            }}
          >
            <span className="i-ph:github-logo-fill text-base" />
            Continue with GitHub
          </a>
          <a
            href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 border transition-colors hover:bg-white/5"
            style={{
              borderColor: isDark ? 'rgba(236,228,212,0.1)' : 'rgba(34,30,22,0.1)',
              color: isDark ? 'rgba(236,228,212,0.85)' : 'rgba(34,30,22,0.85)',
              background: isDark ? 'rgba(236,228,212,0.03)' : 'rgba(34,30,22,0.03)',
            }}
          >
            <span className="i-ph:x-logo-fill text-base" />
            Continue with X
          </a>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div
            className="h-px flex-1"
            style={{ background: isDark ? 'rgba(236,228,212,0.08)' : 'rgba(34,30,22,0.08)' }}
          />
          <span
            className="text-[10px] uppercase tracking-wider"
            style={{ color: isDark ? 'rgba(236,228,212,0.3)' : 'rgba(34,30,22,0.3)' }}
          >
            or
          </span>
          <div
            className="h-px flex-1"
            style={{ background: isDark ? 'rgba(236,228,212,0.08)' : 'rgba(34,30,22,0.08)' }}
          />
        </div>

        {/* Email/password form */}
        <Form method="post" action={mode === 'login' ? '/login' : '/signup'} className="flex flex-col gap-3">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="Email"
            className="w-full h-11 px-4 rounded-xl text-sm border focus:outline-none focus:ring-2 transition-all"
            style={{
              background: isDark ? 'rgba(236,228,212,0.04)' : 'rgba(34,30,22,0.04)',
              borderColor: isDark ? 'rgba(236,228,212,0.1)' : 'rgba(34,30,22,0.1)',
              color: isDark ? '#ECE4D4' : '#221E16',
            }}
          />

          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            placeholder="Password"
            className="w-full h-11 px-4 rounded-xl text-sm border focus:outline-none focus:ring-2 transition-all"
            style={{
              background: isDark ? 'rgba(236,228,212,0.04)' : 'rgba(34,30,22,0.04)',
              borderColor: isDark ? 'rgba(236,228,212,0.1)' : 'rgba(34,30,22,0.1)',
              color: isDark ? '#ECE4D4' : '#221E16',
            }}
          />

          {actionData?.error && (
            <div
              className="flex items-start gap-2 p-2.5 rounded-xl text-xs"
              style={{
                background: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.12)',
                color: '#fca5a5',
              }}
            >
              <span className="i-ph:warning-circle-fill text-sm mt-0.5 flex-shrink-0" />
              <span>{actionData.error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 mt-1"
            style={{
              background: isDark ? '#D8825C' : '#9C4A2E',
              color: isDark ? '#16120c' : '#FBF7EE',
              boxShadow: '0 4px 14px -4px rgba(216,130,92,0.4)',
            }}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </Form>

        {/* Toggle login/signup */}
        <p
          className="mt-4 text-center text-xs"
          style={{ color: isDark ? 'rgba(236,228,212,0.4)' : 'rgba(34,30,22,0.4)' }}
        >
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="font-semibold underline"
            style={{ color: isDark ? '#D8825C' : '#9C4A2E' }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes auth-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes auth-card-in {
          from { opacity: 0; transform: translateY(16px) scale(0.94); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
