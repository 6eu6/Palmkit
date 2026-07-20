import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import { LandingPromptBox, PENDING_PROMPT_KEY } from './LandingPromptBox';

/**
 * Marketing landing page — redesigned with a Liquid Glass aesthetic.
 *
 * The hero landscape (an animated painted valley) fills the first viewport;
 * the chat prompt box floats over it as liquid glass. A warm earthy palette
 * (tied to the landscape art) replaces the default teal. The footer is a
 * full-bleed day/night landscape with links overlaid on top, switching with
 * the theme. All seams between hero → belly → footer are dissolved with
 * long eased gradients so the page reads as one continuous skin.
 *
 * Auth flow: visitors type into the prompt box and submit; the box stashes
 * the prompt in sessionStorage and routes to /login (existing behaviour).
 */

type Theme = 'dark' | 'light';

function useLandingTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('palmkit-landing-theme');
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved);
      }
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

  const toggle = () => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('palmkit-landing-theme', next);
      } catch {
        /* noop */
      }
      return next;
    });
  };

  return [theme, toggle];
}

export function Landing() {
  const [theme, toggleTheme] = useLandingTheme();
  const isDark = theme === 'dark';

  return (
    <div
      data-landing-theme={theme}
      className="lk-root lk-grain flex min-h-[100dvh] flex-col overflow-x-hidden"
      style={{ background: 'var(--lk-bg)', color: 'var(--lk-fg)' }}
    >
      <LandingNav isDark={isDark} onToggleTheme={toggleTheme} />
      <main className="flex-1">
        <Hero />
        <BuildFlow />
      </main>
      <FooterScene isDark={isDark} />
    </div>
  );
}

/* ════════ Nav ════════ */

function LandingNav({ isDark, onToggleTheme }: { isDark: boolean; onToggleTheme: () => void }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const markSrc = isDark ? '/palmkit-mark-ondark.png' : '/palmkit-mark.png';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 sm:pt-5">
      <nav
        className="lk-glass pointer-events-auto flex w-full items-center justify-between gap-3 rounded-full py-2 pl-3 pr-2.5 transition-all duration-500 sm:pl-5 sm:pr-3"
        style={{
          maxWidth: scrolled ? '48rem' : '80rem',
          paddingBlock: scrolled ? '0.375rem' : '0.5rem',
        }}
      >
        <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Palmkit home">
          <img src={markSrc} alt="" className="h-6 w-6 select-none" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }} />
          <span className="lk-display text-[1.2rem] font-semibold leading-none tracking-tight" style={{ color: 'var(--lk-fg)' }}>
            Palmkit
          </span>
        </Link>

        {/* center links — desktop */}
        <div className="hidden items-center gap-7 md:flex">
          {[
            { label: 'How it works', href: '#build' },
            { label: 'Templates', href: '#templates' },
            { label: 'Pricing', href: '#pricing' },
          ].map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm transition-colors duration-200 hover:opacity-100"
              style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to light' : 'Switch to dark'}
            className="grid h-8 w-8 place-items-center rounded-full transition-colors"
            style={{ color: 'var(--lk-fg)' }}
          >
            {isDark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <Link
            to="/login"
            className="hidden text-sm transition-colors hover:opacity-100 sm:inline-flex"
            style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
            style={{
              background: 'var(--lk-accent)',
              color: 'var(--lk-accent-fg)',
              boxShadow: '0 6px 20px -8px rgb(var(--lk-glass-shadow) / 0.55)',
            }}
          >
            Open Palmkit
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M5 3.5 H12 V10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </nav>
    </div>
  );
}

/* ════════ Hero — full viewport with landscape + prompt box ════════ */

