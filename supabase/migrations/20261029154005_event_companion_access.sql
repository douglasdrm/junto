create function public.get_event_companions(target_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare enabled boolean; s public.event_companion_settings; organizer boolean;
begin
 if auth.uid() is null or not public.can_access_trip(target_trip) then raise exception 'access denied';end if;
 select event_type='celebration' into enabled from public.trips where id=target_trip;
 organizer:=public.is_trip_organizer(target_trip);
 select * into s from public.event_companion_settings where trip_id=target_trip;
 return jsonb_build_object('enabled',coalesce(enabled,false),'organizer',organizer,
 'can_manage',public.can_submit_trip_purchase(target_trip),'allowed',coalesce(s.allowed,true),
 'limit',coalesce(s.per_person_limit,20),'revision',coalesce(s.revision,1),
 'participant_names',coalesce((select jsonb_agg(gm.display_name) from public.trip_participants tp join public.group_members gm on gm.id=tp.member_id where tp.trip_id=target_trip and tp.removed_at is null),'[]'::jsonb),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'revision',c.revision,
 'own',c.responsible_id=auth.uid(),'responsible_name',coalesce(p.display_name,'Participante')) order by c.created_at,c.id)
 from public.event_companions c join public.profiles p on p.id=c.responsible_id where c.trip_id=target_trip),'[]'::jsonb));
end $$;

create function public.change_event_companions(target_trip uuid, action text, body jsonb, expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.event_companion_settings; c public.event_companions; organizer boolean; rid uuid; n text;
begin
 if auth.uid() is null or not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied';end if;
 if not exists(select 1 from public.trips where id=target_trip and event_type='celebration') then raise exception 'events only';end if;
 organizer:=public.is_trip_organizer(target_trip);
 insert into public.event_companion_settings(trip_id) values(target_trip) on conflict do nothing;
 select * into s from public.event_companion_settings where trip_id=target_trip for update;
 if action='settings' then
  if not organizer then raise exception 'access denied';end if;
  if expected_revision is distinct from s.revision then raise exception 'companions changed';end if;
  update public.event_companion_settings set allowed=(body->>'allowed')::boolean,per_person_limit=(body->>'limit')::integer,revision=revision+1 where trip_id=target_trip;
 elsif action in ('save','remove') then
  if nullif(body->>'id','') is not null then
   select * into c from public.event_companions where id=(body->>'id')::uuid and trip_id=target_trip for update;
   if c.id is null or not (organizer or c.responsible_id=auth.uid()) then raise exception 'access denied';end if;
   if expected_revision is distinct from c.revision then raise exception 'companions changed';end if;
  elsif action='remove' then raise exception 'access denied';
  end if;
  if action='remove' then
   if exists(select 1 from public.event_potluck_claims where companion_id=c.id) then raise exception 'companion has dishes';end if;
   delete from public.event_companions where id=c.id;
  else
   n:=btrim(body->>'name');
   if c.id is null then
    if not s.allowed then raise exception 'companions disabled';end if;
    -- New records belong to the caller, even when an arbitrary account is supplied.
    rid:=auth.uid();
    if (select count(*) from public.event_companions where trip_id=target_trip and responsible_id=rid)>=s.per_person_limit then raise exception 'companion limit';end if;
    insert into public.event_companions(trip_id,responsible_id,name,kind) values(target_trip,rid,n,body->>'kind');
   else
    update public.event_companions set name=n,kind=body->>'kind',revision=revision+1 where id=c.id;
    update public.event_potluck_claims set label=n where companion_id=c.id;
   end if;
  end if;
 else raise exception 'unknown action';end if;
 return public.get_event_companions(target_trip);
end $$;


revoke all on function public.get_event_companions(uuid),public.change_event_companions(uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.get_event_companions(uuid),public.change_event_companions(uuid,text,jsonb,bigint) to authenticated;
