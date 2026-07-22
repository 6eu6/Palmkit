import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — popup that shows login/signup form on the landing page
 * instead of navigating to a separate /login route.
 *
 * Two modes:
 *   - 'login' (default): email/password + OAuth buttons
 *   - 'signup': email/password + OAuth buttons (linked to /signup route)
 *
 * Styled to match the landing page's liquid glass aesthetic.
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

  const oauthBtn =
    'w-full h-11 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 border transition-colors';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={{ animation: 'fade-in 0.2s ease forwards' }}
      />

      {/* Sheet / Card — liquid glass matching landing page */}
      <div
        className="lk-glass relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6 pb-8 sm:pb-6"
        style={{
          animation: 'slide-up 0.28s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
          style={{ color: 'var(--lk-fg)' }}
        >
          <span className="i-ph:x text-lg" />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/palmkit-icon.jpg" alt="Palmkit" className="w-14 h-14 rounded-2xl mb-3 shadow-lg" />
          <h2 className="text-xl font-bold tracking-tight" style={{ color: 'var(--lk-fg)' }}>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'rgb(var(--lk-fg-raw) / 0.6)' }}>
            {mode === 'login'
              ? 'Log in to keep your projects and key in sync.'
              : 'Sign up to generate, preview, and keep your projects.'}
          </p>
        </div>

        {/* OAuth buttons */}
        <div className="flex flex-col gap-2.5">
          <a
            href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
            className={oauthBtn}
            style={{
              borderColor: 'rgb(var(--lk-fg-raw) / 0.15)',
              color: 'var(--lk-fg)',
              background: 'rgb(var(--lk-fg-raw) / 0.04)',
            }}
          >
            <span className="i-ph:github-logo-fill text-lg" />
            Continue with GitHub
          </a>

          <a
            href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
            className={oauthBtn}
            style={{
              borderColor: 'rgb(var(--lk-fg-raw) / 0.15)',
              color: 'var(--lk-fg)',
              background: 'rgb(var(--lk-fg-raw) / 0.04)',
            }}
          >
            <span className="i-ph:x-logo-fill text-lg" />
            Continue with X
          </a>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="h-px flex-1" style={{ background: 'rgb(var(--lk-fg-raw) / 0.12)' }} />
          <span className="text-[11px]" style={{ color: 'rgb(var(--lk-fg-raw) / 0.4)' }}>
            or
          </span>
          <div className="h-px flex-1" style={{ background: 'rgb(var(--lk-fg-raw) / 0.12)' }} />
        </div>

        {/* Email/password form */}
        <Form method="post" action={mode === 'login' ? '/login' : '/signup'} className="flex flex-col gap-3">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <label className="block">
            <span className="block text-xs font-medium mb-1.5" style={{ color: 'rgb(var(--lk-fg-raw) / 0.6)' }}>
              Email
            </span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className="w-full h-11 px-3.5 rounded-xl text-sm border focus:outline-none focus:ring-2 transition-all"
              style={{
                background: 'rgb(var(--lk-fg-raw) / 0.06)',
                borderColor: 'rgb(var(--lk-fg-raw) / 0.15)',
                color: 'var(--lk-fg)',
              }}
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium mb-1.5" style={{ color: 'rgb(var(--lk-fg-raw) / 0.6)' }}>
              Password
            </span>
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              placeholder="••••••••"
              className="w-full h-11 px-3.5 rounded-xl text-sm border focus:outline-none focus:ring-2 transition-all"
              style={{
                background: 'rgb(var(--lk-fg-raw) / 0.06)',
                borderColor: 'rgb(var(--lk-fg-raw) / 0.15)',
                color: 'var(--lk-fg)',
              }}
            />
          </label>

          {actionData?.error && (
            <div
              className="flex items-start gap-2 p-3 rounded-xl text-xs"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
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
            className="w-full h-11 rounded-xl font-medium text-sm transition-opacity disabled:opacity-60 mt-1"
            style={{
              background: 'var(--lk-accent)',
              color: 'var(--lk-accent-fg)',
            }}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
          </button>
        </Form>

        {/* Toggle login/signup */}
        <p className="mt-4 text-center text-xs" style={{ color: 'rgb(var(--lk-fg-raw) / 0.5)' }}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="underline font-medium"
            style={{ color: 'var(--lk-accent)' }}
          >
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}
