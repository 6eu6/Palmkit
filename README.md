# Palmkit

[![Palmkit](./public/social_preview_index.jpg)](https://palmkit.app)

**Palmkit** is an AI-powered full-stack development platform that turns natural-language prompts into running web apps. Describe what you want — Palmkit builds it, previews it, and lets you iterate.

> Built on [Bolt.diy](https://github.com/stackblitz-labs/bolt.diy) with a completely redesigned execution pipeline: external Oracle worker, R2 file storage, WebContainer/E2B sandbox routing, and a phase-based roadmap to production quality.

---

## Table of Contents

- [What is Palmkit](#what-is-palmkit)
- [Tech Stack](#tech-stack)
- [Live Site](#live-site)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Project Status & Roadmap](#project-status--roadmap)
- [Available Scripts](#available-scripts)
- [License](#license)

---

## What is Palmkit

Palmkit turns a natural-language prompt into a runnable app in seconds:

1. User describes an app ("Build a coffee shop landing page with hero, menu, contact form").
2. Palmkit enqueues a build job to the Oracle ARM64 worker via Supabase.
3. The Oracle worker calls an LLM with a structured generation prompt and writes files to Cloudflare R2.
4. Palmkit routes the preview based on app type:
   - **Static HTML/CSS/JS** → blob URL preview (instant, zero cost)
   - **React / Vue / Next.js on desktop** → WebContainer (free, in-browser WASM)
   - **React / Vue / Next.js on mobile** → E2B cloud sandbox (on-demand)
   - **Python** → E2B sandbox (always — needs server runtime)
   - **Flutter / React Native** → source download + run instructions
5. The preview renders live in an iframe.

**20+ LLM providers** supported: OpenAI, Anthropic, Google, Groq, xAI, DeepSeek, Mistral, Cohere, Together, Perplexity, HuggingFace, Ollama, LM Studio, OpenRouter, Moonshot, Hyperbolic, GitHub Models, Amazon Bedrock, OpenAI-like.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Remix + Vite |
| **Runtime** | Cloudflare Pages (Workers runtime) |
| **AI Providers** | OpenRouter + 19 others (via Vercel AI SDK) |
| **Auth + DB** | Supabase (Postgres + Auth + RLS) |
| **File Storage** | Cloudflare R2 (via S3-compatible API) |
| **Build Worker** | Oracle ARM64 (Bun, external worker) |
| **Desktop Preview** | WebContainer (`@webcontainer/api`) |
| **Mobile Preview** | E2B cloud sandbox |
| **Desktop App** | Electron |
| **Deploy Targets** | Netlify, Vercel, GitHub Pages |

---

## Live Site

- **Production**: https://palmkit.app
- **Cloudflare Pages project**: `mobile-ai-dev-workspace`
- **Repo**: https://github.com/6eu6/Palmkit

---

## Quick Start

### Prerequisites

- Node.js LTS
- pnpm (`npm install -g pnpm`)

### Local Development

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local — set OPENROUTER_API_KEY and SUPABASE_* vars at minimum
pnpm run dev
```

App runs at `http://localhost:5173`.

### Docker

```bash
cp .env.example .env.local
pnpm run dockerbuild         # dev image
docker compose --profile development up
```

### Desktop (Electron)

```bash
pnpm install
pnpm electron:build:dist     # all platforms
# or: pnpm electron:build:mac / win / linux
```

Download a pre-built binary from [Releases](https://github.com/6eu6/Palmkit/releases/latest).

---

## Configuration

All configuration lives in `.env.local`. Key variables:

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | Default LLM provider |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Auth + job queue + metadata |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | File storage for built projects |
| `R2_BUCKET_NAME` | R2 bucket (default: `palmkit-files`) |
| `E2B_API_KEY` | Cloud sandbox for mobile users / Python apps |
| `VITE_DEPLOYMENT_PLATFORM_*` | Netlify / Vercel / GitHub deploy |

Provider API keys can also be entered per-user via the in-app **Edit API Key** dialog (stored server-side, never in localStorage).

See [`.env.example`](./.env.example) for the full list.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Browser (Remix SPA)                                              │
│  ├── Chat UI (streaming annotations)                             │
│  ├── Workbench (Monaco editor + file tree)                       │
│  ├── Preview iframe (blob URL / WebContainer / E2B)              │
│  └── Build status gate (prevents broken previews)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────────┐
│ Cloudflare Pages Function (Remix)                               │
│  ├── /api/chat       ← streaming LLM + validation annotations   │
│  ├── /api/jobs       ← enqueue / poll build jobs                │
│  ├── /api/files      ← proxy R2 files to frontend               │
│  └── /api/sb         ← E2B sandbox proxy (auth + rate-limit)    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────────┐
        ▼                  ▼                       ▼
   Supabase           Oracle Worker           Cloudflare R2
   (jobs queue +      (Bun, ARM64)            (built files,
    auth + RLS)       LLM → files             10 GB free)
                      → R2 → done signal
                           │
               ┌───────────┴──────────┐
               ▼                      ▼
          WebContainer              E2B Sandbox
          (desktop, free)           (mobile / Python)
```

---

## Project Status & Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the full technical ledger and phase plan.

**Quick summary**:

| Phase | Status | Goal |
|-------|--------|------|
| **Phase 1 — Safety Gate** | ✅ Complete | Prevent broken previews; completion marker + validator + retry state machine |
| **Phase 2 — Build Orchestrator** | ✅ Complete | Oracle ARM64 worker + R2 storage; removes Cloudflare CPU limits |
| **Phase 3 — Sandbox Execution** | ✅ Complete | WebContainer (desktop) + E2B (mobile) for React/Vue/Next.js/Python |
| **Phase 4 — Build Verification** | 🔲 Planned | Real `npm run build` + auto-repair agent; zero broken React apps |
| **Phase 5 — SSE Progress Stream** | 🔲 Planned | Real-time file-by-file build progress UI |
| **Phase 6 — Project History** | 🔲 Planned | Save / re-open / export projects per user |
| **Phase 7 — Multi-turn Edit** | 🔲 Planned | Smart patch mode for incremental changes |
| **Phase 8 — Native App Delivery** | 🔲 Planned | Flutter web build, Expo QR, Python persistent backend |

---

## Available Scripts

| Script | Purpose |
|--------|---------|
| `pnpm run dev` | Start dev server (port 5173) |
| `pnpm run build` | Production build (Remix + Vite) |
| `pnpm run preview` | Build + serve locally |
| `pnpm run lint` | ESLint |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run test` | Vitest |
| `pnpm run deploy` | Build + `wrangler pages deploy` |
| `pnpm run db:push` | Apply Supabase migrations (if configured) |
| `pnpm electron:build:*` | Build desktop binaries |

---

## License

[MIT](./LICENSE) — Palmkit is open source. Based on [Bolt.diy](https://github.com/stackblitz-labs/bolt.diy) by the StackBlitz Labs community.
