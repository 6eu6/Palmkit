-- Palmkit: move large file snapshots out of the projects row into Storage.
-- Snapshots are stored at  project-snapshots/<user_id>/<url_id>.json  and the
-- projects.snapshot JSONB column is left null for offloaded snapshots.

insert into storage.buckets (id, name, public)
values ('project-snapshots', 'project-snapshots', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled; scope access to the user's own folder
-- (first path segment must equal their auth.uid()).
drop policy if exists "snapshots_select_own" on storage.objects;
create policy "snapshots_select_own" on storage.objects
  for select using (
    bucket_id = 'project-snapshots' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "snapshots_insert_own" on storage.objects;
create policy "snapshots_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'project-snapshots' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "snapshots_update_own" on storage.objects;
create policy "snapshots_update_own" on storage.objects
  for update using (
    bucket_id = 'project-snapshots' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "snapshots_delete_own" on storage.objects;
create policy "snapshots_delete_own" on storage.objects
  for delete using (
    bucket_id = 'project-snapshots' and (storage.foldername(name))[1] = auth.uid()::text
  );
