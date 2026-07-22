import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth Modal — Liquid Glass v2.
 *
 * Built from AI-generated reference spec:
 *   - Card: 400px wide, rounded 28px, semi-transparent white 15% opacity
 *   - Glass: backdrop-filter blur(40px) saturate(180%)
 *   - Specular: diagonal white gradient overlay (top-left to bottom-right)
 *   - Edge glow: warm accent radial on bottom-left
 *   - Shadow: diffuse dark drop shadow
 *   - Inputs: underline style (no box), 48px height, bottom border only
 *   - Buttons: pill shape, accent border + glow
 *   - Two themes: dark + light
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

  // Theme detection from landing root element
  const isDark = (() => {
    if (typeof document === 'undefined') {
      return true;
    }

    const root = document.querySelector('[data-landing-theme]');

    if (root) {
      return root.getAttribute('data-landing-theme') === 'dark';
    }

    try {
      return localStorage.getItem('palmkit-landing-theme') !== 'light';
    } catch {
      return true;
    }
  })();

  // ── Liquid Glass theme tokens ──
  const T = isDark
    ? {
        // Dark: white-tinted glass over dark landscape
        cardBg: 'rgba(255, 255, 255, 0.08)',
        cardBlur: 'blur(40px) saturate(180%)',
        specular:
          'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0) 70%)',
        edgeGlow: 'radial-gradient(circle at 20% 90%, rgba(216,130,92,0.15) 0%, transparent 50%)',
        innerShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        outerShadow: '0 30px 80px -20px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.1)',
        text: '#F5F5F5',
        subtext: 'rgba(245,245,245,0.5)',
        inputBorder: 'rgba(255,255,255,0.15)',
        inputFocusBorder: 'rgba(216,130,92,0.5)',
        inputBg: 'transparent',
        btnBg: 'rgba(255,255,255,0.06)',
        btnBorder: '1px solid rgba(255,255,255,0.15)',
        btnGlow: '0 0 12px rgba(255,255,255,0.05)',
        accent: '#D8825C',
        accentFg: '#16120c',
        accentGlow: '0 4px 20px rgba(216,130,92,0.35)',
        divider: 'rgba(255,255,255,0.06)',
        mark: '/palmkit-mark-ondark.png',
        backdrop: 'rgba(0,0,0,0.5)',
        ambient: 'radial-gradient(circle, rgba(216,130,92,0.12) 0%, transparent 70%)',
      }
    : {
        // Light: dark-tinted glass over bright landscape
        cardBg: 'rgba(20, 18, 14, 0.06)',
        cardBlur: 'blur(40px) saturate(150%)',
        specular:
          'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.15) 40%, rgba(255,255,255,0) 70%)',
        edgeGlow: 'radial-gradient(circle at 20% 90%, rgba(156,74,46,0.10) 0%, transparent 50%)',
        innerShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
        outerShadow: '0 30px 80px -20px rgba(80,50,30,0.25)',
        border: '1px solid rgba(255,255,255,0.3)',
        text: '#221E16',
        subtext: 'rgba(34,30,22,0.5)',
        inputBorder: 'rgba(34,30,22,0.15)',
        inputFocusBorder: 'rgba(156,74,46,0.4)',
        inputBg: 'transparent',
        btnBg: 'rgba(34,30,22,0.04)',
        btnBorder: '1px solid rgba(34,30,22,0.15)',
        btnGlow: '0 0 12px rgba(34,30,22,0.05)',
        accent: '#9C4A2E',
        accentFg: '#FBF7EE',
        accentGlow: '0 4px 20px rgba(156,74,46,0.25)',
        divider: 'rgba(34,30,22,0.06)',
        mark: '/palmkit-mark.png',
        backdrop: 'rgba(30,25,18,0.3)',
        ambient: 'radial-gradient(circle, rgba(156,74,46,0.08) 0%, transparent 70%)',
      };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'ag-fade 0.25s ease forwards' }}
    >
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0"
        style={{
          background: T.backdrop,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      />

      {/* Ambient glow */}
      <div
        className="absolute"
        style={{
          width: '440px',
          height: '440px',
          maxWidth: 'calc(100vw - 32px)',
          background: T.ambient,
          filter: 'blur(60px)',
          animation: 'ag-fade 0.4s ease 0.1s forwards',
          opacity: 0,
        }}
      />

      {/* ── LIQUID GLASS CARD ── */}
      <div
        className="relative rounded-[28px] overflow-hidden"
        style={{
          width: '400px',
          maxWidth: 'calc(100vw - 32px)',
          padding: '36px 32px',
          background: T.cardBg,
          backdropFilter: T.cardBlur,
          WebkitBackdropFilter: T.cardBlur,
          boxShadow: `${T.innerShadow}, ${T.outerShadow}`,
          border: T.border,
          animation: 'ag-pop 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'Inter', system-ui, sans-serif",
          color: T.text,
        }}
      >
        {/* Specular highlight (glossy sheen) */}
        <div className="absolute inset-0 pointer-events-none rounded-[28px]" style={{ background: T.specular }} />

        {/* Edge glow (warm ambient from bottom-left) */}
        <div className="absolute inset-0 pointer-events-none rounded-[28px]" style={{ background: T.edgeGlow }} />

        {/* Close */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center z-10 transition-colors hover:bg-white/10"
          style={{ color: T.subtext }}
        >
          <span className="i-ph:x text-sm" />
        </button>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Logo */}
          <img
            src={T.mark}
            alt=""
            className="w-11 h-11 mb-5 select-none"
            style={{ pointerEvents: 'none', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))' }}
          />

          {/* Title */}
          <h2
            className="text-lg font-bold tracking-tight mb-1"
            style={{ color: T.text, fontFamily: "'Boska', Georgia, serif" }}
          >
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-[11px] mb-6" style={{ color: T.subtext }}>
            {mode === 'login' ? 'Log in to keep your projects in sync.' : 'Start building apps from prompts.'}
          </p>

          {/* OAuth — side by side */}
          <div className="flex gap-2.5 w-full mb-4">
            <a
              href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-10 flex items-center justify-center gap-1.5 text-[12px] font-medium transition-all hover:scale-[1.02]"
              style={{
                background: T.btnBg,
                border: T.btnBorder,
                borderRadius: '12px',
                color: T.text,
                boxShadow: T.btnGlow,
              }}
            >
              <span className="i-ph:github-logo-fill text-sm" />
              GitHub
            </a>
            <a
              href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-10 flex items-center justify-center gap-1.5 text-[12px] font-medium transition-all hover:scale-[1.02]"
              style={{
                background: T.btnBg,
                border: T.btnBorder,
                borderRadius: '12px',
                color: T.text,
                boxShadow: T.btnGlow,
              }}
            >
              <span className="i-ph:x-logo-fill text-sm" />X
            </a>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 w-full mb-4">
            <div className="h-px flex-1" style={{ background: T.divider }} />
            <span className="text-[9px] uppercase tracking-wider" style={{ color: T.subtext }}>
              or
            </span>
            <div className="h-px flex-1" style={{ background: T.divider }} />
          </div>

          {/* Form — underline-style inputs (no box) */}
          <Form
            method="post"
            action={mode === 'login' ? '/api/auth/login' : '/api/auth/signup'}
            className="flex flex-col gap-4 w-full"
          >
            <input type="hidden" name="redirectTo" value={redirectTo} />

            {/* Email — underline style */}
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide mb-1" style={{ color: T.subtext }}>
                Email
              </label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                className="w-full h-10 px-0 text-[14px] bg-transparent border-0 border-b focus:outline-none transition-colors"
                style={{ color: T.text, borderBottom: `1px solid ${T.inputBorder}` }}
              />
            </div>

            {/* Password — underline style */}
            <div className="flex flex-col">
              <label className="text-[10px] uppercase tracking-wide mb-1" style={{ color: T.subtext }}>
                Password
              </label>
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                placeholder="••••••••"
                className="w-full h-10 px-0 text-[14px] bg-transparent border-0 border-b focus:outline-none transition-colors"
                style={{ color: T.text, borderBottom: `1px solid ${T.inputBorder}` }}
              />
            </div>

            {actionData?.error && (
              <p className="text-[11px]" style={{ color: isDark ? '#fca5a5' : '#dc2626' }}>
                {actionData.error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 text-[13px] font-semibold transition-all disabled:opacity-50 mt-2 hover:scale-[1.02]"
              style={{
                background: T.accent,
                color: T.accentFg,
                borderRadius: '14px',
                boxShadow: T.accentGlow,
              }}
            >
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
            </button>
          </Form>

          {/* Toggle */}
          <p className="mt-5 text-[11px]" style={{ color: T.subtext }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
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
        @keyframes ag-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ag-pop { from { opacity: 0; transform: scale(0.92) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  );
}
