begin;

-- Aceita tanto o identificador local antigo quanto o UUID já gravado no snapshot.
-- Nenhum registro existente é renomeado ou excluído.
create or replace function public.sync_trip_snapshot(target_trip uuid, new_payload jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
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
  return next_revision;
end;
$$;

create or replace function public.accept_trip_join_link(raw_token text, display_name text, phone text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  link public.trip_join_links%rowtype; group_uuid uuid; owner uuid;
  member_uuid uuid; participant_uuid uuid;
  clean_name text:=trim(display_name); clean_phone text:=nullif(trim(phone),'');
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if char_length(clean_name)<2 or char_length(clean_name)>100 then raise exception 'valid name required'; end if;
  select * into link from public.trip_join_links
  where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex')
    and active and (expires_at is null or expires_at>now()) for update;
  if link.id is null then raise exception 'invalid join link'; end if;
  if exists(select 1 from public.trip_access_revocations where trip_id=link.trip_id and profile_id=auth.uid()) then
    raise exception 'access revoked by organizer';
  end if;
  if exists(select 1 from public.trip_access where trip_id=link.trip_id and profile_id=auth.uid() and role='participant') then
    return jsonb_build_object('trip_id',link.trip_id,'role','participant');
  end if;

  select group_id,organizer_id into group_uuid,owner from public.trips where id=link.trip_id;
  select gm.id into member_uuid from public.group_members gm
  join public.member_profile_links mpl on mpl.member_id=gm.id
  where gm.group_id=group_uuid and mpl.profile_id=auth.uid() and mpl.status='active' limit 1;

  if member_uuid is null then
    insert into public.group_members(group_id,display_name,phone,active,local_source_id,created_by)
    values(group_uuid,clean_name,clean_phone,true,'joined-'||auth.uid()::text,owner)
    returning id into member_uuid;
    update public.group_members gm set local_source_id=member_uuid::text
    where gm.id=member_uuid and not exists(
      select 1 from public.group_members other
      where other.group_id=gm.group_id and other.id<>gm.id and other.local_source_id=member_uuid::text
    );
    insert into public.member_profile_links(member_id,profile_id,status,authorized_by,linked_at)
    values(member_uuid,auth.uid(),'active',link.created_by,now());
  else
    update public.group_members
    set display_name=clean_name,phone=clean_phone,updated_at=now()
    where id=member_uuid;
  end if;

  insert into public.trip_participants(trip_id,member_id,contributes,settings,local_source_id)
  values(link.trip_id,member_uuid,true,jsonb_build_object(
    'name',clean_name,'phone',clean_phone,'contributes',true,
    'contributionStatus','configured','joinedByLink',true
  ),'joined-'||auth.uid()::text)
  on conflict(trip_id,member_id) do update
    set contributes=true,removed_at=null,settings=excluded.settings,updated_at=now()
  returning id into participant_uuid;

  update public.trip_participants tp
  set local_source_id=participant_uuid::text,updated_at=now()
  where tp.id=participant_uuid and not exists(
    select 1 from public.trip_participants other
    where other.trip_id=tp.trip_id and other.id<>tp.id and other.local_source_id=participant_uuid::text
  );

  insert into public.trip_access(trip_id,profile_id,role,granted_by)
  values(link.trip_id,auth.uid(),'participant',link.created_by) on conflict do nothing;

  perform 1 from public.trip_snapshots where trip_id=link.trip_id for update;
  update public.trip_snapshots set payload=jsonb_set(
    jsonb_set(
      payload,'{members}',
      (select coalesce(jsonb_agg(value),'[]'::jsonb)
       from jsonb_array_elements(coalesce(payload->'members','[]'::jsonb)) as item(value)
       where value->>'id'<>member_uuid::text)
      ||jsonb_build_array(jsonb_build_object(
        'id',member_uuid::text,'groupId',group_uuid::text,'name',clean_name,
        'phone',clean_phone,'active',true
      ))
    ),
    '{people}',
    (select coalesce(jsonb_agg(value),'[]'::jsonb)
     from jsonb_array_elements(coalesce(payload->'people','[]'::jsonb)) as item(value)
     where value->>'id'<>participant_uuid::text)
    ||jsonb_build_array(jsonb_build_object(
      'id',participant_uuid::text,'memberId',member_uuid::text,
      'trip',payload->'trip'->>'id','name',clean_name,'phone',clean_phone,
      'participantType','adult','contributes',true,
      'contributionStatus','configured','joinedByLink',true
    ))
  ),revision=revision+1,updated_by=auth.uid(),updated_at=now()
  where trip_id=link.trip_id;

  return jsonb_build_object('trip_id',link.trip_id,'role','participant');
end;
$$;

create or replace function public.participant_invites_schema_version()
returns integer language sql stable security definer set search_path='' as $$ select 4 $$;

revoke all on function public.accept_trip_join_link(text,text,text),
  public.participant_invites_schema_version() from public;
grant execute on function public.accept_trip_join_link(text,text,text),
  public.participant_invites_schema_version() to authenticated;

commit;
