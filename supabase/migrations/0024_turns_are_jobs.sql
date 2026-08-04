-- Migration 0024: a turn is a job, and a job says what it is
--
-- Generation moves off Cloudflare entirely. The platform kills any request
-- that runs JavaScript per chunk of a model stream — Error 1102 — and short
-- answers survive only by being short, which is luck rather than a design: the
-- failure returns the moment an answer gets long. The worker already runs work
-- in the background, creates a container on demand and destroys it when the
-- job finishes, so that is where every turn belongs.
--
-- Two columns are what the job table is missing to carry one.
--
-- `request` is the turn's input. Today the prompt, the chat id and the images
-- are packed into `validation_result` — a jsonb column named for the output of
-- validation — because it was the only free jsonb on the table. Nothing reads
-- it as validation, so nothing breaks by moving, but anyone reading the schema
-- is misled, and a second thing to store would have gone in the same drawer.
--
-- `kind` is what the worker switches on. A build and a chat turn are the same
-- row shape and very different work: one writes files and validates them, the
-- other streams prose back and may call tools. Without it the worker has to
-- guess from the payload, and guessing is how the two paths quietly diverge —
-- which is the whole reason for having one path.
--
-- Idempotent, and it backfills what is already queued so nothing in flight is
-- stranded by the change.

alter table public.build_jobs
  add column if not exists request jsonb;

alter table public.build_jobs
  add column if not exists kind text not null default 'build'
    check (kind in ('build', 'chat'));

-- Everything queued so far is a build whose input lives in the old column.
update public.build_jobs
set request = validation_result
where request is null
  and validation_result is not null;

create index if not exists build_jobs_kind_status_idx
  on public.build_jobs (kind, status, created_at);

comment on column public.build_jobs.request is
  'The turn''s input: prompt, chat id, model, mode, image pointers. Previously packed into validation_result, which is named for validation output and read by nothing as such.';

comment on column public.build_jobs.kind is
  'What the worker should run: build writes and validates files, chat streams a reply and may call tools. Both are jobs so there is one path, one place for tools, cost and memory.';
