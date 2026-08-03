-- Migration 0019: let the catalog actually be written
--
-- 0018 created a read policy and left the write to "the service role", but the
-- app has no service-role client — every route runs as the signed-in user. So
-- resolution worked and persistence silently did not: 337 models established
-- on every single request, cached none of them, and each user paid the round
-- trip that one of them should have paid once.
--
-- The trade-off, stated plainly: any signed-in user can write capability rows
-- that every user then reads. That is acceptable here because the table holds
-- no private data — it is public knowledge about public models, and the worst
-- a bad row can do is show a wrong badge or pick a poor default. It can never
-- expose anything or reach another user's data, which is what RLS is actually
-- guarding.
--
-- The WITH CHECK does the work that is worth doing: it refuses rows that claim
-- to be established when they are not. `heuristic` is a guess from a model's
-- name, and the resolver deliberately never writes one — this makes that a
-- database rule rather than a convention, so a guess can never masquerade as a
-- fact in the shared catalog.

drop policy if exists "model_catalog_insert" on public.model_catalog;
create policy "model_catalog_insert" on public.model_catalog
  for insert to authenticated
  with check (
    source in ('provider-api', 'probe', 'catalog')
    and confidence >= 0
    and confidence <= 1
  );

drop policy if exists "model_catalog_update" on public.model_catalog;
create policy "model_catalog_update" on public.model_catalog
  for update to authenticated
  using (true)
  with check (
    source in ('provider-api', 'probe', 'catalog')
    and confidence >= 0
    and confidence <= 1
  );
