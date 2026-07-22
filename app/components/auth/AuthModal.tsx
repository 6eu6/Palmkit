import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — compact glass popup card for login/signup.
 *
 * Design:
 *   - FIXED size: 340px × auto height (never fills screen)
 *   - Soft rounded corners (20px)
 *   - Translucent glass with blur
 *   - ALWAYS dark (matches landing dark theme — no light/dark toggle)
 *   - Professional scale + slide animation
 *   - Logo is non-interactive (pointer-events: none)
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

  const markSrc = '/palmkit-mark-ondark.png';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'auth-fade-in 0.25s ease forwards' }}
    >
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0"
        style={{
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Card — FIXED 340px, always dark, compact */}
      <div
        className="relative rounded-[20px]"
        style={{
          width: '340px',
          maxWidth: 'calc(100vw - 32px)',
          padding: '28px 24px',
          background: 'rgba(20, 17, 12, 0.82)',
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          boxShadow:
            '0 20px 50px -10px rgba(0,0,0,0.6), inset 0 1px 0 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.06)',
          animation: 'auth-card-in 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          color: '#ECE4D4',
        }}
      >
        {/* Close */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center transition-colors"
          style={{ color: 'rgba(236,228,212,0.4)' }}
        >
          <span className="i-ph:x text-sm" />
        </button>

        {/* Logo */}
        <div className="flex flex-col items-center text-center mb-5">
          <img
            src={markSrc}
            alt=""
            className="w-10 h-10 mb-2.5 select-none"
            style={{ pointerEvents: 'none', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.2))' }}
          />
          <h2
            className="text-base font-bold tracking-tight"
            style={{ color: '#ECE4D4', fontFamily: "'Boska', Georgia, serif" }}
          >
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: 'rgba(236,228,212,0.45)' }}>
            {mode === 'login' ? 'Log in to keep your projects in sync.' : 'Sign up to start building apps.'}
          </p>
        </div>

        {/* OAuth */}
        <div className="flex flex-col gap-2 mb-3">
          <a
            href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="w-full h-10 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 border transition-colors hover:bg-white/5"
            style={{
              borderColor: 'rgba(236,228,212,0.08)',
              color: 'rgba(236,228,212,0.8)',
              background: 'rgba(236,228,212,0.02)',
            }}
          >
            <span className="i-ph:github-logo-fill text-sm" />
            GitHub
          </a>
          <a
            href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="w-full h-10 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 border transition-colors hover:bg-white/5"
            style={{
              borderColor: 'rgba(236,228,212,0.08)',
              color: 'rgba(236,228,212,0.8)',
              background: 'rgba(236,228,212,0.02)',
            }}
          >
            <span className="i-ph:x-logo-fill text-sm" />X
          </a>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px flex-1" style={{ background: 'rgba(236,228,212,0.06)' }} />
          <span className="text-[9px] uppercase tracking-wider" style={{ color: 'rgba(236,228,212,0.25)' }}>
            or
          </span>
          <div className="h-px flex-1" style={{ background: 'rgba(236,228,212,0.06)' }} />
        </div>

        {/* Form */}
        <Form method="post" action={mode === 'login' ? '/login' : '/signup'} className="flex flex-col gap-2.5">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="Email"
            className="w-full h-10 px-3.5 rounded-lg text-[13px] border focus:outline-none focus:ring-1 transition-all"
            style={{ background: 'rgba(236,228,212,0.03)', borderColor: 'rgba(236,228,212,0.08)', color: '#ECE4D4' }}
          />
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            placeholder="Password"
            className="w-full h-10 px-3.5 rounded-lg text-[13px] border focus:outline-none focus:ring-1 transition-all"
            style={{ background: 'rgba(236,228,212,0.03)', borderColor: 'rgba(236,228,212,0.08)', color: '#ECE4D4' }}
          />
          {actionData?.error && (
            <div
              className="flex items-start gap-2 p-2 rounded-lg text-[11px]"
              style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.1)', color: '#fca5a5' }}
            >
              <span className="i-ph:warning-circle-fill text-xs mt-0.5 flex-shrink-0" />
              <span>{actionData.error}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-10 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-50 mt-0.5"
            style={{ background: '#D8825C', color: '#16120c', boxShadow: '0 3px 10px -3px rgba(216,130,92,0.35)' }}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </Form>

        {/* Toggle */}
        <p className="mt-3 text-center text-[11px]" style={{ color: 'rgba(236,228,212,0.35)' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="font-semibold underline"
            style={{ color: '#D8825C' }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>

      <style>{`
        @keyframes auth-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes auth-card-in { from { opacity: 0; transform: scale(0.92) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  );
}
