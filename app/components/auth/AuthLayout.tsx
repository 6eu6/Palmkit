import { Link } from '@remix-run/react';
import type { ReactNode } from 'react';

/**
 * Shared layout for auth pages (Login, Sign up) — Palmkit dark/teal
 * identity, mobile-first, centered card.
 */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-bolt-elements-bg-depth-1 text-bolt-elements-textPrimary">
      <header className="flex items-center px-4 h-14">
        <Link to="/" className="flex items-center" aria-label="Palmkit home">
          <img src="/palmkit-logo-light.png" alt="Palmkit" className="h-7 w-auto select-none dark:hidden" />
          <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-7 w-auto select-none hidden dark:block" />
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 py-8">
        <div className="w-full max-w-sm">
          <div className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight mb-1.5">{title}</h1>
            <p className="text-sm text-bolt-elements-textSecondary">{subtitle}</p>
          </div>

          <div
            className="rounded-2xl border p-5 sm:p-6"
            style={{
              background: 'var(--bolt-mobile-surface-bg, rgba(255,255,255,0.02))',
              borderColor: 'rgba(0, 168, 181, 0.14)',
            }}
          >
            {children}
          </div>

          <p className="mt-6 text-center text-[11px] text-bolt-elements-textTertiary leading-relaxed">
            By continuing you agree to our{' '}
            <Link to="/terms" className="underline" style={{ color: '#5eead4' }}>
              Terms
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="underline" style={{ color: '#5eead4' }}>
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

/** Teal primary button used across auth forms. */
export function AuthButton({
  children,
  type = 'submit',
  disabled,
  name,
  value,
}: {
  children: ReactNode;
  type?: 'submit' | 'button';
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  return (
    <button
      type={type}
      name={name}
      value={value}
      disabled={disabled}
      className="w-full h-11 rounded-xl font-medium text-white text-sm transition-opacity disabled:opacity-60"
      style={{ background: 'linear-gradient(135deg, #00A8B5 0%, #008C97 140%)' }}
    >
      {children}
    </button>
  );
}

/** Styled text input for auth forms. */
export function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;

  return (
    <label className="block">
      <span className="block text-xs font-medium text-bolt-elements-textSecondary mb-1.5">{label}</span>
      <input
        {...rest}
        className="w-full h-11 px-3.5 rounded-xl text-sm bg-bolt-elements-bg-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-[#00A8B5]/30 transition-all"
      />
    </label>
  );
}
