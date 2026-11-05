-- Execute the complete file in the Supabase SQL Editor, once.
-- Requires permanent_event_invitations and reinvitation_after_removal_and_preview_card already applied.
begin;
-- Removed participants may retain a trip_access row; it is not active permission while a revocation exists.
CREATE OR REPLACE FUNCTION public.accept_registered_join_link_id(target_link uuid, display_name text, phone text DEFAULT NULL::text)
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
  if not exists(select 1 from auth.users where id=auth.uid() and not is_anonymous and confirmed_at is not null) then raise exception 'registered account required'; end if;
  if clean_name is null or char_length(clean_name)<2 or char_length(clean_name)>100 then raise exception 'valid name required'; end if;
  select * into link from public.trip_join_links
  where id=target_link
    and active and (expires_at is null or expires_at>now()) for update;
  if link.id is null then raise exception 'invalid join link'; end if;
  if exists(select 1 from public.trip_access_revocations where trip_id=link.trip_id and profile_id=auth.uid() and not(reason='participant_removed' and revoked_at<link.created_at)) then
    raise exception 'access revoked by organizer';
  end if;
  if exists(select 1 from public.trip_access where trip_id=link.trip_id and profile_id=auth.uid() and not exists(select 1 from public.trip_access_revocations r where r.trip_id=link.trip_id and r.profile_id=auth.uid())) then
    return jsonb_build_object('trip_id',link.trip_id,'role','participant');
  end if;

  -- Only a new organizer-issued link can restore a previously removed participant.
  delete from public.trip_access_revocations where trip_id=link.trip_id and profile_id=auth.uid() and reason='participant_removed' and revoked_at<link.created_at;

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
    set display_name=clean_name,phone=clean_phone,active=true,updated_at=now()
    where id=member_uuid;
  end if;

  insert into public.trip_participants(trip_id,member_id,contributes,settings,local_source_id)
  values(link.trip_id,member_uuid,true,jsonb_build_object(
    'name',clean_name,'phone',clean_phone,'contributes',true,
    'contributionStatus','configured','joinedByLink',true
  ),'joined-'||auth.uid()::text)
  on conflict(trip_id,member_id) do update
    set removed_at=null,updated_at=now()
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
      ) || coalesce((select value from jsonb_array_elements(coalesce(payload->'members','[]'::jsonb)) x(value) where value->>'id' in (member_uuid::text,member_local) order by case when value->>'id'=member_local then 0 else 1 end limit 1),'{}'::jsonb) || jsonb_build_object('id',member_local,'active',true))
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
    ) || coalesce((select value from jsonb_array_elements(coalesce(payload->'people','[]'::jsonb)) x(value) where value->>'id' in (participant_uuid::text,participant_local) order by case when value->>'id'=participant_local then 0 else 1 end limit 1),'{}'::jsonb) || jsonb_build_object('id',participant_local,'memberId',member_local,'profileId',auth.uid(),'removedFromTrip',false))
  ),revision=revision+1,updated_by=auth.uid(),updated_at=now()
  where trip_id=link.trip_id;

  return jsonb_build_object('trip_id',link.trip_id,'role','participant');
end;
$function$;

revoke all on function public.accept_registered_join_link_id(uuid,text,text) from public,anon,authenticated;
create or replace function public.respond_event_invitation(raw_token text default null,saved_id uuid default null,answer text default 'remember',display_name text default null,phone text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.trip_join_links%rowtype; result jsonb; invitation_id uuid; new_response text;
begin
 if not exists(select 1 from auth.users where id=auth.uid() and not is_anonymous and confirmed_at is not null) then raise exception 'registered account required'; end if;
 if answer is null or answer not in ('remember','maybe','accepted') then raise exception 'invalid invitation response'; end if;
 if saved_id is not null then
  select l.* into link from public.trip_invitation_responses r join public.trip_join_links l on l.id=r.join_link_id where r.id=saved_id and r.profile_id=auth.uid() for update of l;
 else
  select * into link from public.trip_join_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') for update;
 end if;
 if link.id is null or not link.active or (link.expires_at is not null and link.expires_at<=now()) then raise exception 'invalid join link'; end if;
 if exists(select 1 from public.trip_access_revocations where trip_id=link.trip_id and profile_id=auth.uid() and not(reason='participant_removed' and revoked_at<link.created_at)) then raise exception 'access revoked by organizer'; end if;
 new_response:=case answer when 'remember' then 'pending' else answer end;
 if exists(select 1 from public.trip_access where trip_id=link.trip_id and profile_id=auth.uid() and not exists(select 1 from public.trip_access_revocations r where r.trip_id=link.trip_id and r.profile_id=auth.uid())) then new_response:='accepted'; end if;
 if answer='accepted' then result:=public.accept_registered_join_link_id(link.id,display_name,phone); end if;
 insert into public.trip_invitation_responses(trip_id,profile_id,join_link_id,response) values(link.trip_id,auth.uid(),link.id,new_response)
 on conflict(trip_id,profile_id) do update set join_link_id=excluded.join_link_id,
 response=case when trip_invitation_responses.response='accepted' and exists(select 1 from public.trip_access a where a.trip_id=link.trip_id and a.profile_id=auth.uid() and not exists(select 1 from public.trip_access_revocations v where v.trip_id=link.trip_id and v.profile_id=auth.uid())) then 'accepted' when answer='remember' and trip_invitation_responses.response<>'accepted' then trip_invitation_responses.response else excluded.response end,updated_at=now()
 returning id into invitation_id;
 return coalesce(result,'{}'::jsonb)||jsonb_build_object('id',invitation_id,'trip_id',link.trip_id,'response',(select response from public.trip_invitation_responses where id=invitation_id));
end $$;
revoke all on function public.respond_event_invitation(text,uuid,text,text,text) from public,anon;
grant execute on function public.respond_event_invitation(text,uuid,text,text,text) to authenticated;

create or replace function public.list_my_event_invitations()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'response',r.response,'updated_at',r.updated_at)||public.preview_event_invitation(null,r.id) order by r.updated_at desc),'[]'::jsonb)
 from public.trip_invitation_responses r where r.profile_id=auth.uid() and r.response<>'accepted'
 and exists(select 1 from auth.users where id=auth.uid() and not is_anonymous)
 and not exists(select 1 from public.trip_access a where a.trip_id=r.trip_id and a.profile_id=auth.uid() and not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=auth.uid()))
 and not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=auth.uid() and not(v.reason='participant_removed' and v.revoked_at<(select created_at from public.trip_join_links where id=r.join_link_id)));
