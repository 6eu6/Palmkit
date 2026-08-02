-- Migration 0014: Add pinned column to projects
--
-- A pinned conversation sorts above everything else in its tab's list.
--
-- One boolean is enough to make pinning per-tab: a conversation belongs to
-- exactly one mode (see 0011), so it only ever appears in that one tab's
-- list. Pinning a conversation in Chat cannot surface it under Work or Code.
--
-- Existing conversations default to not pinned.

alter table public.projects
  add column if not exists pinned boolean not null default false;

-- The sidebar's list query is "this user, this mode, pinned first, newest
-- first". Extending the 0011 index with `pinned` lets that come straight off
-- the index instead of sorting the whole result set.
drop index if exists projects_user_mode_idx;

create index if not exists projects_user_mode_pinned_idx
  on public.projects (user_id, mode, pinned desc, updated_at desc);
