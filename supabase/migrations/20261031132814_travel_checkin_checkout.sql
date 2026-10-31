-- The existing authorized projection runs first; append only validated stay times.
alter function public.get_participant_trip_view(uuid) rename to get_participant_trip_view_before_stay_times;
revoke all on function public.get_participant_trip_view_before_stay_times(uuid) from public,anon,authenticated;
create function public.get_participant_trip_view(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; details jsonb; allowed jsonb:='{}'; key text; value text;
begin
 result:=public.get_participant_trip_view_before_stay_times(target_trip);
 select s.payload->'trip'->'destinationDetails' into details from public.trip_snapshots s where s.trip_id=target_trip;
 foreach key in array array['check_in','check_out'] loop
  value:=details->>key;
  if value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then allowed:=allowed||jsonb_build_object(key,value);end if;
 end loop;
 return jsonb_set(result,'{destination_details}',coalesce(result->'destination_details','{}')||allowed);
end $$;
revoke all on function public.get_participant_trip_view(uuid) from public,anon;
grant execute on function public.get_participant_trip_view(uuid) to authenticated;
