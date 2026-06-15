import { Link } from '@remix-run/react';
import type { ReactNode } from 'react';

/**
 * Shared layout for legal pages (Terms, Privacy) — Pocketforge dark/violet
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
          borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.14))',
        }}
      >
        <Link to="/" className="flex items-center gap-2" aria-label="Pocketforge home">
          <span
            className="flex items-center justify-center w-7 h-7 rounded-[9px] text-white"
            style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6234bb 100%)' }}
          >
            <span className="i-ph:lightning-fill text-base" />
          </span>
          <span className="text-base font-semibold tracking-tight">
            <span>Pocket</span>
            <span style={{ color: 'var(--bolt-mobile-accent-text, #c4b5fd)' }}>forge</span>
          </span>
        </Link>
        <Link
          to="/"
          className="ml-auto text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: 'var(--bolt-mobile-accent-faint, rgba(139,92,246,0.06))',
            color: 'var(--bolt-mobile-accent-text, #c4b5fd)',
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
              background: 'var(--bolt-mobile-accent-faint, rgba(139,92,246,0.08))',
              color: 'var(--bolt-mobile-accent-text, #c4b5fd)',
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
          style={{ borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.12))' }}
        >
          <p>
            Pocketforge is an independent project built on top of the MIT-licensed{' '}
            <a
              href="https://github.com/stackblitz-labs/bolt.diy"
              className="underline"
              style={{ color: 'var(--bolt-mobile-accent-text, #c4b5fd)' }}
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