function Hero() {
  return (
    <section id="top" className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden">
      {/* landscape atmosphere */}
      <div className="absolute inset-0 -z-10">
        <img
          src="/hero-landscape.gif"
          alt="A painted valley at dawn — still lake, pine forest and snow-capped peaks under a soft pink sky."
          className="lk-drift h-full w-full object-cover"
          style={{ objectFit: 'cover' }}
        />
        {/* legibility scrim behind headline */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(130% 60% at 50% 34%, rgba(20,16,12,0.46) 0%, rgba(20,16,12,0.20) 40%, rgba(20,16,12,0) 66%)',
          }}
        />
        {/* bottom feather into page surface */}
        <div
          className="absolute inset-x-0 bottom-0 h-[42%]"
          style={{
            background:
              'linear-gradient(to bottom, rgb(var(--lk-bg-raw) / 0) 0%, rgb(var(--lk-bg-raw) / 0.25) 35%, rgb(var(--lk-bg-raw) / 0.72) 72%, var(--lk-bg) 100%)',
          }}
        />
      </div>

      {/* headline */}
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-5 pb-4 pt-24 text-center sm:pt-28">
        <h1
          className="lk-display font-semibold leading-[0.98] tracking-[-0.02em]"
          style={{
            fontSize: 'clamp(2.2rem, 6.5vw, 5rem)',
            color: '#FBF7EE',
            textShadow: '0 2px 18px rgba(20,16,12,0.5)',
          }}
        >
          Build web apps
          <br />
          from{' '}
          <em className="lk-display italic" style={{ color: '#E8A98C' }}>
            wherever
          </em>{' '}
          you are.
        </h1>
        <p
          className="mt-4 max-w-[50ch] text-[0.95rem] leading-relaxed sm:mt-5 sm:text-[1.05rem]"
          style={{ color: 'rgba(242,232,218,0.9)', textShadow: '0 1px 8px rgba(20,16,12,0.45)' }}
        >
          One prompt becomes a live, exportable app — drafted, previewed and shipped straight from your phone.
        </p>
      </div>

      {/* prompt box — anchored to bottom of viewport, fully visible */}
      <div className="relative z-20 mx-auto w-full max-w-2xl px-4 pb-5 sm:px-6 sm:pb-7">
        <LandingPromptBox variant="hero" />
      </div>
    </section>
  );
}

/* ════════ Build flow — the middle beat ════════ */

