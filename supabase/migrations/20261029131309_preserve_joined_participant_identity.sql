CREATE OR REPLACE FUNCTION public.accept_trip_join_link(raw_token text, display_name text, phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  link public.trip_join_links%rowtype; group_uuid uuid; owner uuid;
  member_uuid uuid; participant_uuid uuid; member_local text; participant_local text;
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
  where tp.id=participant_uuid and tp.local_source_id='joined-'||auth.uid()::text and not exists(
    select 1 from public.trip_participants other
    where other.trip_id=tp.trip_id and other.id<>tp.id and other.local_source_id=participant_uuid::text
  );

  select coalesce(nullif(local_source_id,''),id::text) into member_local from public.group_members where id=member_uuid;
  select coalesce(nullif(local_source_id,''),id::text) into participant_local from public.trip_participants where id=participant_uuid;

  insert into public.trip_access(trip_id,profile_id,role,granted_by)
  values(link.trip_id,auth.uid(),'participant',link.created_by) on conflict do nothing;

  perform 1 from public.trip_snapshots where trip_id=link.trip_id for update;
  update public.trip_snapshots set payload=jsonb_set(
    jsonb_set(
      payload,'{members}',
      (select coalesce(jsonb_agg(value),'[]'::jsonb)
       from jsonb_array_elements(coalesce(payload->'members','[]'::jsonb)) as item(value)
       where value->>'id' not in (member_uuid::text,member_local))
      ||jsonb_build_array(jsonb_build_object(
        'id',member_local,'groupId',coalesce(payload->'group'->>'id',group_uuid::text),'name',clean_name,
        'phone',clean_phone,'active',true
      ))
    ),
    '{people}',
    (select coalesce(jsonb_agg(value),'[]'::jsonb)
     from jsonb_array_elements(coalesce(payload->'people','[]'::jsonb)) as item(value)
     where value->>'id' not in (participant_uuid::text,participant_local))
    ||jsonb_build_array(jsonb_build_object(
      'id',participant_local,'memberId',member_local,
      'trip',payload->'trip'->>'id','name',clean_name,'phone',clean_phone,
      'participantType','adult','contributes',true,
      'contributionStatus','configured','joinedByLink',true
    ))
  ),revision=revision+1,updated_by=auth.uid(),updated_at=now()
  where trip_id=link.trip_id;

  return jsonb_build_object('trip_id',link.trip_id,'role','participant');
end;
$function$
