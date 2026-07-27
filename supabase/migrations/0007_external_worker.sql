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
