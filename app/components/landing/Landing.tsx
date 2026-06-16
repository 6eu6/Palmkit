import { Link } from '@remix-run/react';
import type { ReactNode } from 'react';
import { LandingPromptBox } from './LandingPromptBox';

/**
 * Marketing landing page shown to logged-out visitors at "/".
 *
 * Layout follows the lovable.dev structure — minimal header, a clean hero whose
 * focal point is the chat prompt box (no cluttered code mockup), a 3-step
 * process section, a templates grid, a stats band, a secondary CTA with another
 * prompt box, and a multi-column footer. Palette stays Palmkit: dark surfaces
 * with teal (#00A8B5) + mint (#4CD4B0) accents.
 */

/* ─── Brand Colors ─── */
const TEAL = '#00A8B5';
const TEAL_DARK = '#008C97';
const MINT = '#4CD4B0';
const TEAL_GLOW = 'rgba(0, 168, 181, 0.25)';
const TEAL_SUBTLE = 'rgba(0, 168, 181, 0.08)';
const TEAL_BORDER = 'rgba(0, 168, 181, 0.14)';
const TEAL_TEXT = '#5eead4';
const MINT_TEXT = '#6ee7b7';

const SURFACE = 'rgba(10, 10, 18, 0.55)';
const SURFACE_SOLID = 'rgba(10, 10, 18, 0.9)';
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)';

export function Landing() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-palmkit-elements-background-depth-1 text-palmkit-elements-textPrimary overflow-x-hidden">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <LogoStrip />
        <Process />
        <Templates />
        <Stats />
        <SecondaryCta />
      </main>
      <LandingFooter />
    </div>
  );
}

/* ─── Header ─── */

function LandingHeader() {
  return (
    <header
      className="sticky top-0 z-30 flex items-center px-4 sm:px-6 h-14 border-b backdrop-blur-xl"
      style={{ background: SURFACE_SOLID, borderColor: BORDER_SUBTLE }}
    >
      <Link to="/" className="flex items-center" aria-label="Palmkit home">
        <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-7 w-auto select-none" />
      </Link>
      <nav className="hidden md:flex items-center gap-7 ml-10 text-sm text-palmkit-elements-textSecondary">
        <a href="#process" className="hover:text-palmkit-elements-textPrimary transition-colors">How it works</a>
        <a href="#templates" className="hover:text-palmkit-elements-textPrimary transition-colors">Templates</a>
        <a href="#stats" className="hover:text-palmkit-elements-textPrimary transition-colors">Why Palmkit</a>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <Link
          to="/login"
          className="h-9 px-3.5 flex items-center text-sm font-medium text-palmkit-elements-textSecondary hover:text-palmkit-elements-textPrimary transition-colors"
        >
          Log in
        </Link>
        <Link
          to="/signup"
          className="h-9 px-4 flex items-center rounded-lg text-sm font-semibold text-white transition-all hover:shadow-lg active:scale-[0.97]"
          style={{ background: `linear-gradient(135deg, ${TEAL} 0%, ${MINT} 140%)`, boxShadow: `0 4px 14px ${TEAL_GLOW}` }}
        >
          Get started
        </Link>
      </div>
    </header>
  );
}

/* ─── Hero ─── */

