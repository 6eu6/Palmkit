import { Link } from '@remix-run/react';
import type { ReactNode } from 'react';

/**
 * Marketing landing page shown to logged-out visitors at "/". Mobile-first,
 * dark with teal + mint accents — the Palmkit brand identity. The editor lives
 * behind authentication.
 */

/* ─── Brand Colors ─── */
const TEAL = '#00A8B5';
const TEAL_DARK = '#008C97';
const MINT = '#4CD4B0';
const TEAL_GLOW = 'rgba(0, 168, 181, 0.25)';
const TEAL_SUBTLE = 'rgba(0, 168, 181, 0.08)';
const MINT_SUBTLE = 'rgba(76, 212, 176, 0.08)';
const TEAL_TEXT = '#5eead4';
const MINT_TEXT = '#6ee7b7';

export function Landing() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary overflow-x-hidden">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <LogoStrip />
        <Features />
        <HowItWorks />
        <Testimonials />
        <Pricing />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}

/* ─── Header ─── */

function LandingHeader() {
  return (
    <header
      className="sticky top-0 z-20 flex items-center px-4 sm:px-6 h-14 border-b backdrop-blur-xl"
      style={{
        background: 'var(--bolt-mobile-surface-bg, rgba(10,10,18,0.88))',
        borderColor: 'rgba(0, 168, 181, 0.12)',
      }}
    >
      <Link to="/" className="flex items-center" aria-label="Palmkit home">
        <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-7 w-auto select-none" />
      </Link>
      <nav className="hidden md:flex items-center gap-6 ml-10 text-sm text-bolt-elements-textSecondary">
        <a href="#features" className="hover:text-bolt-elements-textPrimary transition-colors">Features</a>
        <a href="#how-it-works" className="hover:text-bolt-elements-textPrimary transition-colors">How it works</a>
        <a href="#pricing" className="hover:text-bolt-elements-textPrimary transition-colors">Pricing</a>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <Link
          to="/login"
          className="h-9 px-3.5 flex items-center text-sm font-medium text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
        >
          Log in
        </Link>
        <Link
          to="/signup"
          className="h-9 px-4 flex items-center rounded-lg text-sm font-semibold text-white transition-all hover:shadow-lg active:scale-[0.97]"
          style={{
            background: `linear-gradient(135deg, ${TEAL} 0%, ${MINT} 140%)`,
            boxShadow: `0 4px 14px ${TEAL_GLOW}`,
          }}
        >
          Sign up free
        </Link>
      </div>
    </header>
  );
}

/* ─── Hero ─── */

