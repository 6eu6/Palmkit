-- Migration 0017: project instructions
--
-- Free text the user writes once per project, describing what the project is
-- and how the model should behave inside it. It is injected alongside the
-- memory block on every request made from a conversation in that project, so
-- every new chat in the project starts already knowing the brief instead of
-- being told again each time.

alter table public.folders
  add column if not exists instructions text;
