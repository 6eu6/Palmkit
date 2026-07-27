-- Palmkit auth foundation
-- Run this in the Supabase SQL editor (or via `supabase db push` / MCP apply).
-- Creates user profiles and encrypted-API-key storage with Row Level Security.

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles: one row per auth user, auto-created on sign up.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  username text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Create a profile automatically whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- user_api_keys: encrypted model-provider API key, one row per user.
-- The value is AES-GCM encrypted by the app server before it ever reaches the
-- database; this table only ever holds ciphertext.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_api_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null default 'OpenRouter',
  encrypted_key text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_api_keys enable row level security;

drop policy if exists "api_keys_select_own" on public.user_api_keys;
create policy "api_keys_select_own" on public.user_api_keys
  for select using (auth.uid() = user_id);

drop policy if exists "api_keys_insert_own" on public.user_api_keys;
create policy "api_keys_insert_own" on public.user_api_keys
  for insert with check (auth.uid() = user_id);

drop policy if exists "api_keys_update_own" on public.user_api_keys;
create policy "api_keys_update_own" on public.user_api_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "api_keys_delete_own" on public.user_api_keys;
create policy "api_keys_delete_own" on public.user_api_keys
  for delete using (auth.uid() = user_id);