$$;
revoke all on function public.list_my_event_invitations() from public,anon;
grant execute on function public.list_my_event_invitations() to authenticated;
commit;

begin;
-- Organizer-only read access to invitation responses; no attendance or financial changes.
create or replace function public.list_trip_invitation_responses(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_registered_user() or not public.is_trip_organizer(target_trip) then raise exception 'access denied';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',coalesce(nullif(p.display_name,''),'Convidado'),'response',r.response,'updated_at',r.updated_at) order by r.updated_at desc),'[]'::jsonb)
 from public.trip_invitation_responses r join public.profiles p on p.id=r.profile_id join public.trip_join_links l on l.id=r.join_link_id
 where r.trip_id=target_trip
 and not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=r.profile_id and not(v.reason='participant_removed' and v.revoked_at<l.created_at))
 and (r.response<>'accepted' or not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=r.profile_id)));
end $$;
revoke all on function public.list_trip_invitation_responses(uuid) from public,anon;
grant execute on function public.list_trip_invitation_responses(uuid) to authenticated;
create or replace function public.list_my_admin_notifications()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_registered_user() then return '[]'::jsonb; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'type',q.kind,'trip_id',q.trip_id,'trip_name',q.trip_name,'participant_name',q.participant_name,'requester_name',q.requester_name,'requester_email',q.requester_email,'amount_cents',q.amount_cents,'created_at',q.created_at) order by q.created_at desc),'[]') from (
  select l.id,'access_request'::text kind,l.trip_id,t.name trip_name,gm.display_name participant_name,p.display_name requester_name,u.email::text requester_email,null::bigint amount_cents,coalesce(l.requested_at,l.created_at) created_at
  from public.participant_access_links l join public.trips t on t.id=l.trip_id join public.trip_participants tp on tp.id=l.participant_id and tp.trip_id=l.trip_id join public.group_members gm on gm.id=tp.member_id join public.profiles p on p.id=l.requested_by join auth.users u on u.id=l.requested_by
  where l.status='requested' and l.expires_at>now() and tp.removed_at is null and public.is_trip_organizer(l.trip_id)
  union all
  select b.id,'purchase_batch',b.trip_id,t.name,null,p.display_name,null,b.total_cents,b.updated_at
  from public.shopping_purchase_batches b join public.trips t on t.id=b.trip_id join public.profiles p on p.id=b.submitted_by where b.status='submitted' and public.is_trip_organizer(b.trip_id)
  union all
  select s.id,'purchase_item',s.trip_id,t.name,s.item_name,p.display_name,null,s.total_cents,s.created_at
  from public.shopping_purchase_submissions s join public.trips t on t.id=s.trip_id join public.profiles p on p.id=s.submitted_by where s.status='submitted' and s.batch_id is null and public.is_trip_organizer(s.trip_id)
  union all
  select r.id,'invitation_maybe',r.trip_id,t.name,null,p.display_name,null,null::bigint,r.updated_at
  from public.trip_invitation_responses r join public.trips t on t.id=r.trip_id join public.profiles p on p.id=r.profile_id join public.trip_join_links l on l.id=r.join_link_id
  where r.response='maybe' and public.is_trip_organizer(r.trip_id) and l.active and (l.expires_at is null or l.expires_at>now())
   and not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=r.profile_id and not(v.reason='participant_removed' and v.revoked_at<l.created_at))
 ) q);
end $$;
revoke all on function public.list_my_admin_notifications() from public,anon;
grant execute on function public.list_my_admin_notifications() to authenticated;

commit;

-- Final verification: all three columns should return true.
select
 to_regprocedure('public.list_trip_invitation_responses(uuid)') is not null as respostas_disponiveis,
 position('invitation_maybe' in pg_get_functiondef('public.list_my_admin_notifications()'::regprocedure))>0 as respostas_nas_notificacoes,
 position('not exists(select 1 from public.trip_access_revocations r where r.trip_id=link.trip_id' in pg_get_functiondef('public.accept_registered_join_link_id(uuid,text,text)'::regprocedure))>0 as reentrada_atualizada;
