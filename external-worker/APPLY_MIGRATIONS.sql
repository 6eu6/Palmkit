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
-- Palmkit: Phase 2 — External Build Worker support
--
-- Adds:
--   1. `pending` as a valid build_jobs.status (so the external worker can
--      pick up jobs that haven't started yet).
--   2. `claim_next_build_job()` RPC — atomic job claim for multiple workers.
--   3. Storage bucket 'palmkit-files' for generated project files (R2-style,
--      served via Supabase Storage in Phase 2 MVP; swap to R2 later).
--
-- See ROADMAP.md → Phase 2 → "External Build Worker".

-- ─── 1. Allow 'pending' status on build_jobs ────────────────────────────────
-- Phase 1's CHECK only allowed: generating | incomplete_retrying | failed_clean | ready_for_preview
-- Phase 2 introduces 'pending' = enqueued, waiting for a worker to claim it.

alter table public.build_jobs drop constraint if exists build_jobs_status_check;
alter table public.build_jobs add constraint build_jobs_status_check
  check (status in ('pending', 'generating', 'incomplete_retrying', 'failed_clean', 'ready_for_preview'));

-- ─── 2. claim_next_build_job() RPC ──────────────────────────────────────────
--
-- Atomically claim the oldest pending job. Uses FOR UPDATE SKIP LOCKED so
-- multiple workers can poll concurrently without grabbing the same job.
--
-- Returns the claimed job row, or NULL if no pending jobs.
--
-- Usage:
--   select * from claim_next_build_job();
--   -- or from the worker:
--   const { data } = await supabase.rpc('claim_next_build_job');

create or replace function public.claim_next_build_job()
returns public.build_jobs
language plpgsql
security definer
as $$
declare
  claimed public.build_jobs;
begin
  -- Find and lock the oldest pending job, skipping any already-locked rows.
  select * into claimed
  from public.build_jobs
  where status = 'pending'
  order by created_at
  for update skip locked
  limit 1;

  if claimed is null then
    return null;
  end if;

  -- Atomically transition it to 'generating'.
  update public.build_jobs
  set
    status = 'generating',
    current_step = 'claim',
    updated_at = now()
  where id = claimed.id and status = 'pending'
  returning * into claimed;

  return claimed;
end;
$$;

grant execute on function public.claim_next_build_job() to authenticated;

-- ─── 3. Storage bucket for project files ────────────────────────────────────
-- In Phase 2 MVP we use Supabase Storage (S3-compatible) for file content.
-- The external worker writes here; the browser fetches via signed URLs.
-- (Swap to Cloudflare R2 later by changing the worker's r2-client.ts —
-- the manifest table's storage_provider column already supports 'r2'.)

insert into storage.buckets (id, name, public)
values ('palmkit-files', 'palmkit-files', false)
on conflict (id) do nothing;

-- RLS: users can read/write only their own project files.
-- Path convention: <user_id>/<project_id>/<file_path>
drop policy if exists "palmkit_files_select_own" on storage.objects;
create policy "palmkit_files_select_own" on storage.objects
  for select using (
    bucket_id = 'palmkit-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "palmkit_files_insert_own" on storage.objects;
create policy "palmkit_files_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'palmkit-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "palmkit_files_update_own" on storage.objects;
create policy "palmkit_files_update_own" on storage.objects
  for update using (
    bucket_id = 'palmkit-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "palmkit_files_delete_own" on storage.objects;
create policy "palmkit_files_delete_own" on storage.objects
  for delete using (
    bucket_id = 'palmkit-files' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── 4. build_jobs queue trigger ────────────────────────────────────────────
-- When a new build_jobs row is inserted (by /api/jobs), default it to 'pending'
-- so the external worker picks it up. The DB default is already 'generating'
-- (from migration 0006), so we override on insert via the app layer OR add
-- a trigger. Using an app-layer default is simpler — documented here for
-- the CF Pages /api/jobs route to set status='pending' on insert.

-- (No trigger needed — the /api/jobs route sets status='pending' explicitly.)
-- Palmkit: Phase 2 fixes — make manifest flexible for job-first flow
--
-- Issues found reviewing 0006 + 0007:
--   1. project_files_manifest.project_id was NOT NULL, but a new job may not
--      have a project row yet (the project is created FROM the job output).
--      Make it nullable.
--   2. User requested mime_type + job_id columns on the manifest.
--   3. Add an index on job_id for fast "list files for this job" queries.
--
-- Run after 0007_external_worker.sql.

-- ─── 1. Make project_files_manifest.project_id nullable ─────────────────────
alter table public.project_files_manifest alter column project_id drop not null;

-- ─── 2. Add job_id + mime_type columns ──────────────────────────────────────
alter table public.project_files_manifest add column if not exists job_id uuid references public.build_jobs (id) on delete cascade;
alter table public.project_files_manifest add column if not exists mime_type text;

-- ─── 3. Index for "list files in this job" queries ──────────────────────────
create index if not exists project_files_manifest_job_idx on public.project_files_manifest (job_id);

-- ─── 4. Update the unique constraint ────────────────────────────────────────
-- Old unique was (project_id, path, version). Now that project_id can be null,
-- we need a unique on (job_id, path, version) instead for job-scoped files.
drop index if exists project_files_manifest_uniq;
create unique index if not exists project_files_manifest_job_path_uniq
  on public.project_files_manifest (job_id, path, version)
  where job_id is not null;

-- Keep the project-scoped unique for when project_id is set.
create unique index if not exists project_files_manifest_project_path_uniq
  on public.project_files_manifest (project_id, path, version)
  where project_id is not null;
-- Palmkit: job_events — fine-grained progress tracking (migration 0009)
--
-- build_steps is COARSE (one row per phase: plan/generate/validate/finalize).
-- job_events is FINE (one row per notable event: file_written, validation_check,
-- upload_started, etc.). The frontend reads these to show real-time progress.

create table if not exists public.job_events (
  id bigint primary key generated always as identity,
  job_id uuid not null references public.build_jobs (id) on delete cascade,
  type text not null,
  seq integer not null default 0,
  payload jsonb,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists job_events_job_seq_idx on public.job_events (job_id, seq);
create index if not exists job_events_job_created_idx on public.job_events (job_id, created_at);
create index if not exists job_events_type_idx on public.job_events (type);

alter table public.job_events enable row level security;

drop policy if exists "job_events_select_own" on public.job_events;
create policy "job_events_select_own" on public.job_events
  for select using (
    exists (
      select 1 from public.build_jobs j
      where j.id = job_events.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists "job_events_delete_own" on public.job_events;
create policy "job_events_delete_own" on public.job_events
  for delete using (
    exists (
      select 1 from public.build_jobs j
      where j.id = job_events.job_id and j.user_id = auth.uid()
    )
  );

comment on table public.job_events is
  'Fine-grained progress events for build jobs. Written by the external worker (service role), read by the frontend (RLS-scoped to own jobs).';
