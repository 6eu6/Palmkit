-- Migration 0023: let the browser watch a job as it happens
--
-- Generation cannot live on Cloudflare. The platform kills the request for
-- exceeding its resource budget — Error 1102, read off the error page a
-- failing run returns — and how often it happens tracks how much JavaScript
-- touches each chunk of the model's stream:
--
--   relay the provider's body untouched   no JS per chunk   11 of 11 complete
--   an identity transform                 trivial            3 of 7
--   parse each frame                      small              2 of 9
--   the chat route's SDK pipeline         most               ~none
--
-- A body handed straight on never enters the isolate, which is the only shape
-- that always survives. But speaking the AI SDK's protocol means reading those
-- bytes in JavaScript, so the chat route can never be that shape. Routing the
-- work through Cloudflare to the worker would inherit the same ceiling for
-- nothing, since the worker is not on Cloudflare.
--
-- The worker already avoids the problem entirely: it is not exposed to the
-- internet at all — no tunnel, no public port — and takes its work from
-- Supabase, writing progress back to job_events. That is the path a chat turn
-- should take too, and it needs no new table: build_jobs carries the turn and
-- job_events carries what the model produces.
--
-- What is missing is only that the browser cannot watch either table change.
-- Realtime publishes a fixed set of tables, and these two are not in it, so a
-- client can read a job but not be told when it moves. Adding them is what
-- turns polling into a stream — and it makes the result durable as a side
-- effect: the events are rows, so a dropped connection, a locked phone or a
-- closed tab resumes by reading them rather than losing the turn.
--
-- Idempotent: adding a table already in the publication is an error, so each
-- one is checked first. Safe to run more than once.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'job_events'
  ) then
    alter publication supabase_realtime add table public.job_events;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'build_jobs'
  ) then
    alter publication supabase_realtime add table public.build_jobs;
  end if;
end $$;

-- An update to build_jobs must carry enough of the old row for Realtime to
-- match it against a subscription filter. The default identity is the primary
-- key only, which is enough to identify the row but not to tell a subscriber
-- filtering on user_id that the change is theirs.
alter table public.build_jobs replica identity full;

comment on table public.job_events is
  'Fine-grained progress events for build jobs. Written by the external worker (service role), read by the frontend (RLS-scoped to own jobs), and published to Realtime so a turn can be watched live and resumed after a disconnect.';
