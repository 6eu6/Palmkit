import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — Liquid Glass login card.
 *
 * Design spec (from AI-generated reference):
 *   - Portrait card (~380×500), large border-radius (28px)
 *   - Semi-transparent dark glass: rgba(20,20,25,0.6) + blur(40px)
 *   - Specular highlight: diagonal white gradient overlay (10% opacity)
 *   - Orange accent glow on borders and buttons
 *   - Generous padding (40px), consistent gaps (20px)
 *   - Inputs: translucent dark bg + thin orange border + rounded 14px
 *   - Buttons: pill shape, orange border + glow
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

  const isDark =
    typeof document !== 'undefined' &&
    (document.documentElement.getAttribute('data-landing-theme') === 'dark' ||
      !document.documentElement.getAttribute('data-landing-theme'));

  // ── Theme tokens ──
  const T = isDark
    ? {
        // Dark: charcoal glass + warm coral accent
        cardBg: 'rgba(18, 18, 22, 0.6)',
        blur: 'blur(40px) saturate(180%)',
        specular:
          'linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 40%, rgba(255,255,255,0) 70%)',
        innerShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
        outerShadow: '0 30px 80px -20px rgba(0,0,0,0.8)',
        border: '1px solid rgba(255,255,255,0.06)',
        accentGlow: '0 0 20px rgba(216,130,92,0.15)',
        text: '#F0EDE8',
        subtext: 'rgba(240,237,232,0.4)',
        inputBg: 'rgba(255,255,255,0.04)',
        inputBorder: '1px solid rgba(216,130,92,0.15)',
        inputFocus: '1px solid rgba(216,130,92,0.4)',
        inputFocusGlow: '0 0 12px rgba(216,130,92,0.15)',
        btnBorder: '1px solid rgba(216,130,92,0.25)',
        btnBg: 'rgba(216,130,92,0.08)',
        btnHover: 'rgba(216,130,92,0.15)',
        btnGlow: '0 0 15px rgba(216,130,92,0.2)',
        accent: '#D8825C',
        accentFg: '#16120c',
        accentSolid: '#D8825C',
        accentSolidGlow: '0 4px 20px rgba(216,130,92,0.4)',
        divider: 'rgba(255,255,255,0.05)',
        mark: '/palmkit-mark-ondark.png',
        backdrop: 'rgba(0,0,0,0.5)',
        ambient: 'radial-gradient(circle, rgba(216,130,92,0.12) 0%, transparent 70%)',
      }
    : {
        // Light: frosted cream glass + warm rust accent
        cardBg: 'rgba(240,235,225,0.6)',
        blur: 'blur(40px) saturate(150%)',
        specular:
          'linear-gradient(135deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.15) 40%, rgba(255,255,255,0) 70%)',
        innerShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
        outerShadow: '0 30px 80px -20px rgba(80,50,30,0.3)',
        border: '1px solid rgba(255,255,255,0.25)',
        accentGlow: '0 0 20px rgba(156,74,46,0.10)',
        text: '#221E16',
        subtext: 'rgba(34,30,22,0.4)',
        inputBg: 'rgba(255,255,255,0.25)',
        inputBorder: '1px solid rgba(156,74,46,0.12)',
        inputFocus: '1px solid rgba(156,74,46,0.35)',
        inputFocusGlow: '0 0 12px rgba(156,74,46,0.10)',
        btnBorder: '1px solid rgba(156,74,46,0.2)',
        btnBg: 'rgba(156,74,46,0.05)',
        btnHover: 'rgba(156,74,46,0.12)',
        btnGlow: '0 0 15px rgba(156,74,46,0.15)',
        accent: '#9C4A2E',
        accentFg: '#FBF7EE',
        accentSolid: '#9C4A2E',
        accentSolidGlow: '0 4px 20px rgba(156,74,46,0.3)',
        divider: 'rgba(34,30,22,0.05)',
        mark: '/palmkit-mark.png',
        backdrop: 'rgba(30,25,18,0.3)',
        ambient: 'radial-gradient(circle, rgba(156,74,46,0.08) 0%, transparent 70%)',
      };

  const inputStyle = {
    background: T.inputBg,
    border: T.inputBorder,
    color: T.text,
    borderRadius: '14px',
  };

  const btnStyle = {
    background: T.btnBg,
    border: T.btnBorder,
    color: T.text,
    boxShadow: T.btnGlow,
    borderRadius: '14px',
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'lg-fade 0.25s ease forwards' }}
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

      {/* Ambient glow behind card */}
      <div
        className="absolute"
        style={{
          width: '420px',
          height: '420px',
          maxWidth: 'calc(100vw - 32px)',
          background: T.ambient,
          filter: 'blur(60px)',
          animation: 'lg-fade 0.4s ease 0.1s forwards',
          opacity: 0,
        }}
      />

      {/* ── LIQUID GLASS CARD ── */}
      <div
        className="relative rounded-[28px] overflow-hidden"
        style={{
          width: '380px',
          maxWidth: 'calc(100vw - 32px)',
          padding: '40px 36px',
          background: T.cardBg,
          backdropFilter: T.blur,
          WebkitBackdropFilter: T.blur,
          boxShadow: `${T.innerShadow}, ${T.outerShadow}`,
          border: T.border,
          animation: 'lg-pop 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'Inter', system-ui, sans-serif",
          color: T.text,
        }}
      >
        {/* Specular highlight overlay (glossy sheen) */}
        <div className="absolute inset-0 pointer-events-none rounded-[28px]" style={{ background: T.specular }} />

        {/* Close */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center z-10 transition-colors hover:bg-white/10"
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
            className="w-12 h-12 mb-4 select-none"
            style={{ pointerEvents: 'none', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.15))' }}
          />

          {/* Title */}
          <h2
            className="text-xl font-bold tracking-tight mb-1"
            style={{ color: T.text, fontFamily: "'Boska', Georgia, serif" }}
          >
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h2>
          <p className="text-xs mb-7" style={{ color: T.subtext }}>
            {mode === 'login' ? 'Log in to keep your projects in sync.' : 'Start building apps from prompts.'}
          </p>

          {/* OAuth — side by side */}
          <div className="flex gap-3 w-full mb-4">
            <a
              href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-11 flex items-center justify-center gap-2 text-[13px] font-medium transition-all hover:scale-[1.02]"
              style={btnStyle}
            >
              <span className="i-ph:github-logo-fill text-base" />
              GitHub
            </a>
            <a
              href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-11 flex items-center justify-center gap-2 text-[13px] font-medium transition-all hover:scale-[1.02]"
              style={btnStyle}
            >
              <span className="i-ph:x-logo-fill text-base" />X
            </a>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 w-full mb-4">
            <div className="h-px flex-1" style={{ background: T.divider }} />
            <span className="text-[10px] uppercase tracking-wider" style={{ color: T.subtext }}>
              or
            </span>
            <div className="h-px flex-1" style={{ background: T.divider }} />
          </div>

          {/* Form */}
          <Form method="post" action={mode === 'login' ? '/login' : '/signup'} className="flex flex-col gap-3 w-full">
            <input type="hidden" name="redirectTo" value={redirectTo} />

            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="Email"
              className="w-full h-11 px-4 text-[13px] focus:outline-none transition-all"
              style={inputStyle}
            />
            <input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              placeholder="Password"
              className="w-full h-11 px-4 text-[13px] focus:outline-none transition-all"
              style={inputStyle}
            />

            {actionData?.error && (
              <p className="text-[11px] px-1" style={{ color: isDark ? '#fca5a5' : '#dc2626' }}>
                {actionData.error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 text-[13px] font-semibold transition-all disabled:opacity-50 mt-1 hover:scale-[1.02]"
              style={{
                background: T.accentSolid,
                color: T.accentFg,
                borderRadius: '14px',
                boxShadow: T.accentSolidGlow,
              }}
            >
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}
            </button>
          </Form>

          {/* Toggle */}
          <p className="mt-5 text-xs" style={{ color: T.subtext }}>
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
        @keyframes lg-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes lg-pop { from { opacity: 0; transform: scale(0.92) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  );
}