function Hero() {
  return (
    <section className="relative px-5 sm:px-6 pt-16 sm:pt-24 pb-14 sm:pb-20 text-center overflow-hidden">
      {/* Ambient glow layers */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(0,168,181,0.18) 0%, rgba(76,212,176,0.06) 40%, transparent 70%)',
        }}
      />
      {/* Floating orbs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute w-[500px] h-[500px] rounded-full opacity-[0.04] blur-[100px] -top-40 -left-40"
          style={{ background: TEAL }}
        />
        <div
          className="absolute w-[400px] h-[400px] rounded-full opacity-[0.03] blur-[80px] -bottom-20 -right-40"
          style={{ background: MINT }}
        />
      </div>

      {/* Badge */}
      <div
        className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium px-3 py-1.5 rounded-full mb-6"
        style={{
          background: TEAL_SUBTLE,
          color: TEAL_TEXT,
          border: '1px solid rgba(0, 168, 181, 0.15)',
        }}
      >
        <span className="i-ph:sparkle-fill text-xs" />
        AI-powered vibe coding platform
      </div>

      {/* Headline */}
      <h1 className="mx-auto max-w-3xl text-4xl sm:text-6xl font-bold tracking-tight leading-[1.08]">
        Build web apps
        <br />
        <span
          style={{
            background: `linear-gradient(110deg, ${TEAL} 0%, ${MINT} 60%, #a7f3d0 100%)`,
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

      {/* CTA buttons */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          to="/signup"
          className="w-full sm:w-auto h-12 px-7 flex items-center justify-center rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.97] hover:shadow-xl"
          style={{
            background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_DARK} 140%)`,
            boxShadow: `0 8px 30px ${TEAL_GLOW}`,
          }}
        >
          Start building — it's free
        </Link>
        <Link
          to="/login"
          className="w-full sm:w-auto h-12 px-7 flex items-center justify-center rounded-xl text-sm font-semibold border text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 transition-colors"
          style={{ borderColor: 'rgba(0, 168, 181, 0.2)' }}
        >
          Log in
        </Link>
      </div>

      <p className="mt-4 text-xs text-bolt-elements-textTertiary">Bring your own AI key · No credit card · Deploy in seconds</p>

      {/* Hero mockup */}
      <div className="mx-auto mt-12 max-w-4xl relative">
        <div
          className="rounded-2xl border overflow-hidden shadow-2xl"
          style={{
            borderColor: 'rgba(0, 168, 181, 0.12)',
            background: 'rgba(10, 10, 18, 0.6)',
            boxShadow: `0 25px 60px rgba(0, 0, 0, 0.5), 0 0 100px ${TEAL_GLOW}`,
          }}
        >
          {/* Browser chrome */}
          <div
            className="flex items-center gap-2 px-4 py-2.5 border-b"
            style={{
              borderColor: 'rgba(0, 168, 181, 0.08)',
              background: 'rgba(10, 10, 18, 0.8)',
            }}
          >
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
            </div>
            <div
              className="flex-1 h-6 rounded-md flex items-center px-3 text-[11px] text-bolt-elements-textTertiary"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              palmkit.app
            </div>
          </div>
          {/* App preview content */}
          <div className="flex min-h-[200px] sm:min-h-[320px]">
            {/* Sidebar */}
            <div
              className="hidden sm:flex flex-col w-56 border-r p-3 gap-2"
              style={{
                borderColor: 'rgba(0, 168, 181, 0.06)',
                background: 'rgba(10, 10, 18, 0.4)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: TEAL_SUBTLE }}>
                  <span className="i-ph:chat-circle-dots-fill text-sm" style={{ color: TEAL_TEXT }} />
                </div>
                <span className="text-xs font-medium">Chat</span>
              </div>
              {['Build a landing page', 'Add dark mode', 'Fix responsive nav', 'Deploy to Vercel'].map((msg, i) => (
                <div
                  key={msg}
                  className="text-[11px] px-2 py-1.5 rounded-md truncate"
                  style={{
                    background: i === 0 ? TEAL_SUBTLE : 'transparent',
                    color: i === 0 ? TEAL_TEXT : 'var(--bolt-elements-textTertiary)',
                  }}
                >
                  {msg}
                </div>
              ))}
            </div>
            {/* Main area */}
            <div className="flex-1 flex flex-col">
              {/* Code area */}
              <div className="flex-1 p-4 sm:p-5">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: TEAL_SUBTLE, color: TEAL_TEXT }}>tsx</span>
                    <span className="text-[11px] text-bolt-elements-textTertiary font-mono">page.tsx</span>
                  </div>
                  <CodeLine indent={0} color="var(--bolt-elements-textTertiary)">{'export default'}<span style={{ color: TEAL_TEXT }}>{' function'}</span>{' Page()'}<span style={{ color: MINT_TEXT }}>{' {'}</span></CodeLine>
                  <CodeLine indent={1} color="var(--bolt-elements-textTertiary)">{'return ('}</CodeLine>
                  <CodeLine indent={2}><span style={{ color: TEAL_TEXT }}>{'<div'}</span><span style={{ color: MINT_TEXT }}>{' className='}</span><span style={{ color: '#fbbf24' }}>"flex min-h-screen"</span><span style={{ color: TEAL_TEXT }}>{'>'}</span></CodeLine>
                  <CodeLine indent={3}><span style={{ color: TEAL_TEXT }}>{'<h1'}</span><span style={{ color: MINT_TEXT }}>{' className='}</span><span style={{ color: '#fbbf24' }}>"text-4xl"</span><span style={{ color: TEAL_TEXT }}>{'>'}</span>{'Hello World'}<span style={{ color: TEAL_TEXT }}>{'</h1>'}</span></CodeLine>
                  <CodeLine indent={2}><span style={{ color: TEAL_TEXT }}>{'</div>'}</span></CodeLine>
                  <CodeLine indent={1}>{')'}</CodeLine>
                  <CodeLine indent={0}><span style={{ color: MINT_TEXT }}>{'}'}</span></CodeLine>
                </div>
              </div>
              {/* Chat input */}
              <div
                className="mx-3 sm:mx-4 mb-3 sm:mb-4 flex items-center gap-2 px-3 py-2.5 rounded-xl border"
                style={{
                  borderColor: 'rgba(0, 168, 181, 0.15)',
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <span className="text-xs text-bolt-elements-textTertiary flex-1">Describe what you want to build...</span>
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${TEAL}, ${MINT})` }}
                >
                  <span className="i-ph:arrow-up-bold text-white text-xs" />
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Glow behind mockup */}
        <div
          className="pointer-events-none absolute inset-0 -z-10 blur-[60px] opacity-20 rounded-2xl"
          style={{ background: `linear-gradient(135deg, ${TEAL}, ${MINT})` }}
        />
      </div>
    </section>
  );
}

