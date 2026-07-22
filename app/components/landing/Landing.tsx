import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from '@remix-run/react';
import { LandingPromptBox } from './LandingPromptBox';
import { authModalStore } from '~/lib/stores/auth';
import { AuthModal } from '~/components/auth/AuthModal';

/**
 * Marketing landing page — redesigned with a Liquid Glass aesthetic.
 *
 * SEAMLESS BLEND — MASK-ONLY with LONG FADE + CLEAN HANDOFF:
 * Each image uses a CSS mask-image that fades its own alpha over a
 * very tall zone (~60-70% of the section height). The fade completes
 * BEFORE the section boundary, leaving a band of pure page-bg at the
 * top (footer) or bottom (hero) of each image section. This pure
 * page-bg band is the SAME color as the belly section's background,
 * so the hero→belly→footer handoff is page-bg → page-bg → page-bg =
 * invisible. No bridge overlays, no double-fades, no color mismatches.
 *
 * Hero: image alpha 1→0, fade completes at ~88-92% of viewport.
 *   Bottom ~8-12% is pure page-bg. NO radial scrim (the previous
 *   dark-center scrim hurt the animated image's beauty; headline
 *   legibility now relies on the triple-layer text halo alone).
 * Footer: image alpha 0→1, fade starts at ~10-16% of footer height.
 *   Top ~10-16% is pure page-bg. Legibility panel confined to MID
 *   band (transparent at top so it never darkens the seam zone).
 *
 * NAV: hamburger button (≡ → ✕) replaces the "Open Palmkit" text
 * button. Menu slides down from the nav pill itself. Same pattern on
 * mobile and desktop. Reference: hackathon.telegraphprotocol.com.
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

  /*
   * Circle-spread theme toggle — uses the View Transitions API to
   * animate the new theme as an expanding circle originating from
   * the click point. Falls back to an instant swap in browsers
   * without View Transitions support.
   */
  const toggle = useCallback((event?: { clientX: number; clientY: number }) => {
    const x = event?.clientX ?? window.innerWidth / 2;
    const y = event?.clientY ?? 0;

    try {
      document.documentElement.style.setProperty('--lk-tx', `${x}px`);
      document.documentElement.style.setProperty('--lk-ty', `${y}px`);
    } catch {
      /* noop */
    }

    const apply = () => {
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

    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };

    if (typeof doc.startViewTransition !== 'function') {
      apply();
      return;
    }

    doc.startViewTransition(() => {
      flushSync(apply);
    });
  }, []);

  return [theme, toggle];
}

export function Landing() {
  const [theme, toggleTheme] = useLandingTheme();
  const isDark = theme === 'dark';

  return (
    <div
      data-landing-theme={theme}
      className="lk-root flex min-h-[100dvh] flex-col overflow-x-hidden"
      style={{ background: 'var(--lk-bg)', color: 'var(--lk-fg)' }}
    >
      <LandingNav isDark={isDark} onToggleTheme={toggleTheme as (e?: { clientX: number; clientY: number }) => void} />
      <main className="flex-1">
        <Hero isDark={isDark} />
        <BuildFlow />
      </main>
      <FooterScene isDark={isDark} />
      <AuthModal />
    </div>
  );
}

/* ════════ Nav — hamburger menu (≡ → ✕) ════════ */

