-- Share only explicit destination fields, never house notes, costs or contacts.
create or replace function public.get_participant_trip_view(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare shared jsonb; snapshot jsonb; details jsonb; photos jsonb;
begin
 shared:=public.get_participant_trip_view_base(target_trip);
 select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
 details:=coalesce(snapshot->'trip'->'destinationDetails','{}'::jsonb);
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into photos from (
  select value,ord from jsonb_array_elements(case when jsonb_typeof(details->'photos')='array' then details->'photos' else '[]'::jsonb end) with ordinality p(value,ord)
  where jsonb_typeof(value)='string' and length(value#>>'{}')<=600000 and (value#>>'{}')~*'^(https://|data:image/(jpeg|png|webp);base64,)' order by ord limit 6
 ) allowed_photos;
 return shared||jsonb_build_object('summary',public.get_trip_financial_summary(target_trip),'personal_report',public.get_my_trip_financial_report(target_trip),
 'destination_details',jsonb_build_object('name',left(coalesce(nullif(details->>'name',''),case when jsonb_array_length(coalesce(snapshot->'houses','[]'::jsonb))=1 then snapshot->'houses'->0->>'name' end,''),150),
 'departure_time',left(coalesce(snapshot->'trip'->>'departureTime',''),5),'meeting_point',left(coalesce(snapshot->'trip'->>'departureMeetingPoint',''),300),'notes',left(coalesce(details->>'notes',''),1000),
 'address',left(coalesce(nullif(details->>'address',''),snapshot->'trip'->>'address',''),500),'photos',photos));
end $$;

CREATE OR REPLACE FUNCTION public.sync_trip_snapshot(target_trip uuid, new_payload jsonb, expected_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  next_revision bigint; group_uuid uuid; owner uuid; member_uuid uuid; participant_uuid uuid;
  member_row jsonb; person_row jsonb; existing_participant record; is_removed boolean;
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  if octet_length(new_payload::text)>5242880 then raise exception 'trip payload too large'; end if;
  if jsonb_array_length(coalesce(new_payload->'people','[]'::jsonb))>500 then raise exception 'too many participants'; end if;
  select group_id,organizer_id into group_uuid,owner from public.trips where id=target_trip;
  update public.trip_snapshots set payload=new_payload,revision=revision+1,updated_by=auth.uid(),updated_at=now()
  where trip_id=target_trip and revision=expected_revision returning revision into next_revision;
  if next_revision is null then raise exception 'sync conflict'; end if;

  for member_row in select value from jsonb_array_elements(coalesce(new_payload->'members','[]'::jsonb)) loop
    member_uuid:=null;
    select id into member_uuid from public.group_members
    where group_id=group_uuid
      and (id::text=member_row->>'id' or local_source_id=member_row->>'id')
    order by case when id::text=member_row->>'id' then 0 else 1 end
    limit 1;
    if member_uuid is null then
      insert into public.group_members(group_id,display_name,email,phone,birth_date,active,local_source_id,created_by)
      values(group_uuid,coalesce(nullif(member_row->>'name',''),'Pessoa'),nullif(lower(member_row->>'email'),''),nullif(member_row->>'phone',''),nullif(member_row->>'birthDate','')::date,coalesce((member_row->>'active')::boolean,true),member_row->>'id',owner)
      returning id into member_uuid;
    else
      update public.group_members set
        display_name=coalesce(nullif(member_row->>'name',''),'Pessoa'),
        email=nullif(lower(member_row->>'email'),''),phone=nullif(member_row->>'phone',''),
        birth_date=nullif(member_row->>'birthDate','')::date,
        active=coalesce((member_row->>'active')::boolean,true),updated_at=now()
      where id=member_uuid;
    end if;
  end loop;

  for person_row in select value from jsonb_array_elements(coalesce(new_payload->'people','[]'::jsonb)) loop
    member_uuid:=null;participant_uuid:=null;
    select id into member_uuid from public.group_members
    where group_id=group_uuid
      and (id::text=person_row->>'memberId' or local_source_id=person_row->>'memberId')
    order by case when id::text=person_row->>'memberId' then 0 else 1 end
    limit 1;
    if member_uuid is null then
      insert into public.group_members(group_id,display_name,birth_date,active,local_source_id,created_by)
      values(group_uuid,coalesce(nullif(person_row->>'name',''),'Pessoa'),nullif(person_row->>'birthDate','')::date,true,coalesce(person_row->>'memberId','participant-'||(person_row->>'id')),owner)
      returning id into member_uuid;
    end if;
    select id into participant_uuid from public.trip_participants
    where trip_id=target_trip
      and (id::text=person_row->>'id' or local_source_id=person_row->>'id' or member_id=member_uuid)
    order by case when id::text=person_row->>'id' then 0 when local_source_id=person_row->>'id' then 1 else 2 end
    limit 1;
    is_removed:=coalesce((person_row->>'removedFromTrip')::boolean,false);
    if participant_uuid is null then
      insert into public.trip_participants(trip_id,member_id,contributes,removed_at,settings,local_source_id)
      values(target_trip,member_uuid,coalesce((person_row->>'contributes')::boolean,true),case when is_removed then now() else null end,person_row,person_row->>'id')
      returning id into participant_uuid;
    else
      update public.trip_participants set member_id=member_uuid,
        contributes=coalesce((person_row->>'contributes')::boolean,true),
        removed_at=case when is_removed then coalesce(removed_at,now()) else null end,
        settings=person_row,updated_at=now()
      where id=participant_uuid;
    end if;
  end loop;

  for existing_participant in select id,member_id,local_source_id from public.trip_participants where trip_id=target_trip loop
    if not exists(
      select 1 from jsonb_array_elements(coalesce(new_payload->'people','[]'::jsonb)) p
      where (p->>'id'=existing_participant.local_source_id or p->>'id'=existing_participant.id::text)
        and not coalesce((p->>'removedFromTrip')::boolean,false)
    ) then
      update public.trip_participants set removed_at=coalesce(removed_at,now()),updated_at=now()
      where id=existing_participant.id;
      update public.trip_invites set status='cancelled'
      where participant_id=existing_participant.id and status='pending';
      delete from public.trip_access a using public.member_profile_links mpl
      where a.trip_id=target_trip and a.role in ('participant','financial_responsible')
        and mpl.member_id=existing_participant.member_id and mpl.profile_id=a.profile_id;
    end if;
  end loop;
  update public.trips set name=coalesce(nullif(btrim(new_payload->'trip'->>'name'),''),name),
    starts_on=case when new_payload->'trip' ? 'start' then nullif(new_payload->'trip'->>'start','')::date else starts_on end,
    ends_on=case when new_payload->'trip' ? 'end' then nullif(new_payload->'trip'->>'end','')::date else ends_on end,
    updated_at=now() where id=target_trip;
  return next_revision;
end;
$function$