function CodeLine({ indent, children, color }: { indent: number; children?: ReactNode; color?: string }) {
  return (
    <div className="font-mono text-[11px] sm:text-xs leading-relaxed" style={{ paddingLeft: `${indent * 16}px`, color }}>
      {children}
    </div>
  );
}

/* ─── Logo Strip ─── */

function LogoStrip() {
  const logos = ['Vercel', 'GitHub', 'Netlify', 'Cloudflare', 'Supabase'];
  return (
    <section className="py-10 sm:py-14 border-y" style={{ borderColor: 'rgba(0, 168, 181, 0.06)' }}>
      <p className="text-center text-xs text-bolt-elements-textTertiary mb-5 tracking-wide uppercase">Deploy anywhere</p>
      <div className="flex items-center justify-center gap-8 sm:gap-12 flex-wrap px-5">
        {logos.map((name) => (
          <span key={name} className="text-sm sm:text-base font-semibold text-bolt-elements-textTertiary/50 hover:text-bolt-elements-textTertiary transition-colors">
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ─── Features ─── */

function Features() {
  const items = [
    {
      icon: 'i-ph:chat-circle-dots-fill',
      title: 'Build by chatting',
      body: 'Describe a feature in plain language and watch the files appear, edit, and refine in real time.',
      tint: TEAL_TEXT,
      bg: TEAL_SUBTLE,
    },
    {
      icon: 'i-ph:rocket-launch-fill',
      title: 'Live preview, real runtime',
      body: 'Dependencies install and your app runs in a cloud sandbox — a real preview, not a mockup.',
      tint: MINT_TEXT,
      bg: MINT_SUBTLE,
    },
    {
      icon: 'i-ph:lock-key-fill',
      title: 'Your key, encrypted',
      body: 'Bring your own model key. It\'s encrypted at rest and synced to your account so you never re-enter it.',
      tint: TEAL_TEXT,
      bg: TEAL_SUBTLE,
    },
    {
      icon: 'i-ph:device-mobile-fill',
      title: 'Made for mobile',
      body: 'A real mobile-first workspace — generate, preview, inspect elements, and export from your phone.',
      tint: MINT_TEXT,
      bg: MINT_SUBTLE,
    },
    {
      icon: 'i-ph:git-branch-fill',
      title: 'Git integration',
      body: 'Clone repos, push changes, manage branches — all from within Palmkit. Full GitHub & GitLab support.',
      tint: TEAL_TEXT,
      bg: TEAL_SUBTLE,
    },
    {
      icon: 'i-ph:globe-hemisphere-west-fill',
      title: 'One-click deploy',
      body: 'Ship to Vercel, Netlify, or Cloudflare Pages in a single click. Your app goes live in seconds.',
      tint: MINT_TEXT,
      bg: MINT_SUBTLE,
    },
  ];

  return (
    <section id="features" className="px-5 sm:px-6 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Everything you need to ship</h2>
          <p className="text-bolt-elements-textSecondary text-sm sm:text-base max-w-lg mx-auto">
            From idea to production — Palmkit handles the entire workflow so you can focus on building.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => (
            <div
              key={it.title}
              className="group rounded-2xl border p-5 sm:p-6 transition-all hover:border-opacity-30"
              style={{
                background: 'var(--bolt-mobile-surface-bg, rgba(255,255,255,0.02))',
                borderColor: 'rgba(0, 168, 181, 0.10)',
              }}
            >
              <span
                className="flex items-center justify-center w-11 h-11 rounded-xl mb-4 group-hover:scale-110 transition-transform"
                style={{ background: it.bg, color: it.tint }}
              >
                <span className={`${it.icon} text-xl`} />
              </span>
              <h3 className="text-lg font-semibold mb-1.5">{it.title}</h3>
              <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How it Works ─── */

function HowItWorks() {
  const steps = [
    {
      n: '1',
      icon: 'i-ph:chat-text-fill',
      title: 'Describe it',
      body: 'Tell Palmkit what to build in a sentence. Our AI understands natural language.',
    },
    {
      n: '2',
      icon: 'i-ph:code-fill',
      title: 'Watch it build',
      body: 'Code is generated, dependencies install, and your app runs live in a sandbox.',
    },
    {
      n: '3',
      icon: 'i-ph:rocket-launch-fill',
      title: 'Refine & deploy',
      body: 'Iterate by chatting, then export or deploy to Vercel, Netlify, or Cloudflare.',
    },
  ];

  return (
    <section id="how-it-works" className="px-5 sm:px-6 py-14 sm:py-20" style={{ background: 'rgba(0, 168, 181, 0.02)' }}>
      <div className="mx-auto max-w-4xl">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">How it works</h2>
          <p className="text-bolt-elements-textSecondary text-sm sm:text-base">Three steps from idea to live app.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
          {steps.map((s, i) => (
            <div key={s.n} className="text-center px-2 relative">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div
                  className="hidden sm:block absolute top-5 left-[calc(50%+30px)] w-[calc(100%-60px)] h-px"
                  style={{ background: `linear-gradient(90deg, rgba(0,168,181,0.3), rgba(76,212,176,0.3))` }}
                />
              )}
              <div
                className="mx-auto mb-4 flex items-center justify-center w-14 h-14 rounded-2xl text-white relative"
                style={{ background: `linear-gradient(135deg, ${TEAL} 0%, ${MINT} 140%)` }}
              >
                <span className={`${s.icon} text-xl`} />
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-bolt-elements-background-depth-1 border text-[10px] font-bold flex items-center justify-center" style={{ borderColor: TEAL, color: TEAL }}>
                  {s.n}
                </span>
              </div>
              <h3 className="text-base font-semibold mb-1.5">{s.title}</h3>
              <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Testimonials ─── */

function Testimonials() {
  const quotes = [
    {
      text: "I built and deployed a full SaaS landing page from my phone in 15 minutes. This is insane.",
      author: "Ahmed K.",
      role: "Indie hacker",
    },
    {
      text: "Finally a coding tool that works beautifully on mobile. The live preview is a game-changer.",
      author: "Sarah M.",
      role: "Frontend dev",
    },
    {
      text: "Palmkit replaced my entire dev setup. I prototype everything here now before writing a single line.",
      author: "Leo R.",
      role: "CTO, Startup",
    },
  ];

  return (
    <section className="px-5 sm:px-6 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight mb-10">Loved by builders</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {quotes.map((q) => (
            <div
              key={q.author}
              className="rounded-2xl border p-5 sm:p-6 flex flex-col"
              style={{
                background: 'var(--bolt-mobile-surface-bg, rgba(255,255,255,0.02))',
                borderColor: 'rgba(0, 168, 181, 0.10)',
              }}
            >
              <p className="text-sm text-bolt-elements-textSecondary leading-relaxed flex-1 mb-4">"{q.text}"</p>
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${TEAL}, ${MINT})` }}
                >
                  {q.author[0]}
                </div>
                <div>
                  <p className="text-sm font-medium">{q.author}</p>
                  <p className="text-[11px] text-bolt-elements-textTertiary">{q.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ─── */

function Pricing() {
  const plans = [
    {
      name: 'Free',
      price: '$0',
      period: 'forever',
      desc: 'Try Palmkit with your own AI key.',
      features: ['Unlimited projects', 'Bring your own key', 'Live preview', 'Export & download', 'Mobile workspace'],
      cta: 'Get started',
      href: '/signup',
      highlight: false,
    },
    {
      name: 'Pro',
      price: '$12',
      period: '/month',
      desc: 'More power, more models, more deploys.',
      features: ['Everything in Free', 'Included AI credits', 'Priority sandbox', 'One-click deploy', 'GitHub integration', 'Project sync across devices'],
      cta: 'Start free trial',
      href: '/signup?plan=pro',
      highlight: true,
    },
  ];

  return (
    <section id="pricing" className="px-5 sm:px-6 py-14 sm:py-20" style={{ background: 'rgba(0, 168, 181, 0.02)' }}>
      <div className="mx-auto max-w-4xl">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">Simple, transparent pricing</h2>
          <p className="text-bolt-elements-textSecondary text-sm sm:text-base">Start free. Upgrade when you need more.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className="rounded-2xl border p-6 sm:p-7 flex flex-col relative"
              style={{
                background: plan.highlight
                  ? 'radial-gradient(120% 120% at 50% 0%, rgba(0,168,181,0.10) 0%, rgba(76,212,176,0.04) 60%, rgba(10,10,18,0.02) 100%)'
                  : 'var(--bolt-mobile-surface-bg, rgba(255,255,255,0.02))',
                borderColor: plan.highlight ? 'rgba(0, 168, 181, 0.25)' : 'rgba(0, 168, 181, 0.10)',
              }}
            >
              {plan.highlight && (
                <span
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold px-3 py-0.5 rounded-full text-white"
                  style={{ background: `linear-gradient(135deg, ${TEAL}, ${MINT})` }}
                >
                  Popular
                </span>
              )}
              <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
              <p className="text-sm text-bolt-elements-textSecondary mb-4">{plan.desc}</p>
              <div className="flex items-baseline gap-1 mb-5">
                <span className="text-3xl font-bold">{plan.price}</span>
                <span className="text-sm text-bolt-elements-textTertiary">{plan.period}</span>
              </div>
              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-bolt-elements-textSecondary">
                    <span className="i-ph:check-circle-fill mt-0.5 flex-shrink-0" style={{ color: MINT }} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                to={plan.href}
                className="w-full h-11 flex items-center justify-center rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.97]"
                style={
                  plan.highlight
                    ? {
                        background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_DARK} 140%)`,
                        color: '#fff',
                        boxShadow: `0 6px 20px ${TEAL_GLOW}`,
                      }
                    : {
                        background: 'rgba(255,255,255,0.05)',
                        color: 'var(--bolt-elements-textPrimary)',
                        border: '1px solid rgba(0, 168, 181, 0.15)',
                      }
                }
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Final CTA ─── */

function FinalCta() {
  return (
    <section className="px-5 sm:px-6 py-14 sm:py-20">
      <div
        className="mx-auto max-w-3xl rounded-3xl border p-8 sm:p-12 text-center relative overflow-hidden"
        style={{
          background:
            'radial-gradient(120% 120% at 50% 0%, rgba(0,168,181,0.12) 0%, rgba(76,212,176,0.04) 60%, transparent 100%)',
          borderColor: 'rgba(0, 168, 181, 0.15)',
        }}
      >
        {/* Decorative orbs */}
        <div
          className="pointer-events-none absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-[0.06] blur-[40px]"
          style={{ background: TEAL }}
        />
        <div
          className="pointer-events-none absolute -bottom-20 -left-20 w-40 h-40 rounded-full opacity-[0.04] blur-[40px]"
          style={{ background: MINT }}
        />

        <h2 className="text-2xl sm:text-4xl font-bold tracking-tight mb-3 relative">Your next app starts with a sentence</h2>
        <p className="text-bolt-elements-textSecondary mb-7 max-w-md mx-auto relative">
          Create a free account and build your first project in minutes. No setup required.
        </p>
        <Link
          to="/signup"
          className="relative inline-flex h-12 px-8 items-center justify-center rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.97]"
          style={{
            background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_DARK} 140%)`,
            boxShadow: `0 8px 30px ${TEAL_GLOW}`,
          }}
        >
          Get started free
        </Link>
      </div>
    </section>
  );
}

/* ─── Footer ─── */

function LandingFooter() {
  return (
    <footer
      className="px-5 sm:px-6 py-8 border-t text-sm"
      style={{ borderColor: 'rgba(0, 168, 181, 0.08)' }}
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-0 justify-between">
          <Link to="/" className="flex items-center" aria-label="Palmkit home">
            <img src="/palmkit-logo-dark.png" alt="Palmkit" className="h-6 w-auto select-none opacity-90" />
          </Link>
          <div className="flex items-center gap-5 text-bolt-elements-textSecondary">
            <FooterLink to="/terms">Terms</FooterLink>
            <FooterLink to="/privacy">Privacy</FooterLink>
            <FooterLink to="/login">Log in</FooterLink>
            <a
              href="https://github.com/6eu6/palmkit"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-bolt-elements-textPrimary transition-colors"
              aria-label="GitHub"
            >
              <span className="i-ph:github-logo text-lg" />
            </a>
          </div>
          <p className="text-xs text-bolt-elements-textTertiary">&copy; {new Date().getFullYear()} Palmkit</p>
        </div>
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
