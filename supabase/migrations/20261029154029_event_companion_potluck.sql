alter function public.get_event_potluck(uuid) rename to get_event_potluck_without_companions;
revoke all on function public.get_event_potluck_without_companions(uuid) from public,anon,authenticated;
create function public.get_event_potluck(target_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.get_event_potluck_without_companions(target_trip);
 result:=result||jsonb_build_object('companions',public.get_event_companions(target_trip));
 -- Only extend the authorized public claims projection; never return profile IDs.
 result:=jsonb_set(result,'{items}',coalesce((select jsonb_agg(i||jsonb_build_object('claims',coalesce((select jsonb_agg(c||jsonb_build_object('companion_id',(select companion_id from public.event_potluck_claims where id=(c->>'id')::uuid))) from jsonb_array_elements(i->'claims') c),'[]'::jsonb))) from jsonb_array_elements(result->'items') i),'[]'::jsonb));
 return result;
end $$;

alter function public.change_event_potluck(uuid,text,jsonb,bigint) rename to change_event_potluck_without_companions;
revoke all on function public.change_event_potluck_without_companions(uuid,text,jsonb,bigint) from public,anon,authenticated;
create function public.change_event_potluck(target_trip uuid,action text,body jsonb,expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.event_companions; result jsonb; selected_item uuid; previous_items uuid[];
begin
 if auth.uid() is null or not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_trip::text,7214));
 if action='extra' then select coalesce(array_agg(id),'{}'::uuid[]) into previous_items from public.event_potluck_items where trip_id=target_trip;end if;
 if action in ('claim','extra') then
  if nullif(body->>'companion_id','') is not null then
   select * into c from public.event_companions where id=(body->>'companion_id')::uuid and trip_id=target_trip for update;
   if c.id is null or not (c.responsible_id=auth.uid() or public.is_trip_organizer(target_trip)) then raise exception 'access denied';end if;
   body:=body||jsonb_build_object('scope','person','label',c.name);
  end if;
 end if;
 result:=public.change_event_potluck_without_companions(target_trip,action,body,expected_revision);
 if action in ('claim','extra') then
  if action='claim' then selected_item:=(body->>'item_id')::uuid;
  else select id into selected_item from public.event_potluck_items where trip_id=target_trip and created_by=auth.uid() and not from_list and not (id=any(previous_items)) limit 1;end if;
  update public.event_potluck_claims set companion_id=c.id where item_id=selected_item and profile_id=auth.uid();
 end if;
 return public.get_event_potluck(target_trip);
end $$;
revoke all on function public.get_event_companions(uuid),public.change_event_companions(uuid,text,jsonb,bigint),public.get_event_potluck(uuid),public.change_event_potluck(uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.get_event_companions(uuid),public.change_event_companions(uuid,text,jsonb,bigint),public.get_event_potluck(uuid),public.change_event_potluck(uuid,text,jsonb,bigint) to authenticated;
