import { Link } from '@remix-run/react';
import type { ReactNode } from 'react';

/**
 * Marketing landing page shown to logged-out visitors at "/". Mobile-first,
 * dark with violet + teal accents, consistent with the Palmkit identity. The
 * editor lives behind authentication.
 */
export function Landing() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary overflow-x-hidden">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <Features />
        <HowItWorks />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  return (
    <header
      className="sticky top-0 z-20 flex items-center px-4 sm:px-6 h-14 border-b backdrop-blur-xl"
      style={{
        background: 'var(--bolt-mobile-surface-bg, rgba(10,10,18,0.85))',
        borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.14))',
      }}
    >
      <Link to="/" className="flex items-center" aria-label="Palmkit home">
        <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-7 w-auto select-none" />
      </Link>
      <div className="ml-auto flex items-center gap-2">
        <Link
          to="/login"
          className="h-9 px-3.5 flex items-center text-sm font-medium text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
        >
          Log in
        </Link>
        <Link
          to="/signup"
          className="h-9 px-4 flex items-center rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6234bb 100%)' }}
        >
          Sign up
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative px-5 sm:px-6 pt-16 sm:pt-24 pb-14 sm:pb-20 text-center">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(139,92,246,0.18) 0%, rgba(45,212,191,0.06) 40%, transparent 70%)',
        }}
      />
      <div
        className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium px-3 py-1.5 rounded-full mb-6"
        style={{
          background: 'var(--bolt-teal-subtle, rgba(45,212,191,0.08))',
          color: 'var(--bolt-teal-text, #5eead4)',
        }}
      >
        <span className="i-ph:sparkle-fill text-xs" />
        Build apps by chatting — from your phone
      </div>

      <h1 className="mx-auto max-w-3xl text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05]">
        Ship web apps
        <br />
        <span
          style={{
            background: 'linear-gradient(110deg, #a78bfa 0%, #8b5cf6 40%, #2dd4bf 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          from your pocket
        </span>
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-base sm:text-lg text-bolt-elements-textSecondary leading-relaxed">
        Describe what you want. Palmkit generates the code, installs dependencies, and shows a live preview — all in
        your browser, on any device.
      </p>

      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          to="/signup"
          className="w-full sm:w-auto h-12 px-7 flex items-center justify-center rounded-xl text-sm font-semibold text-white transition-transform active:scale-[0.98] hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #6234bb 100%)',
            boxShadow: '0 8px 30px rgba(139,92,246,0.35)',
          }}
        >
          Start building — it's free
        </Link>
        <Link
          to="/login"
          className="w-full sm:w-auto h-12 px-7 flex items-center justify-center rounded-xl text-sm font-semibold border border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 transition-colors"
        >
          Log in
        </Link>
      </div>

      <p className="mt-4 text-xs text-bolt-elements-textTertiary">Bring your own AI key · No credit card</p>
    </section>
  );
}

function Features() {
  const items = [
    {
      icon: 'i-ph:chat-circle-dots-fill',
      title: 'Build by chatting',
      body: 'Describe a feature in plain language and watch the files appear, edit, and refine in real time.',
      tint: 'var(--bolt-mobile-accent-text, #c4b5fd)',
      bg: 'var(--bolt-mobile-accent-subtle, rgba(139,92,246,0.08))',
    },
    {
      icon: 'i-ph:rocket-launch-fill',
      title: 'Live preview, real runtime',
      body: 'Dependencies install and your app runs in a cloud sandbox — a real preview, not a mockup.',
      tint: 'var(--bolt-teal-text, #5eead4)',
      bg: 'var(--bolt-teal-subtle, rgba(45,212,191,0.08))',
    },
    {
      icon: 'i-ph:lock-key-fill',
      title: 'Your key, encrypted',
      body: 'Bring your own model key. It’s encrypted at rest and synced to your account so you never re-enter it.',
      tint: 'var(--bolt-mobile-accent-text, #c4b5fd)',
      bg: 'var(--bolt-mobile-accent-subtle, rgba(139,92,246,0.08))',
    },
    {
      icon: 'i-ph:device-mobile-fill',
      title: 'Made for mobile',
      body: 'A real mobile-first workspace — generate, preview, inspect elements, and export from your phone.',
      tint: 'var(--bolt-teal-text, #5eead4)',
      bg: 'var(--bolt-teal-subtle, rgba(45,212,191,0.08))',
    },
  ];

  return (
    <section className="px-5 sm:px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-5xl grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map((it) => (
          <div
            key={it.title}
            className="rounded-2xl border p-5 sm:p-6 transition-colors"
            style={{
              background: 'var(--bolt-mobile-surface-bg, rgba(255,255,255,0.02))',
              borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.12))',
            }}
          >
            <span
              className="flex items-center justify-center w-11 h-11 rounded-xl mb-4"
              style={{ background: it.bg, color: it.tint }}
            >
              <span className={`${it.icon} text-xl`} />
            </span>
            <h3 className="text-lg font-semibold mb-1.5">{it.title}</h3>
            <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: '1', title: 'Describe it', body: 'Tell Palmkit what to build in a sentence.' },
    { n: '2', title: 'Watch it build', body: 'Code is generated and runs live in a sandbox.' },
    { n: '3', title: 'Refine & export', body: 'Iterate by chatting, then export or deploy.' },
  ];

  return (
    <section className="px-5 sm:px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight mb-10">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {steps.map((s) => (
            <div key={s.n} className="text-center px-2">
              <span
                className="mx-auto mb-4 flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #2dd4bf 140%)' }}
              >
                {s.n}
              </span>
              <h3 className="text-base font-semibold mb-1">{s.title}</h3>
              <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 sm:px-6 py-14 sm:py-20">
      <div
        className="mx-auto max-w-3xl rounded-3xl border p-8 sm:p-12 text-center"
        style={{
          background:
            'radial-gradient(120% 120% at 50% 0%, rgba(139,92,246,0.14) 0%, rgba(45,212,191,0.05) 60%, transparent 100%)',
          borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.18))',
        }}
      >
        <h2 className="text-2xl sm:text-4xl font-bold tracking-tight mb-3">Your next app starts with a sentence</h2>
        <p className="text-bolt-elements-textSecondary mb-7 max-w-md mx-auto">
          Create a free account and build your first project in minutes.
        </p>
        <Link
          to="/signup"
          className="inline-flex h-12 px-8 items-center justify-center rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #6234bb 100%)',
            boxShadow: '0 8px 30px rgba(139,92,246,0.35)',
          }}
        >
          Get started free
        </Link>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer
      className="px-5 sm:px-6 py-8 border-t text-sm"
      style={{ borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.12))' }}
    >
      <div className="mx-auto max-w-5xl flex flex-col sm:flex-row items-center gap-4 sm:gap-0 justify-between">
        <Link to="/" className="flex items-center" aria-label="Palmkit home">
          <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-6 w-auto select-none opacity-90" />
        </Link>
        <div className="flex items-center gap-5 text-bolt-elements-textSecondary">
          <FooterLink to="/terms">Terms</FooterLink>
          <FooterLink to="/privacy">Privacy</FooterLink>
          <FooterLink to="/login">Log in</FooterLink>
        </div>
        <p className="text-xs text-bolt-elements-textTertiary">© {new Date().getFullYear()} Palmkit</p>
      </div>
    </footer>
  );
}

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="hover:text-bolt-elements-textPrimary transition-colors">
      {children}
    </Link>
  );
}
