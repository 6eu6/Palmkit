-- Migration 0022: somewhere to put generated images and video
--
-- `generate_image` returned the whole picture as a base64 data URL inside its
-- tool result. That result goes two places: to the browser, which needs the
-- pixels, and back into the model's context, which does not. A 673KB JPEG is
-- roughly 224,000 tokens of base64 against a 204,800 context, so asking for
-- an image and then a video made from it stopped silently after the image —
-- the second turn could not fit.
--
-- The same data URL was also written into the conversation, so every reload
-- of that chat carried a megabyte of base64 that nothing needed.
--
-- So generated media goes to storage and the tool result carries a short URL.
-- The model reads a link, the browser follows it, and neither has to move a
-- megabyte to do it.
--
-- Video has a second reason to live here: OpenRouter's video URL requires the
-- API key as a bearer token, so the browser cannot fetch it. Storing a copy
-- is what makes the result playable at all.

insert into storage.buckets (id, name, public)
values ('generated-media', 'generated-media', false)
on conflict (id) do nothing;

-- Same shape as project-snapshots: everything under <user_id>/ is that user's,
-- and RLS on storage.objects makes the folder name the boundary.
drop policy if exists "generated_media_select_own" on storage.objects;
create policy "generated_media_select_own" on storage.objects
  for select using (
    bucket_id = 'generated-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_media_insert_own" on storage.objects;
create policy "generated_media_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'generated-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_media_update_own" on storage.objects;
create policy "generated_media_update_own" on storage.objects
  for update using (
    bucket_id = 'generated-media' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "generated_media_delete_own" on storage.objects;
create policy "generated_media_delete_own" on storage.objects
  for delete using (
    bucket_id = 'generated-media' and (storage.foldername(name))[1] = auth.uid()::text
  );
