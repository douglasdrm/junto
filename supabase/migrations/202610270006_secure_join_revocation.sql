begin;

create or replace function public.is_registered_user()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from auth.users
    where id=auth.uid() and not coalesce(is_anonymous,false)
  )
$$;

revoke all on function public.is_registered_user() from public;
grant execute on function public.is_registered_user() to authenticated;

create or replace function public.is_trip_organizer(target_trip uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.is_registered_user() and exists(
    select 1 from public.trips t
    where t.id=target_trip and (
      t.organizer_id=auth.uid() or exists(
        select 1 from public.trip_access a
        where a.trip_id=t.id and a.profile_id=auth.uid() and a.role='organizer'
      )
    )
  )
$$;

create or replace function public.prevent_anonymous_organization()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.is_registered_user() then
    raise exception 'registered account required';
  end if;
  return new;
end;
$$;

drop trigger if exists travel_groups_registered_owner on public.travel_groups;
create trigger travel_groups_registered_owner
before insert on public.travel_groups
for each row execute function public.prevent_anonymous_organization();

drop trigger if exists trips_registered_organizer on public.trips;
create trigger trips_registered_organizer
before insert on public.trips
for each row execute function public.prevent_anonymous_organization();

create table if not exists public.trip_access_revocations (
  trip_id uuid not null references public.trips(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  participant_id uuid references public.trip_participants(id) on delete set null,
  revoked_by uuid not null references public.profiles(id),
  reason text not null default 'organizer_revoked',
  revoked_at timestamptz not null default now(),
  primary key (trip_id,profile_id)
);

alter table public.trip_access_revocations enable row level security;

insert into public.trip_access_revocations(trip_id,profile_id,participant_id,revoked_by,reason)
select tp.trip_id,mpl.profile_id,tp.id,t.organizer_id,'migration_backfill'
from public.trip_participants tp
join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.status='active'
join public.trips t on t.id=tp.trip_id
where tp.local_source_id like 'joined-%' and tp.removed_at is null
  and not exists(
    select 1 from public.trip_access a
    where a.trip_id=tp.trip_id and a.profile_id=mpl.profile_id
      and a.role in ('participant','financial_responsible')
  )
on conflict(trip_id,profile_id) do nothing;

create or replace function public.revoke_removed_participant_access()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.removed_at is null and new.removed_at is not null then
    insert into public.trip_access_revocations(trip_id,profile_id,participant_id,revoked_by,reason)
    select new.trip_id,mpl.profile_id,new.id,coalesce(auth.uid(),t.organizer_id),'participant_removed'
    from public.member_profile_links mpl
    join public.trips t on t.id=new.trip_id
    where mpl.member_id=new.member_id and mpl.status='active'
    on conflict(trip_id,profile_id) do update
      set participant_id=excluded.participant_id,revoked_by=excluded.revoked_by,
          reason=excluded.reason,revoked_at=now();
  end if;
  return new;
end;
$$;

drop trigger if exists trip_participant_removal_revokes_access on public.trip_participants;
create trigger trip_participant_removal_revokes_access
after update of removed_at on public.trip_participants
for each row execute function public.revoke_removed_participant_access();

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
    values(group_uuid,clean_name,clean_phone,true,'joined-'||auth.uid()::text,owner) returning id into member_uuid;
    insert into public.member_profile_links(member_id,profile_id,status,authorized_by,linked_at)
    values(member_uuid,auth.uid(),'active',link.created_by,now());
  else
    update public.group_members set display_name=clean_name,phone=clean_phone,updated_at=now() where id=member_uuid;
  end if;
  insert into public.trip_participants(trip_id,member_id,contributes,settings,local_source_id)
  values(link.trip_id,member_uuid,true,jsonb_build_object('name',clean_name,'phone',clean_phone,'contributes',true,'contributionStatus','configured','joinedByLink',true),'joined-'||auth.uid()::text)
  on conflict(trip_id,member_id) do update
    set contributes=true,removed_at=null,settings=excluded.settings,updated_at=now()
  returning id into participant_uuid;
  insert into public.trip_access(trip_id,profile_id,role,granted_by)
  values(link.trip_id,auth.uid(),'participant',link.created_by) on conflict do nothing;
  perform 1 from public.trip_snapshots where trip_id=link.trip_id for update;
  update public.trip_snapshots set payload=jsonb_set(
    jsonb_set(payload,'{members}',(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(coalesce(payload->'members','[]'::jsonb)) as item(value) where value->>'id'<>member_uuid::text)||jsonb_build_array(jsonb_build_object('id',member_uuid::text,'groupId',group_uuid::text,'name',clean_name,'phone',clean_phone,'active',true))),
    '{people}',(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(coalesce(payload->'people','[]'::jsonb)) as item(value) where value->>'id'<>participant_uuid::text)||jsonb_build_array(jsonb_build_object('id',participant_uuid::text,'memberId',member_uuid::text,'trip',payload->'trip'->>'id','name',clean_name,'phone',clean_phone,'participantType','adult','contributes',true,'contributionStatus','configured','joinedByLink',true))
  ),revision=revision+1,updated_by=auth.uid(),updated_at=now() where trip_id=link.trip_id;
  return jsonb_build_object('trip_id',link.trip_id,'role','participant');
end;
$$;

create or replace function public.revoke_trip_participant_access(target_trip uuid, local_participant_id text)
returns void language plpgsql security definer set search_path='' as $$
declare target_member uuid; target_participant uuid; target_profile uuid;
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  select id,member_id into target_participant,target_member
  from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id;
  if target_participant is null then raise exception 'participant not found'; end if;
  select profile_id into target_profile from public.member_profile_links
  where member_id=target_member and status='active' limit 1;
  update public.trip_invites set status='cancelled'
  where participant_id=target_participant and status='pending';
  if target_profile is not null then
    insert into public.trip_access_revocations(trip_id,profile_id,participant_id,revoked_by)
    values(target_trip,target_profile,target_participant,auth.uid())
    on conflict(trip_id,profile_id) do update
      set participant_id=excluded.participant_id,revoked_by=excluded.revoked_by,
          reason='organizer_revoked',revoked_at=now();
    delete from public.trip_access
    where trip_id=target_trip and profile_id=target_profile
      and role in ('participant','financial_responsible');
  end if;
end;
$$;

create or replace function public.restore_trip_participant_access(target_trip uuid, local_participant_id text)
returns void language plpgsql security definer set search_path='' as $$
declare target_member uuid; target_profile uuid;
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  select member_id into target_member from public.trip_participants
  where trip_id=target_trip and local_source_id=local_participant_id and removed_at is null;
  if target_member is null then raise exception 'active participant not found'; end if;
  select profile_id into target_profile from public.member_profile_links
  where member_id=target_member and status='active' limit 1;
  if target_profile is null then raise exception 'participant has no linked account'; end if;
  delete from public.trip_access_revocations where trip_id=target_trip and profile_id=target_profile;
  insert into public.trip_access(trip_id,profile_id,role,granted_by)
  values(target_trip,target_profile,'participant',auth.uid()) on conflict do nothing;
end;
$$;

create or replace function public.list_trip_participant_access(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'participant_id',q.participant_id,'name',q.name,'email',q.email,
    'invite_status',q.invite_status,'access_active',q.access_active,'access_revoked',q.access_revoked
  ) order by q.name),'[]'::jsonb) into result
  from (
    select tp.local_source_id participant_id,gm.display_name name,
      coalesce(i.invitee_email,gm.email) email,i.status invite_status,
      (a.profile_id is not null) access_active,(r.profile_id is not null) access_revoked
    from public.trip_participants tp
    join public.group_members gm on gm.id=tp.member_id
    left join lateral (
      select ti.invitee_email,ti.status from public.trip_invites ti
      where ti.participant_id=tp.id order by ti.created_at desc limit 1
    ) i on true
    left join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.status='active'
    left join public.trip_access a on a.trip_id=tp.trip_id and a.profile_id=mpl.profile_id and a.role='participant'
    left join public.trip_access_revocations r on r.trip_id=tp.trip_id and r.profile_id=mpl.profile_id
    where tp.trip_id=target_trip and tp.removed_at is null
  ) q;
  return result;
end;
$$;

create or replace function public.participant_invites_schema_version()
returns integer language sql stable security definer set search_path='' as $$ select 3 $$;

revoke all on function public.accept_trip_join_link(text,text,text),
  public.revoke_trip_participant_access(uuid,text), public.restore_trip_participant_access(uuid,text),
  public.list_trip_participant_access(uuid), public.participant_invites_schema_version() from public;
grant execute on function public.accept_trip_join_link(text,text,text),
  public.revoke_trip_participant_access(uuid,text), public.restore_trip_participant_access(uuid,text),
  public.list_trip_participant_access(uuid), public.participant_invites_schema_version() to authenticated;

commit;
