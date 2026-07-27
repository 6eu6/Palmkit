-- Palmkit: Build Orchestration — Phase 1 (Safety Gate)
--
-- Creates 3 tables for tracking build jobs without storing file CONTENT in
-- Postgres (file content lives in browser storage / R2 in Phase 2):
--
--   1. public.build_jobs          — one row per "build me this app" request
--   2. public.build_steps         — ordered steps within a job (plan, generate, validate, repair, ready)
--   3. public.project_files_manifest — file metadata (path, hash, size, storage pointer) per project
--
-- Design rules (see ROADMAP.md Phase 1):
--   - Supabase stores METADATA ONLY. No file content blobs here.
--   - Each user can read/write only their own jobs/steps/manifests (RLS).
--   - status values are a closed set (CHECK constraint) to keep the state
--     machine honest:
--       build_jobs.status:  generating | incomplete_retrying | failed_clean | ready_for_preview
--       build_steps.status: pending | running | completed | failed | skipped
--   - Retries are bounded by build_jobs.retry_count (Phase 1 caps at 2).
--
-- Run after 0005_deployments.sql.

-- ─── build_jobs ─────────────────────────────────────────────────────────────

create table if not exists public.build_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Closed state machine — see CHECK below.
  status text not null default 'generating'
    check (status in ('generating', 'incomplete_retrying', 'failed_clean', 'ready_for_preview')),

  -- Current phase label shown to the user (e.g. "Generating checkout page").
  current_step text,

  -- 0..100 — UI progress bar.
  progress smallint not null default 0 check (progress >= 0 and progress <= 100),

  -- Bounded retry counter. Phase 1 hard-caps at 2 retries (enforced in app
  -- code, not DB — but DB stores the truth so a resumed job knows where it is).
  retry_count smallint not null default 0 check (retry_count >= 0 and retry_count <= 5),

  -- Short user-facing error message when status = 'failed_clean'.
  error_summary text,

  -- Marker presence flag: did the LLM emit __PALMKIT_DONE__ on the last attempt?
  has_completion_marker boolean not null default false,

  -- Validator result snapshot (tags balanced? required files present? etc.)
  -- Stored as jsonb so we can evolve the schema without migrations.
  validation_result jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists build_jobs_user_idx on public.build_jobs (user_id, created_at desc);
create index if not exists build_jobs_project_idx on public.build_jobs (project_id);
create index if not exists build_jobs_status_idx on public.build_jobs (status);

alter table public.build_jobs enable row level security;

drop policy if exists "build_jobs_select_own" on public.build_jobs;
create policy "build_jobs_select_own" on public.build_jobs
  for select using (auth.uid() = user_id);

drop policy if exists "build_jobs_insert_own" on public.build_jobs;
create policy "build_jobs_insert_own" on public.build_jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "build_jobs_update_own" on public.build_jobs;
create policy "build_jobs_update_own" on public.build_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "build_jobs_delete_own" on public.build_jobs;
create policy "build_jobs_delete_own" on public.build_jobs
  for delete using (auth.uid() = user_id);

-- ─── build_steps ────────────────────────────────────────────────────────────

create table if not exists public.build_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.build_jobs (id) on delete cascade,

  -- What kind of step: plan | generate_file | validate | repair | finalize
  type text not null check (type in ('plan', 'generate_file', 'validate', 'repair', 'finalize')),

  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),

  -- Ordering within the job.
  step_order integer not null default 0,

  -- Short summaries only — NO file content. Examples:
  --   input_summary:  "filePath=src/pages/Checkout.tsx"
  --   output_summary: "wrote 187 lines, hash=abc123"
  input_summary text,
  output_summary text,

  -- Error message if status = 'failed'.
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists build_steps_job_idx on public.build_steps (job_id, step_order);
create index if not exists build_steps_status_idx on public.build_steps (status);

alter table public.build_steps enable row level security;

