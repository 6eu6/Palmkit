import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — compact glass popup card for login/signup.
 *
 * Design matches the landing page's liquid glass aesthetic:
 *   - lk-glass background (frosted, translucent)
 *   - lk-fg / lk-accent color tokens
 *   - palmkit-mark logo (not the old icon)
 *   - Centered card with backdrop blur (NOT full screen)
 *   - Smooth slide-up + fade animation
 *
 * Two modes: 'login' | 'signup'
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

  const oauthBtn =
    'w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 border transition-colors hover:bg-[rgb(var(--lk-fg-raw)/0.06)]';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0 bg-black/50 backdrop-blur-md"
        style={{ animation: 'fade-in 0.2s ease forwards' }}
      />

      {/* Glass Card — compact, centered, NOT full screen */}
      <div
        className="lk-glass relative w-full max-w-[380px] rounded-3xl p-7"
        style={{
          animation: 'auth-card-in 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        {/* Close button */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[rgb(var(--lk-fg-raw)/0.08)]"
          style={{ color: 'rgb(var(--lk-fg-raw) / 0.5)' }}
        >
          <span className="i-ph:x text-base" />
        </button>

        {/* Logo + Title */}
        <div className="flex flex-col items-center text-center mb-6">
          <img
            src={markSrc}
            alt="Palmkit"
            className="w-12 h-12 mb-3 select-none"
            style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.25))' }}
          />
          <h2 className="text-lg font-bold tracking-tight" style={{ color: 'var(--lk-fg)' }}>
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-xs mt-1" style={{ color: 'rgb(var(--lk-fg-raw) / 0.5)' }}>
            {mode === 'login'
              ? 'Log in to keep your projects in sync.'
              : 'Sign up to start building apps from prompts.'}
          </p>
        </div>

        {/* OAuth buttons */}
        <div className="flex flex-col gap-2">
          <a
            href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
            className={oauthBtn}
            style={{
              borderColor: 'rgb(var(--lk-fg-raw) / 0.12)',
              color: 'rgb(var(--lk-fg-raw) / 0.8)',
              background: 'rgb(var(--lk-fg-raw) / 0.03)',
            }}
          >
            <span className="i-ph:github-logo-fill text-base" />
            Continue with GitHub
          </a>
          <a
            href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
            className={oauthBtn}
            style={{
              borderColor: 'rgb(var(--lk-fg-raw) / 0.12)',
              color: 'rgb(var(--lk-fg-raw) / 0.8)',
              background: 'rgb(var(--lk-fg-raw) / 0.03)',
            }}
          >
            <span className="i-ph:x-logo-fill text-base" />
            Continue with X
          </a>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="h-px flex-1" style={{ background: 'rgb(var(--lk-fg-raw) / 0.08)' }} />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgb(var(--lk-fg-raw) / 0.3)' }}>
            or
          </span>
          <div className="h-px flex-1" style={{ background: 'rgb(var(--lk-fg-raw) / 0.08)' }} />
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
              background: 'rgb(var(--lk-fg-raw) / 0.04)',
              borderColor: 'rgb(var(--lk-fg-raw) / 0.1)',
              color: 'var(--lk-fg)',
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
              background: 'rgb(var(--lk-fg-raw) / 0.04)',
              borderColor: 'rgb(var(--lk-fg-raw) / 0.1)',
              color: 'var(--lk-fg)',
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
              background: 'var(--lk-accent)',
              color: 'var(--lk-accent-fg)',
              boxShadow: '0 4px 14px -4px rgb(var(--lk-glass-shadow) / 0.5)',
            }}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </Form>

        {/* Toggle login/signup */}
        <p className="mt-4 text-center text-xs" style={{ color: 'rgb(var(--lk-fg-raw) / 0.4)' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="font-semibold underline"
            style={{ color: 'var(--lk-accent)' }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>

      {/* Inline keyframes for the card animation */}
      <style>{`
        @keyframes auth-card-in {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
