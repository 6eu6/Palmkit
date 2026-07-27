-- Palmkit: job_events — fine-grained progress tracking
--
-- build_steps is COARSE (one row per phase: plan/generate/validate/finalize).
-- job_events is FINE (one row per notable event: file_written, validation_check,
-- upload_started, etc.). The frontend reads these to show real-time progress:
--
--   ✓ Planning app structure
--   ✓ Created index.html (284 lines)
--   ✓ Created styles.css (502 lines)
--   ⏳ Creating app.js...
--   ○ Validating output
--   ○ Uploading snapshot to R2
--
-- Run after 0008_manifest_fixes.sql.

create table if not exists public.job_events (
  id bigint primary key generated always as identity,
  job_id uuid not null references public.build_jobs (id) on delete cascade,

  -- Event type (closed set for UI rendering). New types can be added freely.
  type text not null,

  -- Sequence number within the job (for ordering). The frontend uses this
  -- to display events in the correct order even if polling returns them
  -- out of order.
  seq integer not null default 0,

  -- Arbitrary JSON payload (file path, line count, error message, etc.)
  payload jsonb,

  -- Human-readable message shown to the user (e.g. "Created index.html (284 lines)")
  message text,

  created_at timestamptz not null default now()
);

create index if not exists job_events_job_seq_idx on public.job_events (job_id, seq);
create index if not exists job_events_job_created_idx on public.job_events (job_id, created_at);
create index if not exists job_events_type_idx on public.job_events (type);

alter table public.job_events enable row level security;

-- A user can see events for their own jobs only.
drop policy if exists "job_events_select_own" on public.job_events;
create policy "job_events_select_own" on public.job_events
  for select using (
    exists (
      select 1 from public.build_jobs j
      where j.id = job_events.job_id and j.user_id = auth.uid()
    )
  );

-- The external worker uses the service role key (bypasses RLS) to INSERT.
-- Users never insert events directly — only the worker does.
-- So we do NOT create an insert policy for authenticated users.

drop policy if exists "job_events_delete_own" on public.job_events;
create policy "job_events_delete_own" on public.job_events
  for delete using (
    exists (
      select 1 from public.build_jobs j
      where j.id = job_events.job_id and j.user_id = auth.uid()
    )
  );

-- Helpful comment for future maintainers.
comment on table public.job_events is
  'Fine-grained progress events for build jobs. Written by the external worker (service role), read by the frontend (RLS-scoped to own jobs).';
