import { Link } from '@remix-run/react';
import type { ReactNode } from 'react';

/**
 * Shared layout for legal pages (Terms, Privacy) — Palmkit dark/teal
 * identity, mobile-first, clean readable typography.
 */
export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-bolt-elements-bg-depth-1 text-bolt-elements-textPrimary">
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-2 px-4 h-14 border-b backdrop-blur-xl"
        style={{
          background: 'var(--bolt-mobile-surface-bg, rgba(10,10,18,0.9))',
          borderColor: 'var(--bolt-mobile-surface-border, rgba(0,168,181,0.14))',
        }}
      >
        <Link to="/" className="flex items-center" aria-label="Palmkit home">
          <img src="/palmkit-logo-light.png" alt="Palmkit" className="h-7 w-auto select-none dark:hidden" />
          <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-7 w-auto select-none hidden dark:block" />
        </Link>
        <Link
          to="/"
          className="ml-auto text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: 'var(--bolt-mobile-accent-faint, rgba(0,168,181,0.06))',
            color: '#5eead4',
          }}
        >
          ← Back to app
        </Link>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-2xl px-5 py-8 sm:py-12">
        <div className="mb-8">
          <div
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full mb-3"
            style={{
              background: 'var(--bolt-mobile-accent-faint, rgba(0,168,181,0.08))',
              color: '#5eead4',
            }}
          >
            <span className="i-ph:scroll text-xs" />
            Legal
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">{title}</h1>
          <p className="text-sm text-bolt-elements-textSecondary">Last updated: {updated}</p>
        </div>

        <article className="legal-prose flex flex-col gap-6 text-[15px] leading-relaxed text-bolt-elements-textSecondary">
          {children}
        </article>

        <footer
          className="mt-12 pt-6 border-t text-xs text-bolt-elements-textTertiary"
          style={{ borderColor: 'var(--bolt-mobile-surface-border, rgba(0,168,181,0.12))' }}
        >
          <p>
            Palmkit is an independent project built on top of the MIT-licensed{' '}
            <a
              href="https://github.com/stackblitz-labs/bolt.diy"
              className="underline"
              style={{ color: '#5eead4' }}
              target="_blank"
              rel="noreferrer"
            >
              bolt.diy
            </a>{' '}
            codebase.
          </p>
          <div className="flex gap-4 mt-3">
            <Link to="/terms" className="hover:underline">
              Terms
            </Link>
            <Link to="/privacy" className="hover:underline">
              Privacy
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

/** Section heading + body helper for consistent legal typography. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">{heading}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
