-- Palmkit: Internal hosting — deploy and serve apps from Palmkit itself.
--
-- Creates:
--   1. public.deployments table — metadata for each deployed app
--   2. storage bucket 'deployments' (public) — stores the self-contained HTML
--
-- Flow:
--   User clicks "Deploy to Palmkit"
--   → POST /api/deploy/internal (auth required)
--   → Server builds self-contained HTML (inlined CSS/JS)
--   → Stores HTML at: deployments/{userId}/{urlSlug}.html
--   → Inserts row in deployments table
--   → Returns { url: '/p/{urlSlug}' }
--
--   Public visits /p/{urlSlug} (no auth needed)
--   → Remix loader reads from deployments table (public read)
--   → Fetches HTML from Supabase Storage (public bucket)
--   → Returns text/html

-- ─── Deployments table ────────────────────────────────────────────────────

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url_slug text not null unique,
  title text,
  framework text,
  storage_path text not null,
  file_count integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deployments_user_idx on public.deployments (user_id, created_at desc);
create index if not exists deployments_slug_idx on public.deployments (url_slug);

alter table public.deployments enable row level security;

-- Public can read deployment metadata (needed for /p/$slug route)
drop policy if exists "deployments_public_read" on public.deployments;
create policy "deployments_public_read" on public.deployments
  for select using (true);

-- Only owner can insert
drop policy if exists "deployments_insert_own" on public.deployments;
create policy "deployments_insert_own" on public.deployments
  for insert with check (auth.uid() = user_id);

-- Only owner can update
drop policy if exists "deployments_update_own" on public.deployments;
create policy "deployments_update_own" on public.deployments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Only owner can delete
drop policy if exists "deployments_delete_own" on public.deployments;
create policy "deployments_delete_own" on public.deployments
  for delete using (auth.uid() = user_id);

-- ─── Storage bucket (public reads) ────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('deployments', 'deployments', true)
on conflict (id) do nothing;

-- Public read on deployment files (anyone can view deployed apps)
drop policy if exists "deployments_storage_public_read" on storage.objects;
create policy "deployments_storage_public_read" on storage.objects
  for select using (bucket_id = 'deployments');

-- Only owner can upload (folder name = user_id)
drop policy if exists "deployments_storage_insert_own" on storage.objects;
create policy "deployments_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'deployments' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Only owner can update
drop policy if exists "deployments_storage_update_own" on storage.objects;
create policy "deployments_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'deployments' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Only owner can delete
drop policy if exists "deployments_storage_delete_own" on storage.objects;
create policy "deployments_storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'deployments' and (storage.foldername(name))[1] = auth.uid()::text
  );
