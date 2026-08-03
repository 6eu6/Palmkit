-- Migration 0020: one key per provider, not one key per user
--
-- `user_api_keys` was keyed on user_id alone, so a user could hold exactly one
-- key in total. Adding an Anthropic key meant destroying the OpenRouter one.
-- The primary key becomes (user_id, provider), so keys sit side by side and
-- switching between them is a flag rather than a re-entry.
--
-- Two supporting columns:
--
--   is_active  which provider requests go to. Exactly one per user, enforced
--              by a partial unique index rather than by hoping the application
--              remembers — two active keys is a state with no correct answer.
--
--   key_hint   the last four characters, stored in the clear ON PURPOSE. It is
--              what lets the UI show "sk-…4f2a" so a user can tell two keys
--              apart, which is the only legitimate reason the old `reveal=1`
--              endpoint existed. Four characters identify a key to the person
--              who owns it and are useless to anyone else, so the plaintext
--              key never has to leave the server again.

alter table public.user_api_keys
  add column if not exists is_active boolean not null default true;

alter table public.user_api_keys
  add column if not exists key_hint text;

-- Swap the primary key from (user_id) to (user_id, provider).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_api_keys'::regclass
      and contype = 'p'
      and conname = 'user_api_keys_pkey'
  ) then
    alter table public.user_api_keys drop constraint user_api_keys_pkey;
  end if;
end $$;

alter table public.user_api_keys
  add constraint user_api_keys_pkey primary key (user_id, provider);

-- At most one active provider per user. Partial, so inactive rows are free to
-- pile up — that is the whole point of keeping them.
drop index if exists user_api_keys_one_active;
create unique index user_api_keys_one_active
  on public.user_api_keys (user_id)
  where is_active;

-- Existing rows predate the flag; each user has exactly one, so it is active.
update public.user_api_keys set is_active = true where is_active is null;
