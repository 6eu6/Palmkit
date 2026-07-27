-- Migration 0010: Add chat_id to build_jobs
--
-- The chat ID (from IndexedDB) is a timestamp string like "1782788399906".
-- The existing project_id column is a UUID referencing the projects table,
-- which is incompatible. We add a new chat_id column (text) to link
-- build_jobs directly to IndexedDB chats.
--
-- This allows /api/workspace to verify ownership by checking:
--   SELECT 1 FROM build_jobs WHERE chat_id = ? AND user_id = ?
--
-- It also allows the worker to key workspace files under:
--   projects/{chat_id}/workspace/{path}

alter table public.build_jobs
  add column if not exists chat_id text;

-- Index for fast lookup by chat_id + user_id
create index if not exists build_jobs_chat_id_idx on public.build_jobs (chat_id);

-- RLS policy: users can read their own build_jobs by chat_id
-- (existing policies already cover this via user_id)

comment on column public.build_jobs.chat_id is
  'The chat ID from IndexedDB (timestamp string). Links the build job to the chat session, enabling workspace file restore on page reload.';