function Hero() {
  return (
    <section className="relative px-4 sm:px-6 pt-20 sm:pt-28 pb-16 sm:pb-24 text-center overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(55% 45% at 50% 0%, rgba(0,168,181,0.20) 0%, rgba(76,212,176,0.06) 40%, transparent 70%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute w-[500px] h-[500px] rounded-full opacity-[0.05] blur-[100px] -top-40 -left-40" style={{ background: TEAL }} />
        <div className="absolute w-[400px] h-[400px] rounded-full opacity-[0.04] blur-[80px] -bottom-20 -right-40" style={{ background: MINT }} />
      </div>

      {/* Badge */}
      <div
        className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium px-3 py-1.5 rounded-full mb-7"
        style={{ background: TEAL_SUBTLE, color: TEAL_TEXT, border: '1px solid rgba(0, 168, 181, 0.15)' }}
      >
        <span className="i-ph:sparkle-fill text-xs" />
        AI-powered vibe coding platform
      </div>

      {/* Headline */}
      <h1 className="mx-auto max-w-3xl text-4xl sm:text-6xl font-bold tracking-tight leading-[1.08]">
        Build something{' '}
        <span
          style={{
            background: `linear-gradient(110deg, ${TEAL} 0%, ${MINT} 60%, #a7f3d0 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Palmkit
        </span>
      </h1>

      <p className="mx-auto mt-5 max-w-xl text-base sm:text-lg text-palmkit-elements-textSecondary leading-relaxed">
        Create apps and websites by chatting with AI. Palmkit generates the code, installs
        dependencies, and shows a live preview — right in your browser, on any device.
      </p>

      {/* Chat prompt box — the hero focal point (lovable-style) */}
      <div className="mt-9 sm:mt-10">
        <LandingPromptBox />
      </div>
    </section>
  );
}

/* ─── Logo Strip (social proof) ─── */

function LogoStrip() {
  const logos = ['Vercel', 'GitHub', 'Netlify', 'Cloudflare', 'Supabase'];
  return (
    <section className="px-4 sm:px-6 py-10 border-y" style={{ borderColor: BORDER_SUBTLE }}>
      <p className="text-center text-xs text-palmkit-elements-textTertiary mb-6">
        Deploy to the platforms you already use
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {logos.map((name) => (
          <span key={name} className="text-lg sm:text-xl font-semibold text-palmkit-elements-textTertiary tracking-tight">
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ─── Process: 3 steps (lovable-style) ─── */

function Process() {
  const steps = [
    {
      icon: 'i-ph:lightbulb-filament-fill',
      title: 'Start with an idea',
      body: 'Describe what you want in plain language. No setup, no boilerplate — just your intent.',
    },
    {
      icon: 'i-ph:wand-magic-sparkles-fill',
      title: 'Watch it come to life',
      body: 'Palmkit writes the code, installs dependencies, and spins up a live preview as it goes.',
    },
    {
      icon: 'i-ph:rocket-launch-fill',
      title: 'Refine and ship',
      body: 'Iterate by chat, then deploy to Vercel, Netlify, or Cloudflare in a couple of clicks.',
    },
  ];

  return (
    <section id="process" className="px-4 sm:px-6 py-20 sm:py-28">
      <SectionHeading
        eyebrow="How it works"
        title="From idea to deployed app in three steps"
        sub="No deep coding skills required — just describe, watch, and ship."
      />
      <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {steps.map((s, i) => (
          <div
            key={s.title}
            className="relative rounded-2xl p-6 border transition-colors hover:border-[rgba(0,168,181,0.3)]"
            style={{ background: SURFACE, borderColor: BORDER_SUBTLE }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: TEAL_SUBTLE }}
              >
                <span className={`${s.icon} text-lg`} style={{ color: TEAL_TEXT }} />
              </div>
              <span className="text-xs font-mono text-palmkit-elements-textTertiary">0{i + 1}</span>
            </div>
            <h3 className="text-base font-semibold mb-2">{s.title}</h3>
            <p className="text-sm text-palmkit-elements-textSecondary leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Templates grid ─── */

function Templates() {
  const templates = [
    { name: 'Landing Page', desc: 'Responsive marketing page with hero & CTA', icon: 'i-ph:browser-fill' },
    { name: 'Dashboard', desc: 'Admin panel with charts & data tables', icon: 'i-ph:chart-line-up-fill' },
    { name: 'Mobile App', desc: 'Expo / React Native cross-platform app', icon: 'i-ph:device-mobile-fill' },
    { name: 'Blog', desc: 'MDX blog with syntax highlighting', icon: 'i-ph:article-fill' },
    { name: 'E-commerce', desc: 'Storefront with cart & checkout', icon: 'i-ph:shopping-bag-fill' },
    { name: 'Portfolio', desc: 'Developer portfolio with projects', icon: 'i-ph:user-circle-fill' },
    { name: 'SaaS App', desc: 'Multi-tenant app with auth & billing', icon: 'i-ph:buildings-fill' },
    { name: 'Docs Site', desc: 'Documentation site with search', icon: 'i-ph:book-open-fill' },
  ];

  return (
    <section id="templates" className="px-4 sm:px-6 py-20 sm:py-28 border-t" style={{ borderColor: BORDER_SUBTLE }}>
      <SectionHeading
        eyebrow="Templates"
        title="Start your next project with a template"
        sub="Pre-built starters for every stack. Fork one and make it yours."
      />
      <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
        {templates.map((t) => (
          <div
            key={t.name}
            className="group rounded-2xl p-5 border transition-all hover:-translate-y-0.5 hover:border-[rgba(0,168,181,0.3)] cursor-pointer"
            style={{ background: SURFACE, borderColor: BORDER_SUBTLE }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 transition-colors group-hover:bg-[rgba(0,168,181,0.14)]"
              style={{ background: TEAL_SUBTLE }}
            >
              <span className={`${t.icon} text-base`} style={{ color: TEAL_TEXT }} />
            </div>
            <h3 className="text-sm font-semibold mb-1">{t.name}</h3>
            <p className="text-xs text-palmkit-elements-textTertiary leading-relaxed">{t.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Stats band ─── */

function Stats() {
  const stats = [
    { value: '100%', label: 'Open source', sub: 'Self-host or use the cloud — your call.' },
    { value: '15+', label: 'AI providers', sub: 'Bring your own key. OpenAI, Anthropic, Groq & more.' },
    { value: '0', label: 'Vendor lock-in', sub: 'Export your code as plain files anytime.' },
  ];

  return (
    <section id="stats" className="px-4 sm:px-6 py-20 sm:py-28">
      <SectionHeading
        eyebrow="Why Palmkit"
        title="Built for builders who want control"
        sub="No black boxes. Your code, your keys, your deployments."
      />
      <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
        {stats.map((s) => (
          <div key={s.label} className="text-center px-4">
            <div
              className="text-4xl sm:text-5xl font-bold tracking-tight"
              style={{
                background: `linear-gradient(135deg, ${TEAL} 0%, ${MINT} 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {s.value}
            </div>
            <div className="mt-3 text-sm font-semibold">{s.label}</div>
            <p className="mt-1.5 text-xs text-palmkit-elements-textTertiary leading-relaxed">{s.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Secondary CTA (repeated prompt box, lovable-style) ─── */

function SecondaryCta() {
  return (
    <section className="relative px-4 sm:px-6 py-24 sm:py-32 overflow-hidden border-t" style={{ borderColor: BORDER_SUBTLE }}>
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(50% 60% at 50% 50%, rgba(0,168,181,0.12) 0%, rgba(76,212,176,0.04) 40%, transparent 70%)',
        }}
      />
      <div className="text-center max-w-2xl mx-auto">
        <h2 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
          What do you want to{' '}
          <span
            style={{
              background: `linear-gradient(110deg, ${TEAL} 0%, ${MINT} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            build?
          </span>
        </h2>
        <p className="mt-4 text-base text-palmkit-elements-textSecondary">
          Start now — describe your idea and Palmkit takes care of the rest.
        </p>
        <div className="mt-9">
          <LandingPromptBox />
        </div>
      </div>
    </section>
  );
}

/* ─── Shared section heading ─── */

function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto">
      <div
        className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full mb-4"
        style={{ background: TEAL_SUBTLE, color: TEAL_TEXT }}
      >
        {eyebrow}
      </div>
      <h2 className="text-2xl sm:text-4xl font-bold tracking-tight leading-tight">{title}</h2>
      {sub ? <p className="mt-3 text-sm sm:text-base text-palmkit-elements-textSecondary leading-relaxed">{sub}</p> : null}
    </div>
  );
}

/* ─── Footer ─── */

function LandingFooter() {
  const cols: { heading: string; links: { label: string; to: string }[] }[] = [
    {
      heading: 'Product',
      links: [
        { label: 'How it works', to: '/#process' },
        { label: 'Templates', to: '/#templates' },
        { label: 'Pricing', to: '/#stats' },
        { label: 'Log in', to: '/login' },
        { label: 'Sign up', to: '/signup' },
      ],
    },
    {
      heading: 'Resources',
      links: [
        { label: 'Documentation', to: '/#' },
        { label: 'Starter templates', to: '/#' },
        { label: 'AI providers', to: '/#' },
        { label: 'Changelog', to: '/#' },
      ],
    },
    {
      heading: 'Company',
      links: [
        { label: 'About', to: '/#' },
        { label: 'Blog', to: '/#' },
        { label: 'Careers', to: '/#' },
        { label: 'Contact', to: '/#' },
      ],
    },
    {
      heading: 'Legal',
      links: [
        { label: 'Privacy', to: '/privacy' },
        { label: 'Terms', to: '/terms' },
        { label: 'Security', to: '/#' },
      ],
    },
  ];

  return (
    <footer className="border-t" style={{ borderColor: BORDER_SUBTLE, background: 'rgba(8,8,14,0.6)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center mb-3">
              <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-7 w-auto select-none" />
            </Link>
            <p className="text-xs text-palmkit-elements-textTertiary leading-relaxed max-w-[180px]">
              Build, preview and export AI-generated web apps from any device.
            </p>
          </div>
          {/* Link columns */}
          {cols.map((c) => (
            <div key={c.heading}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-palmkit-elements-textSecondary mb-3">
                {c.heading}
              </h4>
              <ul className="space-y-2">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      to={l.to}
                      className="text-xs text-palmkit-elements-textTertiary hover:text-palmkit-elements-textPrimary transition-colors"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-3" style={{ borderColor: BORDER_SUBTLE }}>
          <p className="text-xs text-palmkit-elements-textTertiary">© {new Date().getFullYear()} Palmkit. All rights reserved.</p>
          <div className="flex items-center gap-4 text-xs text-palmkit-elements-textTertiary">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-palmkit-elements-textPrimary transition-colors">
              <span className="i-ph:github-logo-fill text-base" />
            </a>
            <a href="https://x.com" target="_blank" rel="noreferrer" className="hover:text-palmkit-elements-textPrimary transition-colors">
              <span className="i-ph:x-logo-fill text-base" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
