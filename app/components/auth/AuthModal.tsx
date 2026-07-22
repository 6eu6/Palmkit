import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — SQUARE compact card.
 *
 * The CARD ITSELF is square (340×340), not just the elements inside.
 * Content is vertically centered within the square.
 * Two themes: dark + light.
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
    typeof document !== 'undefined' &&
    (document.documentElement.getAttribute('data-landing-theme') === 'dark' ||
      !document.documentElement.getAttribute('data-landing-theme'));

  const T = isDark
    ? {
        bg: 'rgba(20,17,12,0.88)',
        text: '#ECE4D4',
        sub: 'rgba(236,228,212,0.45)',
        border: 'rgba(236,228,212,0.08)',
        input: 'rgba(236,228,212,0.03)',
        accent: '#D8825C',
        accentFg: '#16120c',
        div: 'rgba(236,228,212,0.06)',
        mark: '/palmkit-mark-ondark.png',
      }
    : {
        bg: 'rgba(231,224,210,0.88)',
        text: '#221E16',
        sub: 'rgba(34,30,22,0.45)',
        border: 'rgba(34,30,22,0.1)',
        input: 'rgba(34,30,22,0.03)',
        accent: '#9C4A2E',
        accentFg: '#FBF7EE',
        div: 'rgba(34,30,22,0.08)',
        mark: '/palmkit-mark.png',
      };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'af 0.2s ease forwards' }}
    >
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0"
        style={{
          background: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* SQUARE CARD — 340×340, content centered vertically */}
      <div
        className="relative rounded-[20px] flex flex-col justify-center"
        style={{
          width: '340px',
          height: '340px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          padding: '24px',
          background: T.bg,
          backdropFilter: 'blur(40px) saturate(150%)',
          WebkitBackdropFilter: 'blur(40px) saturate(150%)',
          boxShadow: `0 16px 40px -8px rgba(0,0,0,${isDark ? '0.55' : '0.3'}), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.04)`,
          border: `1px solid ${T.border}`,
          animation: 'ap 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'Inter', system-ui, sans-serif",
          color: T.text,
        }}
      >
        {/* Close */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ color: T.sub }}
        >
          <span className="i-ph:x text-xs" />
        </button>

        {/* Content — vertically centered in the square */}
        <div className="flex flex-col items-center text-center">
          {/* Logo */}
          <img src={T.mark} alt="" className="w-9 h-9 mb-2 select-none" style={{ pointerEvents: 'none' }} />
          <h2
            className="text-sm font-bold tracking-tight mb-0.5"
            style={{ color: T.text, fontFamily: "'Boska', Georgia, serif" }}
          >
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-[10px] mb-3" style={{ color: T.sub }}>
            {mode === 'login' ? 'Log in to your account' : 'Start building apps'}
          </p>

          {/* OAuth — side by side */}
          <div className="flex gap-1.5 w-full mb-2">
            <a
              href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-8 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 border transition-colors hover:bg-white/5"
              style={{ borderColor: T.border, color: T.sub, background: T.input }}
            >
              <span className="i-ph:github-logo-fill text-xs" />
              GitHub
            </a>
            <a
              href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-8 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 border transition-colors hover:bg-white/5"
              style={{ borderColor: T.border, color: T.sub, background: T.input }}
            >
              <span className="i-ph:x-logo-fill text-xs" />X
            </a>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 w-full mb-2">
            <div className="h-px flex-1" style={{ background: T.div }} />
            <span className="text-[8px] uppercase tracking-wide" style={{ color: T.sub }}>
              or
            </span>
            <div className="h-px flex-1" style={{ background: T.div }} />
          </div>

          {/* Form */}
          <Form method="post" action={mode === 'login' ? '/login' : '/signup'} className="flex flex-col gap-1.5 w-full">
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="Email"
              className="w-full h-8 px-3 rounded-lg text-[11px] border focus:outline-none focus:ring-1 transition-all"
              style={{ background: T.input, borderColor: T.border, color: T.text }}
            />
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              placeholder="Password"
              className="w-full h-8 px-3 rounded-lg text-[11px] border focus:outline-none focus:ring-1 transition-all"
              style={{ background: T.input, borderColor: T.border, color: T.text }}
            />
            {actionData?.error && (
              <p className="text-[9px] px-1" style={{ color: '#fca5a5' }}>
                {actionData.error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full h-8 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50 mt-0.5"
              style={{ background: T.accent, color: T.accentFg }}
            >
              {busy ? '…' : mode === 'login' ? 'Log in' : 'Sign up'}
            </button>
          </Form>

          {/* Toggle */}
          <p className="mt-2 text-[10px]" style={{ color: T.sub }}>
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
      </div>

      <style>{`
        @keyframes af { from{opacity:0} to{opacity:1} }
        @keyframes ap { from{opacity:0;transform:scale(0.9)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}