function BuildFlow() {
  const habits = [
    { name: 'Read 20 pages', streak: 18, done: [1, 1, 1, 1, 1, 0, 0] },
    { name: 'Walk after lunch', streak: 9, done: [1, 1, 0, 1, 1, 1, 0] },
    { name: 'No phone before 9', streak: 31, done: [1, 1, 1, 1, 1, 1, 0] },
  ];

  return (
    <section id="build" className="lk-grain relative w-full overflow-hidden px-4 pb-32 pt-16 sm:px-6 sm:pb-40 sm:pt-24">
      {/* top bridge — continues hero fade */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background: 'linear-gradient(to bottom, rgb(var(--lk-bg-raw) / 0) 0%, var(--lk-bg) 100%)',
        }}
      />
      {/* bottom bridge — tones toward footer */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56"
        style={{
          background:
            'linear-gradient(to bottom, rgb(var(--lk-bg-raw) / 0) 0%, rgb(var(--lk-bg-raw) / 0.5) 45%, rgb(var(--lk-bg-raw) / 0.85) 100%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-6xl">
        <div className="max-w-2xl">
          <h2
            className="lk-display font-semibold leading-[1.05] tracking-[-0.02em]"
            style={{ fontSize: 'clamp(1.8rem, 4.5vw, 3rem)', color: 'var(--lk-fg)' }}
          >
            From one line to a <em className="italic" style={{ color: 'var(--lk-accent)' }}>running app</em>.
          </h2>
          <p className="mt-4 max-w-[52ch] text-[0.98rem] leading-relaxed sm:text-[1.05rem]" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>
            Palmkit drafts the app, stands up a live preview you can poke at, and exports the code the moment you&rsquo;re happy. No setup, no boilerplate, no laptop required.
          </p>
        </div>

        {/* the island — prompt ↔ live preview */}
        <div
          className="relative mt-12 overflow-hidden rounded-[1.5rem] border"
          style={{
            borderColor: 'rgb(var(--lk-bg-raw) / 0.12)',
            background: 'rgb(var(--lk-glass-fill) / 0.5)',
            boxShadow: '0 30px 80px -50px rgba(20,16,12,0.5)',
          }}
        >
          <div className="flex items-center justify-between border-b px-5 py-3 sm:px-7" style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)' }}>
            <span className="text-xs font-medium" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>Draft</span>
            <span className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>
              <span className="h-px w-8" style={{ background: 'rgb(var(--lk-bg-raw) / 0.2)' }} />
              Preview
              <span className="h-px w-8" style={{ background: 'rgb(var(--lk-bg-raw) / 0.2)' }} />
            </span>
            <span className="text-xs font-medium" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>Export</span>
          </div>

          <div className="grid gap-px md:grid-cols-2" style={{ background: 'rgb(var(--lk-bg-raw) / 0.1)' }}>
            {/* LEFT — prompt + files */}
            <div className="p-5 sm:p-7" style={{ background: 'rgb(var(--lk-glass-fill) / 0.3)' }}>
              <div className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lk-accent)' }} />
                you
              </div>
              <p className="lk-display mt-2.5 text-[1.1rem] leading-snug" style={{ color: 'var(--lk-fg)' }}>
                &ldquo;A habit tracker with streaks, a week view, and dark mode.&rdquo;
              </p>
              <div className="mt-6 space-y-1.5">
                <p className="text-xs" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>drafted in 4.2s</p>
                <div
                  className="rounded-lg border p-3 font-mono text-[0.78rem] leading-relaxed"
                  style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.12)', background: 'rgb(var(--lk-bg-raw) / 0.04)', color: 'rgb(var(--lk-bg-raw) / 0.55)' }}
                >
                  <div style={{ color: 'rgb(var(--lk-bg-raw) / 0.8)' }}>app/</div>
                  <div className="pl-3">├─ page.tsx</div>
                  <div className="pl-3">├─ habits.json</div>
                  <div className="pl-3">├─ components/</div>
                  <div className="pl-6">├─ Tracker.tsx</div>
                  <div className="pl-6">└─ Streak.tsx</div>
                  <div className="pl-3">└─ styles/globals.css</div>
                </div>
              </div>
            </div>

            {/* RIGHT — live preview */}
            <div className="p-5 sm:p-7" style={{ background: 'rgb(var(--lk-bg-raw) / 0.04)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="lk-display text-base font-semibold" style={{ color: 'var(--lk-fg)' }}>Today</p>
                  <p className="text-xs" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>3 of 3 in reach</p>
                </div>
                <div
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem]"
                  style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.15)', color: 'rgb(var(--lk-bg-raw) / 0.6)', background: 'rgb(var(--lk-bg-raw) / 0.04)' }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lk-accent)' }} />
                  live preview
                </div>
              </div>
              <div className="mt-4 space-y-2.5">
                {habits.map((h) => (
                  <div
                    key={h.name}
                    className="flex items-center justify-between rounded-xl border px-3.5 py-3"
                    style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)', background: 'rgb(var(--lk-glass-fill) / 0.3)' }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="grid h-5 w-5 place-items-center rounded-md"
                        style={{ background: 'var(--lk-accent)', color: 'var(--lk-accent-fg)' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6.2 L4.8 8.4 L9.5 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="text-sm" style={{ color: 'var(--lk-fg)' }}>{h.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {h.done.map((d, i) => (
                          <span
                            key={i}
                            className="h-2 w-2 rounded-full"
                            style={{ background: d ? 'var(--lk-accent)' : 'rgb(var(--lk-bg-raw) / 0.2)' }}
                          />
                        ))}
                      </div>
                      <span className="w-9 text-right font-mono text-xs" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>
                        {h.streak}d
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl px-3.5 py-2.5" style={{ background: 'rgb(var(--lk-glass-shadow) / 0.12)' }}>
                <span className="text-xs" style={{ color: 'rgb(var(--lk-bg-raw) / 0.8)' }}>Longest streak this week</span>
                <span className="font-mono text-sm font-medium" style={{ color: 'var(--lk-accent)' }}>31 days</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5 sm:px-7" style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)' }}>
            <span className="text-xs" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>Export as Next.js · React · or a single HTML file</span>
            <button className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors" style={{ color: 'var(--lk-fg)' }}>
              Ship it
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M5 3.5 H12 V10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* templates anchor */}
        <div id="templates" className="mt-20 flex flex-col gap-6 border-t pt-10 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)' }}>
          <div>
            <p className="lk-display text-[1.4rem] font-semibold tracking-tight" style={{ color: 'var(--lk-fg)' }}>
              Start from a sketch, not a blank page.
            </p>
            <p className="mt-1.5 text-sm" style={{ color: 'rgb(var(--lk-bg-raw) / 0.6)' }}>
              Twelve hand-built templates — dashboards, storefronts, journals, portfolios — ready to remix.
            </p>
          </div>
          <Link to="/signup" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium transition-colors" style={{ color: 'var(--lk-fg)' }}>
            Browse templates
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M5 3.5 H12 V10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ════════ Footer — full-bleed landscape with links overlaid ════════ */

const FOOTER_COLS: { heading: string; links: { label: string; to: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'How it works', to: '/#build' },
      { label: 'Templates', to: '/#templates' },
      { label: 'Pricing', to: '/#pricing' },
      { label: 'Changelog', to: '/#' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Docs', to: '/#' },
      { label: 'Community', to: '/#' },
      { label: 'Status', to: '/#' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', to: '/#' },
      { label: 'Contact', to: '/#' },
      { label: 'Privacy', to: '/privacy' },
    ],
  },
];

function FooterScene({ isDark }: { isDark: boolean }) {
  const gif = isDark ? '/footer-night.gif' : '/footer-day.gif';
  const alt = isDark
    ? 'A mountain lake under a deep night sky — pines and peaks reflected in still water.'
    : 'A mountain lake in bright daylight — pines, peaks and a clear blue sky.';
  const markSrc = isDark ? '/palmkit-mark-ondark.png' : '/palmkit-mark.png';

  return (
    <footer id="pricing" className="lk-grain relative w-full overflow-hidden">
      {/* full-bleed landscape background — long eased top fade */}
      <img
        src={gif}
        alt={alt}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, transparent 8%, rgba(0,0,0,0.12) 18%, rgba(0,0,0,0.42) 30%, rgba(0,0,0,0.78) 42%, #000 54%, #000 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, transparent 8%, rgba(0,0,0,0.12) 18%, rgba(0,0,0,0.42) 30%, rgba(0,0,0,0.78) 42%, #000 54%, #000 100%)',
        }}
      />

      {/* legibility scrim behind content */}
      <div
        className="absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(120% 60% at 50% 36%, rgba(6,4,2,0.55) 0%, rgba(6,4,2,0.30) 40%, rgba(6,4,2,0.10) 70%, rgba(6,4,2,0) 100%)'
            : 'radial-gradient(120% 60% at 50% 36%, rgba(20,16,12,0.22) 0%, rgba(20,16,12,0.10) 40%, rgba(20,16,12,0.02) 70%, rgba(20,16,12,0) 100%)',
        }}
      />

      {/* content overlay — links on the image */}
      <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-10 pt-28 sm:px-8 sm:pt-32">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <img
                src={markSrc}
                alt=""
                className="h-5 w-5 select-none"
                style={{ filter: 'drop-shadow(0 1px 6px rgba(20,16,12,0.7))' }}
              />
              <span
                className="lk-display text-lg font-semibold tracking-tight"
                style={{ color: '#FBF7EE', textShadow: '0 1px 8px rgba(20,16,12,0.6)' }}
              >
                Palmkit
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(242,232,218,0.85)', textShadow: '0 1px 6px rgba(20,16,12,0.5)' }}>
              The pocket workshop for AI-built web apps. Prompt, preview, export — from anywhere.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-3 sm:gap-x-16">
            {FOOTER_COLS.map((col) => (
              <div key={col.heading} className="space-y-3">
                <p className="text-sm font-medium" style={{ color: '#FBF7EE', textShadow: '0 1px 6px rgba(20,16,12,0.6)' }}>
                  {col.heading}
                </p>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        to={l.to}
                        className="text-sm transition-colors duration-200"
                        style={{ color: 'rgba(242,232,218,0.8)', textShadow: '0 1px 5px rgba(20,16,12,0.5)' }}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t pt-5 text-xs sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(242,232,218,0.75)' }}>
          <p style={{ textShadow: '0 1px 5px rgba(20,16,12,0.5)' }}>Built for pockets, wherever they open.</p>
          <p style={{ textShadow: '0 1px 5px rgba(20,16,12,0.5)' }}>© {new Date().getFullYear()} Palmkit.</p>
        </div>
      </div>

      {/* oversized wordmark */}
      <h2
        aria-hidden="true"
        className="lk-wordmark-halo lk-display pointer-events-none absolute inset-x-0 bottom-0 select-none text-center font-semibold leading-none tracking-[-0.03em]"
        style={{ color: '#FBF7EE', fontSize: 'clamp(4rem, 19vw, 17rem)', paddingBottom: '0.04em' }}
      >
        Palmkit
      </h2>

      <div className="relative z-10 h-[8vh] sm:h-[10vh]" />
    </footer>
  );
}
