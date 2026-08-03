-- Migration 0018: shared model capability catalog
--
-- What each model can do, established once for the whole install rather than
-- once per user. A capability probe costs a fraction of a cent and a few
-- seconds; doing it per user would repeat that for every person who connects
-- the same provider, for an answer that cannot differ between them — the model
-- either accepts an image or it does not.
--
-- Deliberately NOT per-user and NOT RLS-restricted for reads: there is nothing
-- private here. It is public knowledge about public models. Writes go through
-- the service role only, so a client cannot poison it.

create table if not exists public.model_catalog (
  provider text not null,
  model text not null,

  -- The merged descriptor. JSON rather than columns because the shape will
  -- grow as providers expose more, and a new capability must not need a
  -- migration before it can be recorded.
  descriptor jsonb not null,

  -- Which layer established it: provider-api | probe | catalog | heuristic.
  source text not null,
  confidence real not null default 0,

  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (provider, model)
);

create index if not exists model_catalog_provider_idx on public.model_catalog (provider);

alter table public.model_catalog enable row level security;

-- Readable by any signed-in user; the service role does the writing.
drop policy if exists "model_catalog_read" on public.model_catalog;
create policy "model_catalog_read" on public.model_catalog
  for select using (auth.role() = 'authenticated');
