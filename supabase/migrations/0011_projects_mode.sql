-- Migration 0011: Add mode column to projects for Chat/Work/Code tabs
--
-- Each conversation now belongs to one of three workspace modes:
--   - 'chat': general Q&A, no file generation, no preview
--   - 'work': document/media generation (PDF, Word, Excel, images, videos)
--   - 'code': full app building with artifacts and preview (default)
--
-- The sidebar filters conversations by mode so each tab shows only its own
-- chats. Existing conversations default to 'code' for backward compatibility.

-- Add the mode column with a safe default
alter table public.projects
  add column if not exists mode text not null default 'code';

-- Add a CHECK constraint to ensure only valid modes
do $$
begin
  -- Drop the constraint if it already exists (idempotent)
  alter table public.projects drop constraint if exists projects_mode_check;
  -- Add the new constraint
  alter table public.projects
    add constraint projects_mode_check
    check (mode in ('chat', 'work', 'code'));
exception
  when others then
    raise notice 'Constraint creation skipped: %', sqlerrm;
end $$;

-- Create an index for filtering by user + mode (the sidebar's main query)
create index if not exists projects_user_mode_idx
  on public.projects (user_id, mode, updated_at desc);

-- Update the select policy to also allow filtering by mode
-- (existing policy already allows select by user_id, no change needed)
