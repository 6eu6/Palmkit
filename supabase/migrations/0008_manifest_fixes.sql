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
