# Palmkit — Status & Operations

_Last verified: 2026-07-03. This is the operational source of truth for how
Palmkit is deployed, how the worker scales, and what was verified live._

---

## 1. Deployment topology (single source of truth = `main`)

| Layer | Source | Mechanism | Verified |
|-------|--------|-----------|----------|
| **Frontend** | `main` | Cloudflare Pages (project `mobile-ai-dev-workspace`, custom domain **palmkit.app**) — production branch = `main`; every push to `main` builds + deploys | ✅ prod deploy from `main` succeeded |
| **Build worker** | `main` | GitHub Actions `.github/workflows/deploy-worker.yml` — on push to `main` touching `external-worker/**`, SSHes to each Oracle box, `git reset --hard origin/main`, `bun install`, restart | ✅ worker deploy from `main` succeeded |
| **Database / auth / queue** | — | Supabase (`ijbosijtfxehmnfhnnuq`) — `build_jobs`, `job_events`, `project_files_manifest`, `user_api_keys` | ✅ |
| **File storage** | — | Cloudflare R2 (`palmkit-files`) + Supabase Storage mirror | ✅ |
| **Build sandbox** | — | E2B (remote cloud sandboxes — npm install / build run here, NOT on the Oracle box) | ✅ |

> **Both the frontend and the worker deploy from `main`.** The old
> `claude/palmkit-production-plan-*` branch was never the real deploy source for
> either (the GitHub Actions workflow has always used `main`); `setup.sh` now
> also points new workers at `main`.

---

## 2. The build worker

### Specs (Oracle box — from `external-worker/deploy/setup.sh`)
- Oracle Cloud **A1.Flex** (Ampere ARM64 / aarch64), Oracle Linux 9.
- Runtime **Bun** (`bun run src/index.ts`), systemd service `palmkit-worker`
  (`Restart=always`), **`MemoryMax=5500M`**.
- Path `/opt/palmkit-worker/external-worker`; nginx exposes only `/health` and
  `/jobs/*` on port 80.

### What it does (per job)
1. Poll Supabase `build_jobs` every **2s**; claim one pending job atomically via
   `claim_next_build_job()` (safe across multiple worker instances).
2. Run the orchestrated build: **Researcher → Builder → Tester** (streamed LLM
   with tools: write_file / read_file / list_files / run_shell / run_tests /
   screenshot / done / update_todos).
3. Heavy shell work runs in a **remote E2B sandbox** — one persistent sandbox
   per job, lazily created on first `run_shell`, TTL 16 min, killed at job end.
4. Build verification + up to **2 repair rounds**; hard timeout **15 min/job**.
5. Upload to R2, write manifest + worklog + `.palmkit/` memory, emit
   `job_events` (progress / reasoning / file writes / shell commands).
6. Stuck-job reaper every 60s (re-queue >25 min stuck jobs twice, then fail).

### Concurrency & capacity
- Hard cap **`MAX_CONCURRENT_JOBS = 10`** parallel builds **per worker**
  (`external-worker/src/index.ts`); claims 1 new job / 2s.
- Each job is **I/O-bound** (waiting on the LLM + E2B), not CPU-bound on the box.
- **Per worker:** ~10 simultaneous builders (0 queue). Realistic sustained
  concurrent active users (avg ~2 min build): ~25 (heavy) / ~50 (normal) /
  ~100 (light) per worker.
- **The real ceilings before box CPU/RAM:** (1) LLM API rate limits — if users
  lean on the shared `OPENROUTER_API_KEY`, all workers share one key's limit and
  extra workers add nothing; (2) E2B concurrent-sandbox limit (N workers ⇒ up to
  N×10 live sandboxes); (3) RAM 5500M/worker. Verify (1) and (2) before scaling.

### Adding a worker
1. Provision an Oracle A1 box.
2. `bash <(curl -fsSL https://raw.githubusercontent.com/6eu6/Palmkit/main/external-worker/deploy/setup.sh)`
3. Fill `/opt/palmkit-worker/external-worker/.env` (see §5).
4. `sudo systemctl start palmkit-worker`.
5. Add its `ORACLE_HOST_N` + `ORACLE_SSH_KEY_N` GitHub secrets so
   `deploy-worker.yml` auto-deploys to it (matrix supports workers 1–4; unset
   slots are skipped). All boxes share `ORACLE_USER` (e.g. `opc`).

---

## 3. Features (recent)

- **Context-pressure "fresh chat" nudge** — the "continue in a fresh chat"
  suggestion is driven by the worker's real peak-token measurement vs the
  model's context window (persisted as `validation_result.contextPressure`),
  not a file count.
- **Fork** — "continue in a fresh chat" carries the project + memory into a new
  chat; navigation + file collection fixed (`getNextId` no longer yields `NaN`).
- **Per-turn build stream** — each edit keeps its own collapsible timeline.
- **Mobile shell** — bottom dock collapsed to **Chat + Workspace**; the
  workspace exposes file / diff / preview (slider) + terminal.
- **Live workspace during a build**: the editor follows the file being written
  (live code); the terminal streams the agent's real E2B shell commands (live
  terminal); the Diff view shows this turn's before→after (live diff).
- **Edits** feed whole files (100 KB budget, was a 12 KB mid-file cut) + the
  project worklog.

---

## 4. Comprehensive live test (2026-07-03, real worker + LLM + E2B)

Run against the app with the real Oracle worker via Supabase.

| Check | Result |
|-------|--------|
| Auth / session | ✅ |
| Model selector + OpenRouter key "Active" | ✅ |
| Static build (coffee-shop landing page) → complete | ✅ |
| Build stream: planning, agent reasoning, live file writes, todos plan | ✅ |
| Live code streaming into the editor | ✅ |
| Edit (follow-up) → complete | ✅ |
| Live diff shows the edit's changes | ✅ |
| Mobile 2-tab dock (Chat / Workspace) | ✅ |
| React + Vite + Tailwind build | ⚠️ stalled — model looped rewriting `vite.config.js` ×4; the orchestrator loop-guard aborted cleanly ("Please try again") |

All test data was removed from Supabase after the run.

---

## 5. Worker `.env` (required keys)

Set on each box at `/opt/palmkit-worker/external-worker/.env`:

```
SUPABASE_URL=                 # https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=    # server-side only
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=palmkit-files
API_KEY_ENCRYPTION_KEY=       # same value as Cloudflare Pages env
E2B_API_KEY=                  # REQUIRED — build sandbox
OPENROUTER_API_KEY=           # LLM fallback when a user has no key
WORKER_PORT=8787
# ADMIN_TOKEN=                # optional — only for POST /admin/update
```

The worker does **not** need `SUPABASE_ANON_KEY` (that's the frontend's).

---

## 6. Known issues / follow-ups

- **Model loop stalls** — some models (e.g. GLM 4.7) can loop rewriting one
  file; the orchestrator aborts at 4 rewrites. Consider raising the threshold or
  giving the agent a "this file is fine, move on" hint. Affected builds fail
  cleanly and are retryable.
- **Live diff** covers edits (non-empty baseline); a from-scratch build shows no
  diff by design.
- **Shared fallback LLM key** caps horizontal scaling — prefer per-user keys or
  a higher-tier OpenRouter plan when adding workers.

---

## 7. Security

Rotate any secret that has been shared outside the box (Cloudflare API token,
Supabase service-role key, R2 secret, E2B key, encryption key) periodically and
after any exposure. Keep them only in the box `.env` and the Cloudflare/GitHub
secret stores — never in code or chat.
