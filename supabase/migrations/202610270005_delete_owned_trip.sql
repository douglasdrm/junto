begin;

create or replace function public.delete_owned_trip(target_trip uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  deleted_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  delete from public.trips
  where id=target_trip and organizer_id=auth.uid();

  get diagnostics deleted_count = row_count;
  if deleted_count=0 then
    raise exception 'only the trip owner can delete this planning';
  end if;
end;
$$;

revoke all on function public.delete_owned_trip(uuid) from public;
grant execute on function public.delete_owned_trip(uuid) to authenticated;

commit;
