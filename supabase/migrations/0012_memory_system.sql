-- Migration 0012: Memory system — 3-tier architecture
--
-- Layer 1: user_memory (profile, ≤500 tokens, no embeddings, injected fully)
-- Layer 3: memory_facts (cross-tab facts with embeddings, hybrid search)
--
-- Layer 0 (PALMKIT.md) is stored as a project file — no table needed.
-- Layer 2 (conversation short-term) is handled by useChat — no table needed.

-- ─── Enable pgvector ───────────────────────────────────────────
create extension if not exists vector;

-- ─── Layer 1: user_memory ──────────────────────────────────────
-- Stores the user's persistent profile as plain text lines.
-- Injected in full on every request (≤500 tokens, cache-friendly).
-- Updated asynchronously by the extraction service (ADD/UPDATE/DELETE ops).

create table if not exists public.user_memory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  content text not null default '',
  line_count integer not null default 0,
  max_lines integer not null default 40,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.user_memory enable row level security;

drop policy if exists "user_memory_select_own" on public.user_memory;
create policy "user_memory_select_own" on public.user_memory
  for select using (auth.uid() = user_id);

drop policy if exists "user_memory_insert_own" on public.user_memory;
create policy "user_memory_insert_own" on public.user_memory
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_memory_update_own" on public.user_memory;
create policy "user_memory_update_own" on public.user_memory
  for update using (auth.uid() = user_id);

drop policy if exists "user_memory_delete_own" on public.user_memory;
create policy "user_memory_delete_own" on public.user_memory
  for delete using (auth.uid() = user_id);

-- ─── Layer 3: memory_facts ────────────────────────────────────
-- Stores cross-tab facts as key=value pairs with vector embeddings.
-- Hybrid search: pgvector (semantic) + BM25 (keyword) for precise retrieval.
-- Each fact belongs to a conversation, but is searchable across all tabs.

create table if not exists public.memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fact_key text not null,
  fact_value text not null,
  -- The mode (chat/work/code) where this fact was extracted
  mode text not null default 'chat' check (mode in ('chat', 'work', 'code')),
  -- The conversation ID where this fact originated
  conversation_id text,
  -- Vector embedding for semantic search (1536 dims for text-embedding models)
  embedding vector(1536),
  -- Full-text search vector for BM25 keyword matching
  fts tsvector generated always as (
    to_tsvector('english', coalesce(fact_key, '') || ' ' || coalesce(fact_value, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One fact per key per user (UPDATE replaces, doesn't duplicate)
  unique (user_id, fact_key)
);

alter table public.memory_facts enable row level security;

drop policy if exists "memory_facts_select_own" on public.memory_facts;
create policy "memory_facts_select_own" on public.memory_facts
  for select using (auth.uid() = user_id);

drop policy if exists "memory_facts_insert_own" on public.memory_facts;
create policy "memory_facts_insert_own" on public.memory_facts
  for insert with check (auth.uid() = user_id);

drop policy if exists "memory_facts_update_own" on public.memory_facts;
create policy "memory_facts_update_own" on public.memory_facts
  for update using (auth.uid() = user_id);

drop policy if exists "memory_facts_delete_own" on public.memory_facts;
create policy "memory_facts_delete_own" on public.memory_facts
  for delete using (auth.uid() = user_id);

-- Index for vector similarity search (cosine distance)
create index if not exists memory_facts_embedding_idx
  on public.memory_facts using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Index for BM25 full-text search
create index if not exists memory_facts_fts_idx
  on public.memory_facts using gin (fts);

-- Index for filtering by user
create index if not exists memory_facts_user_idx
  on public.memory_facts (user_id, fact_key);

-- Index for filtering by user + mode
create index if not exists memory_facts_user_mode_idx
  on public.memory_facts (user_id, mode, updated_at desc);

-- ─── Helper function: hybrid search ────────────────────────────
-- Combines vector similarity (semantic) + BM25 (keyword) for best retrieval.
-- Returns top-K facts ranked by combined score.

create or replace function public.search_memory_facts(
  p_user_id uuid,
  p_query text,
  p_query_embedding vector(1536),
  p_limit integer default 5,
  p_mode text default null
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
    -- Combined score: 70% semantic + 30% keyword
    (
      0.7 * (1 - (f.embedding <=> p_query_embedding)) +
      0.3 * coalesce(ts_rank(f.fts, websearch_to_tsquery('english', p_query)), 0)
    ) as combined_score
  from public.memory_facts f
  where f.user_id = p_user_id
    and (p_mode is null or f.mode = p_mode)
    and f.embedding is not null
  order by combined_score desc
  limit p_limit;
$$;

-- Grant execute to authenticated users
grant execute on function public.search_memory_facts(uuid, text, vector(1536), integer, text) to authenticated;
