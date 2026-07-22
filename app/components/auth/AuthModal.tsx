import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { Form, useActionData, useNavigation } from '@remix-run/react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Auth modal — Liquid Glass card.
 *
 * Visual design (from user spec):
 *   - Frosted + glossy finishes
 *   - Soft ambient lighting (glow behind card)
 *   - Layered depth with subtle shadows
 *   - Dark background with contrasting vibrant accents
 *   - Modern, sleek, high-resolution feel
 *   - 16:9 aspect ratio card (wide, not tall)
 *
 * Glass technique:
 *   1. Ambient glow layer (behind card): radial-gradient accent color
 *   2. Base glass: rgba dark + backdrop-filter blur(40px)
 *   3. Glossy top highlight: linear-gradient white/8% at top
 *   4. Inner border: inset box-shadow 1px white/6%
 *   5. Outer shadow: large soft drop shadow
 *   6. Border: 1px white/4% (barely visible, adds crispness)
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

  // Theme: dark + light — both with full liquid glass treatment
  const T = isDark
    ? {
        // Dark theme: deep charcoal glass with warm accent glow
        glassBg: 'rgba(16, 14, 10, 0.55)',
        glassBlur: 'blur(44px) saturate(180%)',
        glossHighlight:
          'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 30%, rgba(255,255,255,0) 60%)',
        innerBorder: 'inset 0 1px 0 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.04)',
        outerShadow: '0 24px 60px -12px rgba(0,0,0,0.7), 0 8px 24px -8px rgba(0,0,0,0.4)',
        outerBorder: '1px solid rgba(255,255,255,0.06)',
        ambientGlow:
          'radial-gradient(circle at 50% 50%, rgba(216,130,92,0.25) 0%, rgba(216,130,92,0.08) 40%, transparent 70%)',
        text: '#F5EFE0',
        subtext: 'rgba(245,239,224,0.45)',
        inputBg: 'rgba(255,255,255,0.04)',
        inputBorder: 'rgba(255,255,255,0.08)',
        inputFocus: 'rgba(216,130,92,0.3)',
        accent: '#D8825C',
        accentFg: '#16120c',
        accentGlow: '0 4px 20px -4px rgba(216,130,92,0.5)',
        divider: 'rgba(255,255,255,0.06)',
        mark: '/palmkit-mark-ondark.png',
      }
    : {
        // Light theme: frosted cream glass with warm accent glow
        glassBg: 'rgba(245,240,230,0.55)',
        glassBlur: 'blur(44px) saturate(150%)',
        glossHighlight:
          'linear-gradient(180deg, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.2) 30%, rgba(255,255,255,0) 60%)',
        innerBorder: 'inset 0 1px 0 0 rgba(255,255,255,0.6), inset 0 0 0 1px rgba(255,255,255,0.2)',
        outerShadow: '0 24px 60px -12px rgba(100,70,40,0.25), 0 8px 24px -8px rgba(100,70,40,0.15)',
        outerBorder: '1px solid rgba(255,255,255,0.3)',
        ambientGlow:
          'radial-gradient(circle at 50% 50%, rgba(156,74,46,0.18) 0%, rgba(156,74,46,0.06) 40%, transparent 70%)',
        text: '#221E16',
        subtext: 'rgba(34,30,22,0.45)',
        inputBg: 'rgba(255,255,255,0.3)',
        inputBorder: 'rgba(34,30,22,0.08)',
        inputFocus: 'rgba(156,74,46,0.25)',
        accent: '#9C4A2E',
        accentFg: '#FBF7EE',
        accentGlow: '0 4px 20px -4px rgba(156,74,46,0.4)',
        divider: 'rgba(34,30,22,0.06)',
        mark: '/palmkit-mark.png',
      };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      style={{ animation: 'lg-fade 0.25s ease forwards' }}
    >
      {/* Backdrop — dark blur */}
      <button
        aria-label="Close"
        onClick={closeAuthModal}
        className="absolute inset-0"
        style={{
          background: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(30,25,18,0.3)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      />

      {/* Ambient glow — behind the card, creates depth */}
      <div
        className="absolute"
        style={{
          width: '400px',
          height: '260px',
          maxWidth: 'calc(100vw - 32px)',
          background: T.ambientGlow,
          filter: 'blur(40px)',
          animation: 'lg-fade 0.4s ease 0.1s forwards',
          opacity: 0,
        }}
      />

      {/* LIQUID GLASS CARD — 16:9 wide format */}
      <div
        className="relative rounded-[24px] overflow-hidden flex flex-col justify-center"
        style={{
          width: '380px',
          height: '238px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          padding: '20px 24px',

          // Layer 1: base glass
          background: T.glassBg,
          backdropFilter: T.glassBlur,
          WebkitBackdropFilter: T.glassBlur,

          // Layer 2: all shadows (inner border + outer shadow)
          boxShadow: `${T.innerBorder}, ${T.outerShadow}`,

          // Layer 3: crisp outer border
          border: T.outerBorder,
          animation: 'lg-pop 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'Inter', system-ui, sans-serif",
          color: T.text,
        }}
      >
        {/* Layer 4: glossy top highlight — frosted glass effect */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: T.glossHighlight,
            borderRadius: 'inherit',
          }}
        />

        {/* Close button */}
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center z-10"
          style={{ color: T.subtext }}
        >
          <span className="i-ph:x text-xs" />
        </button>

        {/* Content — centered in the 16:9 card */}
        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Logo + title inline */}
          <div className="flex items-center gap-2 mb-2.5">
            <img src={T.mark} alt="" className="w-7 h-7 select-none" style={{ pointerEvents: 'none' }} />
            <h2
              className="text-sm font-bold tracking-tight"
              style={{ color: T.text, fontFamily: "'Boska', Georgia, serif" }}
            >
              {mode === 'login' ? 'Welcome back' : 'Create account'}
            </h2>
          </div>

          {/* OAuth — side by side */}
          <div className="flex gap-1.5 w-full mb-2">
            <a
              href={`/api/auth/github?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-8 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 border transition-all hover:bg-white/8"
              style={{ borderColor: T.inputBorder, color: T.subtext, background: T.inputBg }}
            >
              <span className="i-ph:github-logo-fill text-xs" />
              GitHub
            </a>
            <a
              href={`/api/auth/twitter?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="flex-1 h-8 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 border transition-all hover:bg-white/8"
              style={{ borderColor: T.inputBorder, color: T.subtext, background: T.inputBg }}
            >
              <span className="i-ph:x-logo-fill text-xs" />X
            </a>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 w-full mb-2">
            <div className="h-px flex-1" style={{ background: T.divider }} />
            <span className="text-[8px] uppercase tracking-wide" style={{ color: T.subtext }}>
              or
            </span>
            <div className="h-px flex-1" style={{ background: T.divider }} />
          </div>

          {/* Form — inputs side by side, button below */}
          <Form method="post" action={mode === 'login' ? '/login' : '/signup'} className="flex flex-col gap-1.5 w-full">
            <input type="hidden" name="redirectTo" value={redirectTo} />

            {/* Email + Password SIDE BY SIDE (saves vertical space for 16:9) */}
            <div className="flex gap-1.5">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="Email"
                className="flex-1 h-8 px-2.5 rounded-lg text-[11px] border focus:outline-none focus:ring-1 transition-all"
                style={{ background: T.inputBg, borderColor: T.inputBorder, color: T.text }}
              />
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                placeholder="Password"
                className="flex-1 h-8 px-2.5 rounded-lg text-[11px] border focus:outline-none focus:ring-1 transition-all"
                style={{ background: T.inputBg, borderColor: T.inputBorder, color: T.text }}
              />
            </div>

            {actionData?.error && (
              <p className="text-[9px] px-1" style={{ color: '#fca5a5' }}>
                {actionData.error}
              </p>
            )}

            {/* Submit + toggle inline */}
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                disabled={busy}
                className="flex-1 h-8 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50"
                style={{ background: T.accent, color: T.accentFg, boxShadow: T.accentGlow }}
              >
                {busy ? '…' : mode === 'login' ? 'Log in' : 'Sign up'}
              </button>
              <button
                type="button"
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                className="text-[10px] font-medium underline whitespace-nowrap"
                style={{ color: T.accent }}
              >
                {mode === 'login' ? 'Sign up' : 'Log in'}
              </button>
            </div>
          </Form>
        </div>
      </div>

      <style>{`
        @keyframes lg-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes lg-pop { from { opacity: 0; transform: scale(0.9) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  );
}
