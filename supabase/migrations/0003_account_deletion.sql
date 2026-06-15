-- Palmkit account deletion (GDPR)
-- Lets a signed-in user delete their own auth account. Because profiles,
-- user_api_keys and projects all reference auth.users ON DELETE CASCADE,
-- removing the auth.users row wipes all of the user's data.
--
-- SECURITY DEFINER lets the function delete from auth.users on behalf of the
-- caller without exposing the service_role key. It only ever deletes the row
-- matching auth.uid(), so a user can only delete themselves.

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;
