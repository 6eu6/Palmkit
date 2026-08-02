-- Migration 0015: folders — the Projects feature
--
-- A folder groups conversations that belong to the same piece of work
-- ("Client X app", "Landing page"). It is a grouping, not a new kind of
-- conversation: every conversation still belongs to exactly one tab (`mode`,
-- see 0011), and a folder is a filter layered on top of that.
--
-- Folders span all three tabs on purpose. Real work does not respect the tab
-- split — one job means code sessions in Code, questions in Chat and a
-- document in Work.
--
-- NAMING: the table `projects` holds CONVERSATIONS (it is the account-side
-- mirror of the local chat store). The user-facing name for a folder is
-- "project", but the schema must not reuse that word or the two become
-- impossible to tell apart.

create table if not exists public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists folders_user_idx on public.folders (user_id, updated_at desc);

alter table public.folders enable row level security;

do $$
begin
  drop policy if exists "own folders" on public.folders;
  create policy "own folders" on public.folders
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception
  when others then
    raise notice 'Policy creation skipped: %', sqlerrm;
end $$;

-- The link, on the conversation side.
--
-- ON DELETE SET NULL is the important part: deleting a folder must never
-- cascade into deleting the conversations inside it. They simply return to
-- the ungrouped list.
alter table public.projects
  add column if not exists folder_id uuid references public.folders (id) on delete set null;

-- The sidebar's list query is "this user, this project, this mode, pinned
-- first, newest first".
create index if not exists projects_user_folder_idx
  on public.projects (user_id, folder_id, mode, pinned desc, updated_at desc);
