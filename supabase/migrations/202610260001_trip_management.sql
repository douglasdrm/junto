begin;

create or replace function public.delete_owned_trip(target_trip uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not exists(select 1 from public.trips where id=target_trip and organizer_id=auth.uid()) then
    raise exception 'only the trip owner can delete it';
  end if;
  delete from public.trips where id=target_trip and organizer_id=auth.uid();
end;
$$;

revoke all on function public.delete_owned_trip(uuid) from public;
grant execute on function public.delete_owned_trip(uuid) to authenticated;

commit;
