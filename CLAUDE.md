# Palmkit — Codebase Index

> **Purpose**: Fast navigation map for any tool or developer. Find any feature in one lookup.
> **Stack**: Remix + Vite + Cloudflare Pages + Oracle ARM64 Worker + Supabase + Cloudflare R2 + WebContainer/E2B

---

## Quick-Find: Feature → File

| Feature | File(s) |
|---------|---------|
| AI chat (generation via external worker) | `app/routes/api.chat.ts`, `app/components/chat/Chat.client.tsx` |
| Build job queue (enqueue/poll) | `app/routes/api.jobs.ts` |
| Job processor (Oracle Worker) | `external-worker/src/job-processor.ts` |
| LLM generation (JSON files) | `external-worker/src/generator.ts` |
| Project type detection | `external-worker/src/generator.ts:planProject()` |
| Build check + auto-repair | `external-worker/src/build-checker.ts`, `generator.ts:repairGeneration()` |
| R2 file storage | `external-worker/src/r2-client.ts` |
| API key storage/fetch | `external-worker/src/key-fetcher.ts` |
| Event emission (progress) | `external-worker/src/event-emitter.ts` |
| Provider registry | `external-worker/src/provider-registry.ts` |
| Preview (iframe + blob) | `app/components/workbench/Preview.tsx` |
| Visual element inspector | `app/components/workbench/Inspector.tsx`, `public/inspector-script.js` |
| Inspector panel (chat side) | `app/components/workbench/InspectorPanel.tsx` |
| WebContainer + E2B bridge | `app/lib/hooks/use-worker-sandbox.ts` |
| Worker state hook (polling) | `app/lib/hooks/use-external-worker.ts` |
| Build status store | `app/lib/stores/build-status.ts` |
| Preview files store | `app/lib/stores/build-status.ts:previewFilesStore` |
| Worker progress events UI | `app/components/chat/WorkerProgress.tsx` |
| Project history page | `app/routes/builds.tsx`, `app/routes/api.account.builds.ts` |
| ZIP export | `app/routes/api.export-zip.ts` |
| Auth (Supabase SSR) | `app/lib/auth/supabase.server.ts`, `app/routes/auth.callback.tsx` |
| Supabase migrations | `supabase/migrations/` |
| Cloudflare Worker entry | `functions/[[path]].ts` |
| Oracle Worker entry | `external-worker/src/index.ts` |
| Oracle deploy workflow | `.github/workflows/deploy-worker.yml` |
| Wrangler/CF config | `wrangler.toml` |
| App settings panel | `app/components/@settings/` |
| File editor (CodeMirror) | `app/components/editor/codemirror/` |
| Sidebar/chat history | `app/components/sidebar/Menu.client.tsx` |
| Model selector | `app/components/chat/ModelSelector.tsx` |
| Landing page | `app/routes/_index.tsx`, `app/components/landing/` |
| Mobile shell | `app/components/mobile/MobileShell.tsx` |
| Electron desktop | `electron/` |
| Sandbox server (Docker/E2B) | `sandbox-server/` |

---

## Architecture Overview

```
Browser (Remix + Vite)
  │
  ├── Cloudflare Pages Functions (functions/[[path]].ts)
  │     ├── /api/chat        → lightweight enqueue to Oracle Worker
  │     ├── /api/jobs        → job status polling + events
  │     ├── /api/files       → file content from R2
  │     └── /api/export-zip  → ZIP download from R2
  │
  ├── Oracle ARM64 Worker (external-worker/)
  │     ├── polls Supabase build_jobs every 2s
  │     ├── generates files via LLM (JSON output)
  │     ├── validates + builds + repairs
  │     └── uploads to R2 + writes manifest to Supabase
  │
  ├── Supabase (DB + Auth + Storage)
  │     ├── build_jobs        → job queue + status
  │     ├── job_events        → real-time progress stream
  │     ├── project_files_manifest → file metadata
  │     └── user_api_keys     → encrypted LLM keys
  │
  └── Cloudflare R2
        └── palmkit-files bucket
              └── projects/{projectId}/jobs/{jobId}/files/{path}
```

---

## Database Schema (Supabase)

### `build_jobs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | gen_random_uuid() |
| `user_id` | uuid FK | auth.users |
| `project_id` | uuid nullable | links to projects |
| `status` | text | pending → generating → ready_for_preview / failed_clean |
| `current_step` | text | queued / plan / generate / validate / build_check / uploading / done |
| `progress` | int | 0–100 |
| `retry_count` | int | |
| `validation_result` | jsonb | prompt, model, provider, appType, editJobId, runtimeMode |
| `error_summary` | text | |
| `has_completion_marker` | bool | legacy Phase 1 |

### `job_events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `job_id` | uuid FK | build_jobs |
| `type` | text | job_created / planning_started / file_generation_started / validation_passed / build_check_started / build_check_passed / ready_for_preview / edit_started / edit_completed / job_failed |
| `seq` | int | ordering |
| `message` | text | human-readable |
| `payload` | jsonb | extra data |

### `project_files_manifest`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `job_id` | uuid FK | build_jobs |
| `path` | text | relative path e.g. src/App.tsx |
| `storage_key` | text | R2 key (not `r2_key`) |
| `size_bytes` | int | |
| `mime_type` | text | |
| `integrity` | text | SHA-256 |

### `user_api_keys`
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | uuid | |
| `provider` | text | OpenRouter / Anthropic / OpenAI / etc. |
| `encrypted_key` | text | AES-256-GCM |

---

## Phase Status (All 8 Complete)

