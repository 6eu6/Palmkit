import { useStore } from '@nanostores/react';
import { Form } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { authModalStore, closeAuthModal } from '~/lib/stores/auth';

/**
 * Global "sign in to continue" modal. Shown when an unauthenticated user tries
 * to use a gated surface (e.g. the prompt box). OAuth buttons post to /login,
 * which redirects to the provider; email sign-up routes to /signup.
 */
export function AuthModal() {
  const open = useStore(authModalStore);
  const [redirectTo, setRedirectTo] = useState('/');

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
    'w-full h-12 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 border border-bolt-elements-borderColor text-bolt-elements-textPrimary bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-bg-depth-3 transition-colors';

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

      {/* Sheet / Card */}
      <div
        className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl border p-6 pb-8 sm:pb-6"
        style={{
          background: 'var(--bolt-mobile-surface-bg, #0e0e16)',
          borderColor: 'var(--bolt-mobile-surface-border, rgba(139,92,246,0.18))',
          animation: 'slide-up 0.28s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        <button
          onClick={closeAuthModal}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-bolt-elements-textSecondary hover:bg-bolt-elements-bg-depth-3 transition-colors"
        >
          <span className="i-ph:x text-lg" />
        </button>

        <div className="flex flex-col items-center text-center mb-5">
          <img src="/palmkit-icon.jpg" alt="Palmkit" className="w-14 h-14 rounded-2xl mb-3 shadow-lg" />
          <h2 className="text-xl font-bold tracking-tight text-bolt-elements-textPrimary">Sign in to start building</h2>
          <p className="text-sm text-bolt-elements-textSecondary mt-1">
            Create a free account to generate, preview, and keep your projects.
          </p>
        </div>

        <Form method="post" action="/login" className="flex flex-col gap-2.5">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button type="submit" name="intent" value="github" className={oauthBtn}>
            <span className="i-ph:github-logo-fill text-lg" />
            Continue with GitHub
          </button>
          <button type="submit" name="intent" value="twitter" className={oauthBtn}>
            <span className="i-ph:x-logo-fill text-lg" />
            Continue with X
          </button>
        </Form>

        <div className="flex items-center gap-3 my-4">
          <div className="h-px flex-1 bg-bolt-elements-borderColor" />
          <span className="text-[11px] text-bolt-elements-textTertiary">or</span>
          <div className="h-px flex-1 bg-bolt-elements-borderColor" />
        </div>

        <div className="flex flex-col gap-2 text-center">
          <a
            href={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="w-full h-12 rounded-xl font-medium text-white text-sm flex items-center justify-center transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #6234bb 100%)' }}
          >
            Sign up with email
          </a>
          <a
            href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="text-xs text-bolt-elements-textSecondary hover:underline mt-1"
          >
            Already have an account? <span style={{ color: 'var(--bolt-mobile-accent-text, #c4b5fd)' }}>Log in</span>
          </a>
        </div>
      </div>
    </div>
  );
}
