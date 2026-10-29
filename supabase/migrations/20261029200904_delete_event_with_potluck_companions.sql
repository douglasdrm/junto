-- Delete item responsibilities before the event's companion cascade runs.
-- Individual companion removal remains protected by ON DELETE RESTRICT.
create or replace function public.delete_owned_trip(target_trip uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 perform 1 from public.trips where id=target_trip and organizer_id=auth.uid() for update;
 if not found then raise exception 'only the trip owner can delete this planning';end if;
 delete from public.event_potluck_settings where trip_id=target_trip;
 delete from public.trips where id=target_trip and organizer_id=auth.uid();
end $$;
revoke all on function public.delete_owned_trip(uuid) from public,anon;
grant execute on function public.delete_owned_trip(uuid) to authenticated;