| Phase | Name | Key Files |
|-------|------|-----------|
| ✅ 1 | Safety Gate | `build-status.ts:canShowPreview`, `api.chat.ts` |
| ✅ 2 | Build Orchestrator | `job-processor.ts`, `generator.ts`, `r2-client.ts` |
| ✅ 3 | Sandbox Execution | `use-worker-sandbox.ts`, `Preview.tsx` |
| ✅ 4 | Build Verification | `build-checker.ts`, `build-runner.ts` |
| ✅ 5 | SSE Progress Stream | `event-emitter.ts`, `WorkerProgress.tsx` |
| ✅ 6 | Project History | `builds.tsx`, `api.account.builds.ts` |
| ✅ 7 | Multi-turn Edit | `generator.ts:generateEdit()`, `job-processor.ts` (editJobId branch) |
| ✅ 8 | Export & Delivery | `api.export-zip.ts` |

---

## Supported App Types

| Type | Detection keywords | Preview method | Build check |
|------|--------------------|---------------|-------------|
| `static` | html, vanilla, landing page, plain js | Blob URL (direct) | None |
| `react` | react, vite, tsx, jsx, hooks | WebContainer (desktop) / E2B (mobile) | ✅ bun build |
| `vue` | vue, vuex, pinia, nuxt | WebContainer (desktop) / E2B (mobile) | ✅ bun build |
| `nextjs` | next.js, nextjs, app router | WebContainer (desktop) / E2B (mobile) | ✅ bun build |
| `python` | python, flask, fastapi, django | E2B always | None |
| `flutter` | flutter, dart | Download only | None |
| `react-native` | react-native, expo | Download only | None |

---

## Key Env Variables

### Cloudflare Pages (wrangler.toml / CF dashboard secrets)
```
SUPABASE_URL                  Supabase project URL
SUPABASE_ANON_KEY             Supabase anon key (browser-safe)
SUPABASE_SERVICE_ROLE_KEY     Service role key (server-side only)
R2_ACCOUNT_ID                 Cloudflare account ID
R2_ACCESS_KEY_ID              R2 access key
R2_SECRET_ACCESS_KEY          R2 secret key
R2_BUCKET                     palmkit-files
```

### Oracle Worker (`/opt/palmkit-worker/external-worker/.env`)
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY            Fallback key (user keys preferred)
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
WORKER_PORT                   Default: 8787
ADMIN_TOKEN                   For POST /admin/update
```

### GitHub Actions Secrets (for deploy-worker.yml)
```
ORACLE_HOST    130.61.131.77
ORACLE_USER    opc
ORACLE_SSH_KEY (private RSA key)
```

---

## API Routes Reference

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chat` | POST (stream) | Main chat; enqueues Oracle Worker job |
| `/api/jobs` | POST | Enqueue build job |
| `/api/jobs` | GET `?id=` | Poll job status + events + manifest |
| `/api/files` | GET `?jobId=&path=` | Fetch file content from R2 |
| `/api/export-zip` | GET `?jobId=` | Download ZIP of all project files |
| `/api/account/builds` | GET | List user's completed builds |
| `/api/account/builds` | DELETE `?id=` | Delete a build |
| `/api/models` | GET | List available models |
| `/api/enhancer` | POST | Prompt enhancement |
| `/api/check-env-key` | POST | Validate provider API key |
| `/api/configured-providers` | GET | Which providers have keys set |
| `/api/sb` | GET/POST | Supabase proxy for frontend |
| `/api/health` | GET | Health check |

### Oracle Worker Internal
| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Worker health check |
| `/jobs/stats` | GET | Active job count |
| `/admin/update` | POST | Self-update (requires `x-admin-token`) |

---

## Visual Editor (Inspector) Architecture

**Flow**: Preview iframe ← postMessage → Inspector.tsx / Preview.tsx

1. User clicks inspector icon in Preview toolbar → `toggleInspectorMode()`
2. `INSPECTOR_ACTIVATE { active: true }` sent to iframe
3. `public/inspector-script.js` (injected into blob HTML) adds mousemove/click listeners
4. On hover: `INSPECTOR_HOVER { elementInfo }` → blue overlay rendered in Inspector.tsx
5. On click: `INSPECTOR_CLICK { elementInfo }` → `displayText` copied to clipboard + `setSelectedElement()`
6. `InspectorPanel.tsx` shows selected element info in chat sidebar

**Known Limitations** (see improvement plan):
- Single element select only (no multi-select)
- No direct edit panel — user must describe changes in chat
- Coordinate drift in device-framed mode (scale transforms not compensated)
- Only works for blob URL (static) and WebContainer previews, not E2B

---

## Deployment

### Cloudflare Pages
- Push to `main` → auto-deploy via Cloudflare Pages CI
- Config: `wrangler.toml`

### Oracle Worker
- Managed by systemd service `palmkit-worker` on `opc@130.61.131.77`
- Path: `/opt/palmkit-worker/external-worker/`
- Deploy: GitHub Actions (`.github/workflows/deploy-worker.yml`) or `POST /admin/update`
- Start: `bun run src/index.ts` (via systemd)

---

## Common Search Patterns

```bash
# Find where a job status is set
grep -r "status.*ready_for_preview\|ready_for_preview" external-worker/src/

# Find all event types emitted
grep -r "emitEvent" external-worker/src/ | grep "'"

# Find where previewFilesStore is populated
grep -r "setPreviewFiles\|previewFilesStore" app/

# Find all API routes
ls app/routes/api.*.ts

# Find build_jobs queries
grep -r "build_jobs" app/routes/ external-worker/src/

# Find LLM provider registration
cat external-worker/src/provider-registry.ts
```
