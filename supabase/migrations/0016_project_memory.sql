-- Migration 0016: per-project memory
--
-- A project can either share the user's memory with the rest of the app, or
-- keep its own memory to itself:
--
--   default       the project reads the global profile, and anything learned
--                 inside it is written back to the global profile — so it is
--                 visible from outside chats too, and vice versa.
--   project_only  the project reads ONLY its own memory, and anything learned
--                 inside it is written ONLY there. Outside chats never see it.
--
-- WHY A SEPARATE TABLE FOR THE PROFILE
--
-- `user_memory` is the layer that actually reaches the model: it is injected
-- in full on every request. `memory_facts` (layer 3) is only populated when
-- the extractor emits key=value lines, which in practice it rarely does — so
-- scoping facts alone would leave project_only leaking the real memory and
-- the feature would be cosmetic. `folder_memory` gives each project its own
-- profile, keyed the same way `user_memory` is.

alter table public.folders
  add column if not exists memory_mode text not null default 'default';

do $$
begin
  alter table public.folders drop constraint if exists folders_memory_mode_check;
  alter table public.folders
    add constraint folders_memory_mode_check
    check (memory_mode in ('default', 'project_only'));
exception
  when others then
    raise notice 'Constraint creation skipped: %', sqlerrm;
end $$;

-- ─── Per-project profile (the project's own layer 1) ──────────────────
create table if not exists public.folder_memory (
  user_id     uuid not null references auth.users (id) on delete cascade,
  folder_id   uuid not null references public.folders (id) on delete cascade,
  content     text not null default '',
  line_count  integer not null default 0,
  max_lines   integer not null default 40,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (user_id, folder_id)
);

alter table public.folder_memory enable row level security;

do $$
begin
  drop policy if exists "own folder memory" on public.folder_memory;
  create policy "own folder memory" on public.folder_memory
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception
  when others then
    raise notice 'Policy creation skipped: %', sqlerrm;
end $$;

-- ─── Facts (layer 3) become project-aware too ─────────────────────────
alter table public.memory_facts
  add column if not exists folder_id uuid references public.folders (id) on delete set null;

create index if not exists memory_facts_user_folder_idx
  on public.memory_facts (user_id, folder_id, updated_at desc);

/*
 * The old unique key was (user_id, fact_key), which would let one project
 * overwrite another's fact of the same name. Scope it by folder as well.
 * NULLS NOT DISTINCT so the global scope (folder_id is null) still collapses
 * duplicates rather than allowing one row per insert.
 */
do $$
begin
  alter table public.memory_facts drop constraint if exists memory_facts_user_id_fact_key_key;
  alter table public.memory_facts drop constraint if exists memory_facts_user_folder_key_uniq;
  alter table public.memory_facts
    add constraint memory_facts_user_folder_key_uniq
    unique nulls not distinct (user_id, folder_id, fact_key);
exception
  when others then
    raise notice 'Unique constraint change skipped: %', sqlerrm;
end $$;

-- ─── Scoped hybrid search ─────────────────────────────────────────────
-- p_folder_id      the project the conversation belongs to (null = outside)
-- p_project_only   true when that project keeps its memory to itself
create or replace function public.search_memory_facts_scoped(
  p_user_id uuid,
  p_query text,
  p_query_embedding vector(1536),
  p_limit integer default 5,
  p_mode text default null,
  p_folder_id uuid default null,
  p_project_only boolean default false
)
returns table (
  id uuid,
  fact_key text,
  fact_value text,
  mode text,
  combined_score float
)
language sql
stable
security definer
as $$
  select
    f.id,
    f.fact_key,
    f.fact_value,
    f.mode,
    (
      0.7 * (1 - (f.embedding <=> p_query_embedding)) +
      0.3 * coalesce(ts_rank(f.fts, websearch_to_tsquery('english', p_query)), 0)
    ) as combined_score
  from public.memory_facts f
  where f.user_id = p_user_id
    and (p_mode is null or f.mode = p_mode)
    and f.embedding is not null
    and (
      case
        -- Inside a project-only project: its own facts and nothing else.
        when p_project_only then f.folder_id = p_folder_id
        -- Otherwise: global facts, this project's facts, and facts from other
        -- projects EXCEPT any project that keeps its memory to itself.
        else
          f.folder_id is null
          or f.folder_id = p_folder_id
          or f.folder_id not in (
            select id from public.folders
            where user_id = p_user_id and memory_mode = 'project_only'
          )
      end
    )
  order by combined_score desc
  limit p_limit;
$$;

grant execute on function public.search_memory_facts_scoped(uuid, text, vector(1536), integer, text, uuid, boolean)
  to authenticated;