-- Steps inherit visibility from their job via this join-tightened policy.
drop policy if exists "build_steps_select_own" on public.build_steps;
create policy "build_steps_select_own" on public.build_steps
  for select using (
    exists (
      select 1 from public.build_jobs j
      where j.id = build_steps.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists "build_steps_insert_own" on public.build_steps;
create policy "build_steps_insert_own" on public.build_steps
  for insert with check (
    exists (
      select 1 from public.build_jobs j
      where j.id = build_steps.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists "build_steps_update_own" on public.build_steps;
create policy "build_steps_update_own" on public.build_steps
  for update using (
    exists (
      select 1 from public.build_jobs j
      where j.id = build_steps.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists "build_steps_delete_own" on public.build_steps;
create policy "build_steps_delete_own" on public.build_steps
  for delete using (
    exists (
      select 1 from public.build_jobs j
      where j.id = build_steps.job_id and j.user_id = auth.uid()
    )
  );

-- ─── project_files_manifest ─────────────────────────────────────────────────
--
-- One row per (project, file path, version). When a file is rewritten, insert
-- a new row with version+1 rather than mutating the old one — this gives us a
-- cheap audit trail and lets Phase 3's patch operations diff versions.
--
-- IMPORTANT: this table holds METADATA ONLY. The actual file content lives in
-- browser storage (IndexedDB / OPFS) during Phase 1, and in Cloudflare R2
-- during Phase 2. The `storage_key` column is the pointer (e.g. an IndexedDB
-- key like 'project:<uuid>:index.html:v3', later an R2 object key).

create table if not exists public.project_files_manifest (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  path text not null,
  version integer not null default 1 check (version >= 1),

  -- Content hash (sha256, hex) so we can detect unchanged files across regens.
  hash text,

  -- Size in bytes — quick UI hint without fetching content.
  size_bytes integer,

  -- Where the content actually lives. Phase 1: 'browser'. Phase 2: 'r2'.
  storage_provider text not null default 'browser'
    check (storage_provider in ('browser', 'r2', 'memory')),

  -- Provider-specific key (IndexedDB key, R2 object key, etc.)
  storage_key text,

  -- 'complete' = validator saw a closed file with no placeholders.
  -- 'partial'  = stream cut mid-file (do NOT show in preview).
  -- 'placeholder' = validator detected TODO/.../placeholder content.
  integrity text not null default 'complete'
    check (integrity in ('complete', 'partial', 'placeholder', 'unknown')),

  created_at timestamptz not null default now()
);

-- One row per (project, path, version).
create unique index if not exists project_files_manifest_uniq
  on public.project_files_manifest (project_id, path, version);

-- Latest version lookup for a project.
create index if not exists project_files_manifest_project_path_idx
  on public.project_files_manifest (project_id, path, version desc);

alter table public.project_files_manifest enable row level security;

drop policy if exists "project_files_manifest_select_own" on public.project_files_manifest;
create policy "project_files_manifest_select_own" on public.project_files_manifest
  for select using (auth.uid() = user_id);

drop policy if exists "project_files_manifest_insert_own" on public.project_files_manifest;
create policy "project_files_manifest_insert_own" on public.project_files_manifest
  for insert with check (auth.uid() = user_id);

drop policy if exists "project_files_manifest_update_own" on public.project_files_manifest;
create policy "project_files_manifest_update_own" on public.project_files_manifest
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "project_files_manifest_delete_own" on public.project_files_manifest;
create policy "project_files_manifest_delete_own" on public.project_files_manifest
  for delete using (auth.uid() = user_id);

-- ─── updated_at triggers ────────────────────────────────────────────────────

create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists build_jobs_touch on public.build_jobs;
create trigger build_jobs_touch before update on public.build_jobs
  for each row execute function public.touch_updated_at();

drop trigger if exists build_steps_touch on public.build_steps;
create trigger build_steps_touch before update on public.build_steps
  for each row execute function public.touch_updated_at();