function LandingNav({
  isDark,
  onToggleTheme,
}: {
  isDark: boolean;
  onToggleTheme: (event?: { clientX: number; clientY: number }) => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);

      if (window.scrollY > 200) {
        setMenuOpen(false);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const markSrc = isDark ? '/palmkit-mark-ondark.png' : '/palmkit-mark.png';

  const menuItems = [
    { label: 'How it works', href: '#build' },
    { label: 'Templates', href: '#templates' },
    { label: 'Pricing', href: '#pricing' },
  ];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 sm:pt-5">
      {/* click-outside catcher — full viewport, below the nav/menu */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          className="pointer-events-auto fixed inset-0"
          style={{ zIndex: 0 }}
          aria-hidden="true"
        />
      )}
      <div
        className="pointer-events-auto relative w-full"
        style={{ maxWidth: scrolled ? '48rem' : '80rem', zIndex: 1 }}
      >
        <nav
          className="lk-glass flex w-full items-center justify-between gap-3 rounded-full py-2 pl-3 pr-2.5 transition-all duration-500 sm:pl-5 sm:pr-3"
          style={{ paddingBlock: scrolled ? '0.375rem' : '0.5rem' }}
        >
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Palmkit home">
            <img
              src={markSrc}
              alt=""
              className="h-6 w-6 select-none pointer-events-none"
              style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}
            />
            <span
              className="lk-display text-[1.2rem] font-semibold leading-none tracking-tight"
              style={{ color: 'var(--lk-fg)' }}
            >
              Palmkit
            </span>
          </Link>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={(e) => onToggleTheme(e)}
              aria-label={isDark ? 'Switch to light' : 'Switch to dark'}
              className="grid h-8 w-8 place-items-center rounded-full transition-colors"
              style={{ color: 'var(--lk-fg)' }}
            >
              {isDark ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              className="grid h-8 w-8 place-items-center rounded-full transition-colors"
              style={{ color: 'var(--lk-fg)' }}
            >
              <span className={`lk-ham${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
        </nav>

        {/* dropdown menu — slides down from the nav pill, flush with
            the header (no gap) so it reads as part of the nav itself */}
        <div
          className={`lk-menu lk-glass absolute left-0 right-0 top-full rounded-b-3xl rounded-t-2xl p-3${
            menuOpen ? ' is-open' : ''
          }`}
          style={{
            boxShadow:
              '0 20px 50px -20px rgb(var(--lk-glass-shadow) / 0.4), 0 2px 8px -4px rgb(var(--lk-glass-shadow) / 0.2)',
          }}
          role="menu"
        >
          <ul className="flex flex-col">
            {menuItems.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-2xl px-4 py-3 text-sm font-medium transition-colors hover:bg-[rgb(var(--lk-glass-fill)/0.5)]"
                  style={{ color: 'var(--lk-fg)' }}
                  role="menuitem"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2 border-t pt-2" style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)' }}>
            <button
              type="button"
              onClick={() => {
                authModalStore.set(true);
                setMenuOpen(false);
              }}
              className="flex-1 rounded-2xl px-4 py-3 text-sm font-medium transition-colors hover:bg-[rgb(var(--lk-glass-fill)/0.5)]"
              style={{ color: 'var(--lk-fg)', border: '1px solid rgb(var(--lk-fg-raw) / 0.12)' }}
              role="menuitem"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                authModalStore.set(true);
                setMenuOpen(false);
              }}
              className="flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
              style={{
                background: 'var(--lk-accent)',
                color: 'var(--lk-accent-fg)',
                boxShadow: '0 6px 20px -8px rgb(var(--lk-glass-shadow) / 0.55)',
              }}
              role="menuitem"
            >
              Sign up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * ════════ Hero — full viewport with landscape + prompt box ════════
 *
 * IMAGE MASK: image is FULLY visible in the top ~22-30%, then fades
 * out gradually over ~60% of the viewport. The fade completes at
 * ~88-92%, leaving the bottom ~8-12% as pure page-bg — a clean
 * handoff to the belly section below.
 *
 * NO RADIAL SCRIM: the animated image shows through clean. Headline
 * legibility comes from the triple-layer text halo (tight blur +
 * crisp 1px outline + wide soft halo) on the h1 and p elements.
 */

function Hero({ isDark }: { isDark: boolean }) {
  /*
   * MASK-ONLY (single fade). The image's own alpha fades out over a
   * very tall zone, revealing the page bg behind it. The fade
   * completes BEFORE the section boundary (at ~88-92%), so the last
   * 8-12% of the hero is pure page-bg — same color as the belly below.
   * Light mode has a longer, more gradual fade because the image's
   * dark forest bottom is far from the cream page bg.
   */
  const mask = isDark
    ? 'linear-gradient(to bottom, #000 0%, #000 70%, rgba(0,0,0,0.6) 85%, rgba(0,0,0,0) 100%)'
    : 'linear-gradient(to bottom, #000 0%, #000 65%, rgba(0,0,0,0.5) 82%, rgba(0,0,0,0) 100%)';

  return (
    <section id="top" className="relative flex h-[100svh] min-h-[100svh] flex-col overflow-hidden">
      {/* landscape atmosphere — NO radial scrim. The animated image
          shows through clean; headline legibility comes from the
          triple-layer text halo on the h1/p below. Mask fades the
          image's own alpha to 0 over ~60% of the viewport, with the
          last ~8-12% being pure page-bg (clean handoff to belly). */}
      <div className="absolute inset-0 -z-10">
        <img
          src="/hero-landscape.webp"
          alt="A painted valley at dawn — still lake, pine forest and snow-capped peaks under a soft pink sky."
          className="lk-drift h-full w-full object-cover"
          style={{ objectFit: 'cover', maskImage: mask, WebkitMaskImage: mask }}
        />
      </div>

      {/* headline */}
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-5 pb-4 pt-20 text-center sm:pt-24">
        <h1
          className="lk-display font-semibold leading-[0.98] tracking-[-0.02em]"
          style={{
            fontSize: 'clamp(2.2rem, 6.5vw, 5rem)',
            color: '#FBF7EE',
            textShadow: '0 2px 30px rgba(8,6,3,0.95), 0 1px 8px rgba(8,6,3,0.85), 0 0 2px rgba(8,6,3,0.95)',
          }}
        >
          Build web apps
          <br />
          from{' '}
          <em className="lk-display italic" style={{ color: '#F0B89A' }}>
            wherever
          </em>{' '}
          you are.
        </h1>
        <p
          className="mt-4 max-w-[50ch] text-[0.98rem] leading-relaxed sm:mt-5 sm:text-[1.1rem]"
          style={{
            color: '#FBF7EE',
            textShadow: '0 2px 22px rgba(8,6,3,0.95), 0 1px 6px rgba(8,6,3,0.85), 0 0 2px rgba(8,6,3,0.95)',
            fontWeight: 500,
          }}
        >
          One prompt becomes a live, exportable app — drafted, previewed and shipped straight from your phone.
        </p>
      </div>

      {/* prompt box — anchored to bottom of viewport, fully visible */}
      <div className="relative z-20 mx-auto w-full max-w-2xl px-4 pb-4 sm:px-6 sm:pb-6">
        <LandingPromptBox variant="hero" />
      </div>
    </section>
  );
}

/*
 * ════════ Build flow — the middle beat ════════
 *
 * PURE PAGE-BG: no bridge overlays, NO grain. The belly is flat
 * var(--lk-bg), matching the hero's faded-out bottom and the footer's
 * faded-in top. Grain would add a subtle brightness shift at the
 * boundaries (screen in dark / multiply in light) that reads as a
 * visible line against the pure page-bg above and below.
 */

function BuildFlow() {
  const habits = [
    { name: 'Read 20 pages', streak: 18, done: [1, 1, 1, 1, 1, 0, 0] },
    { name: 'Walk after lunch', streak: 9, done: [1, 1, 0, 1, 1, 1, 0] },
    { name: 'No phone before 9', streak: 31, done: [1, 1, 1, 1, 1, 1, 0] },
  ];

  return (
    <section
      id="build"
      className="relative w-full overflow-hidden px-4 pb-48 pt-16 sm:px-6 sm:pb-56 sm:pt-24"
      style={{ background: 'var(--lk-bg)' }}
    >
      <div className="relative mx-auto w-full max-w-6xl">
        <div className="max-w-2xl">
          <h2
            className="lk-display font-semibold leading-[1.05] tracking-[-0.02em]"
            style={{ fontSize: 'clamp(1.8rem, 4.5vw, 3rem)', color: 'var(--lk-fg)' }}
          >
            From one line to a{' '}
            <em className="not-italic font-bold" style={{ color: 'var(--lk-accent)' }}>
              running app
            </em>
            .
          </h2>
          <p
            className="mt-4 max-w-[52ch] text-[0.98rem] leading-relaxed sm:text-[1.05rem]"
            style={{ color: 'rgb(var(--lk-fg-raw) / 0.7)' }}
          >
            Palmkit drafts the app, stands up a live preview you can poke at, and exports the code the moment
            you&rsquo;re happy. No setup, no boilerplate, no laptop required.
          </p>
        </div>

        {/* the island — prompt ↔ live preview */}
        <div
          className="relative mt-12 overflow-hidden rounded-[1.5rem] border"
          style={{
            borderColor: 'rgb(var(--lk-bg-raw) / 0.12)',
            background: 'rgb(var(--lk-glass-fill) / 0.6)',
            boxShadow: '0 30px 80px -50px rgba(20,16,12,0.5)',
          }}
        >
          <div
            className="flex items-center justify-between border-b px-5 py-3 sm:px-7"
            style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)' }}
          >
            <span className="text-xs font-semibold" style={{ color: 'var(--lk-fg)' }}>
              Draft
            </span>
            <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--lk-fg)' }}>
              <span className="h-px w-8" style={{ background: 'rgb(var(--lk-bg-raw) / 0.2)' }} />
              Preview
              <span className="h-px w-8" style={{ background: 'rgb(var(--lk-bg-raw) / 0.2)' }} />
            </span>
            <span className="text-xs font-semibold" style={{ color: 'var(--lk-fg)' }}>
              Export
            </span>
          </div>

          <div className="grid gap-px md:grid-cols-2" style={{ background: 'rgb(var(--lk-bg-raw) / 0.1)' }}>
            {/* LEFT — prompt + files */}
            <div className="p-5 sm:p-7" style={{ background: 'rgb(var(--lk-glass-fill) / 0.4)' }}>
              <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--lk-fg)' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--lk-accent)' }} />
                you
              </div>
              <p
                className="lk-display mt-2.5 text-[1.1rem] font-semibold leading-snug"
                style={{ color: 'var(--lk-fg)' }}
              >
                &ldquo;A habit tracker with streaks, a week view, and dark mode.&rdquo;
              </p>
              <div className="mt-6 space-y-1.5">
                <p className="text-xs font-medium" style={{ color: 'rgb(var(--lk-fg-raw) / 0.7)' }}>
                  drafted in 4.2s
                </p>
                <div
                  className="rounded-lg border p-3 font-mono text-[0.78rem] leading-relaxed"
                  style={{
                    borderColor: 'rgb(var(--lk-fg-raw) / 0.12)',
                    background: 'rgb(var(--lk-fg-raw) / 0.04)',
                    color: 'rgb(var(--lk-fg-raw) / 0.8)',
                  }}
                >
                  <div className="font-semibold" style={{ color: 'var(--lk-fg)' }}>
                    app/
                  </div>
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
            <div className="p-5 sm:p-7" style={{ background: 'rgb(var(--lk-bg-raw) / 0.06)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="lk-display text-base font-semibold" style={{ color: 'var(--lk-fg)' }}>
                    Today
                  </p>
                  <p className="text-xs font-medium" style={{ color: 'rgb(var(--lk-fg-raw) / 0.7)' }}>
                    3 of 3 in reach
                  </p>
                </div>
                <div
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-medium"
                  style={{
                    borderColor: 'rgb(var(--lk-bg-raw) / 0.15)',
                    color: 'var(--lk-fg)',
                    background: 'rgb(var(--lk-bg-raw) / 0.06)',
                  }}
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
                    style={{
                      borderColor: 'rgb(var(--lk-bg-raw) / 0.1)',
                      background: 'rgb(var(--lk-glass-fill) / 0.4)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="grid h-5 w-5 place-items-center rounded-md"
                        style={{ background: 'var(--lk-accent)', color: 'var(--lk-accent-fg)' }}
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.2 L4.8 8.4 L9.5 3.6"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="text-sm font-medium" style={{ color: 'var(--lk-fg)' }}>
                        {h.name}
                      </span>
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
                      <span
                        className="w-9 text-right font-mono text-xs font-semibold"
                        style={{ color: 'var(--lk-fg)' }}
                      >
                        {h.streak}d
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="mt-4 flex items-center justify-between rounded-xl px-3.5 py-2.5"
                style={{ background: 'rgb(var(--lk-glass-shadow) / 0.16)' }}
              >
                <span className="text-xs font-medium" style={{ color: 'var(--lk-fg)' }}>
                  Longest streak this week
                </span>
                <span className="font-mono text-sm font-bold" style={{ color: 'var(--lk-accent)' }}>
                  31 days
                </span>
              </div>
            </div>
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5 sm:px-7"
            style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'rgb(var(--lk-fg-raw) / 0.7)' }}>
              Export as Next.js · React · or a single HTML file
            </span>
            <button
              className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
              style={{ color: 'var(--lk-fg)' }}
            >
              Ship it
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                <path
                  d="M5 3.5 H12 V10.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* templates anchor */}
        <div
          id="templates"
          className="mt-20 flex flex-col gap-6 border-t pt-10 sm:flex-row sm:items-end sm:justify-between"
          style={{ borderColor: 'rgb(var(--lk-bg-raw) / 0.1)' }}
        >
          <div>
            <p className="lk-display text-[1.4rem] font-semibold tracking-tight" style={{ color: 'var(--lk-fg)' }}>
              Start from a sketch, not a blank page.
            </p>
            <p className="mt-1.5 text-sm font-medium" style={{ color: 'rgb(var(--lk-fg-raw) / 0.7)' }}>
              Twelve hand-built templates — dashboards, storefronts, journals, portfolios — ready to remix.
            </p>
          </div>
          <Link
            to="/#templates"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold transition-colors"
            style={{ color: 'var(--lk-fg)' }}
          >
            Browse templates
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 12 L12 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path
                d="M5 3.5 H12 V10.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

/*
 * ════════ Footer — full-bleed landscape with links overlaid ════════
 *
 * IMAGE MASK: fades image IN over a very long span. The top ~10-16%
 * of the footer is pure page-bg (image alpha = 0), giving a clean
 * handoff from the belly section above. Light mode has a longer fade
 * because the image's dark top is far from the cream bg.
 *
 * LEGIBILITY PANEL: confined to MID band (transparent at top so it
 * doesn't darken the seam zone). Stronger in light mode + extra
 * focused scrim behind link columns.
 */

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
  const gif = isDark ? '/footer-night.webp' : '/footer-day.webp';
  const alt = isDark
    ? 'A mountain lake under a deep night sky — pines and peaks reflected in still water.'
    : 'A mountain lake in bright daylight — pines, peaks and a clear blue sky.';
  const markSrc = isDark ? '/palmkit-mark-ondark.png' : '/palmkit-mark.png';

  /*
   * MASK-ONLY (single fade). Image alpha fades IN from 0 at the top to
   * fully opaque lower down. The top ~10-16% is pure page-bg (alpha 0),
   * giving a clean handoff from the belly section. NO bridge → no
   * color mismatch with the image's bright sky. Footer gets an explicit
   * page-bg surface so the masked image always dissolves into the same
   * color that sits above it. Light mode has a much longer fade because
   * the image's dark/bright top is far from the cream page bg.
   */
  const mask = isDark
    ? 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 15%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.8) 65%, #000 85%, #000 100%)'
    : 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 20%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.75) 70%, #000 88%, #000 100%)';

  /*
   * Triple-layer text halo — reads on both bright day sky and dark
   * night sky. Tight blur + crisp 1px outline + wide soft halo.
   */
  const textHalo = isDark
    ? '0 0 1px rgba(6,4,2,0.95), 0 1px 4px rgba(6,4,2,0.88), 0 2px 22px rgba(6,4,2,0.92), 0 0 40px rgba(6,4,2,0.55)'
    : '0 0 1px rgba(8,5,2,0.95), 0 1px 3px rgba(8,5,2,0.88), 0 2px 10px rgba(8,5,2,0.78), 0 3px 24px rgba(8,5,2,0.62), 0 0 44px rgba(8,5,2,0.42)';

  return (
    <footer id="pricing" className="relative w-full overflow-hidden" style={{ background: 'var(--lk-bg)' }}>
      {/* full-bleed landscape background — masked in (alpha fade) over the page bg */}
      <img
        src={gif}
        alt={alt}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />

      {/* LEGIBILITY — minimal, only behind text areas, NOT covering the image */}
      <div
        className="absolute inset-0"
        style={{
          background: isDark
            ? 'linear-gradient(to bottom, rgba(6,4,2,0) 0%, rgba(6,4,2,0) 40%, rgba(6,4,2,0.35) 60%, rgba(6,4,2,0.6) 80%, rgba(6,4,2,0.8) 100%)'
            : 'linear-gradient(to bottom, rgba(12,8,4,0) 0%, rgba(12,8,4,0) 40%, rgba(12,8,4,0.3) 60%, rgba(12,8,4,0.55) 80%, rgba(12,8,4,0.75) 100%)',
        }}
      />

      {/* FOCUSED CONTENT SCRIM (light mode only) — extra darkening
          behind the link columns where the brightest sky meets text. */}
      {!isDark && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(80% 48% at 64% 58%, rgba(10,6,2,0.40) 0%, rgba(10,6,2,0.24) 38%, rgba(10,6,2,0.08) 66%, rgba(10,6,2,0) 100%)',
          }}
        />
      )}

      {/* content overlay — links on the image */}
      <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-10 pt-28 sm:px-8 sm:pt-32">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <img
                src={markSrc}
                alt=""
                className="h-5 w-5 select-none pointer-events-none"
                style={{ filter: 'drop-shadow(0 1px 8px rgba(8,6,3,0.9))' }}
              />
              <span
                className="lk-display text-lg font-semibold tracking-tight"
                style={{ color: '#FBF7EE', textShadow: textHalo }}
              >
                Palmkit
              </span>
            </div>
            <p className="mt-3 text-sm font-medium leading-relaxed" style={{ color: '#FBF7EE', textShadow: textHalo }}>
              The pocket workshop for AI-built web apps. Prompt, preview, export — from anywhere.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-3 sm:gap-x-16">
            {FOOTER_COLS.map((col) => (
              <div key={col.heading} className="space-y-3">
                <p className="text-sm font-bold" style={{ color: '#FBF7EE', textShadow: textHalo }}>
                  {col.heading}
                </p>
                <ul className="space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        to={l.to}
                        className="text-sm font-medium transition-colors duration-200 hover:text-[#F0B89A]"
                        style={{ color: '#FBF7EE', textShadow: textHalo }}
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

        <div
          className="mt-14 flex flex-col gap-2 border-t pt-5 text-xs font-medium sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.25)', color: '#FBF7EE' }}
        >
          <p style={{ textShadow: textHalo }}>Built for pockets, wherever they open.</p>
          <p style={{ textShadow: textHalo }}>© {new Date().getFullYear()} Palmkit.</p>
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
