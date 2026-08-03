-- Migration 0021: which model handles which kind of work
--
-- The composer chip picks the model that writes replies. It cannot be the
-- model that draws a picture or renders a video — a text model has no image
-- output — so those jobs are routed to a different model entirely.
--
-- Until now that routing was automatic and unopinionated: cheapest capable
-- model in the catalog. That is the right default and stays the default, but
-- it is not always the right answer. Cheapest image model is not the best
-- image model, and someone who cares which one runs currently has no way to
-- say so.
--
-- One row per user per capability. Absent means automatic, which is why there
-- is no 'auto' sentinel value to store: not choosing is not a choice that
-- needs recording, and a missing row cannot drift out of sync with a model
-- that has since been retired.
--
-- The capability list is closed on purpose. These are the questions the
-- router can actually answer from a descriptor — output modality, input
-- modality, reasoning support — not a taxonomy invented for a settings
-- screen. Adding one means teaching the router to answer it first.

create table if not exists public.model_assignments (
  user_id uuid not null references auth.users (id) on delete cascade,
  capability text not null,
  provider text not null,
  model text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, capability),
  constraint model_assignments_capability_check
    check (capability in ('text', 'image', 'video', 'vision', 'reasoning', 'audio'))
);

alter table public.model_assignments enable row level security;

-- Assignments are personal: a user reads and writes only their own.
drop policy if exists "model_assignments_select_own" on public.model_assignments;
create policy "model_assignments_select_own" on public.model_assignments
  for select using (auth.uid() = user_id);

drop policy if exists "model_assignments_insert_own" on public.model_assignments;
create policy "model_assignments_insert_own" on public.model_assignments
  for insert with check (auth.uid() = user_id);

drop policy if exists "model_assignments_update_own" on public.model_assignments;
create policy "model_assignments_update_own" on public.model_assignments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "model_assignments_delete_own" on public.model_assignments;
create policy "model_assignments_delete_own" on public.model_assignments
  for delete using (auth.uid() = user_id);
