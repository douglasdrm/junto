begin;

create table if not exists public.trip_join_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token_hash text not null unique,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.trip_join_links enable row level security;
drop policy if exists join_links_organizer_all on public.trip_join_links;
create policy join_links_organizer_all on public.trip_join_links for all to authenticated
using (public.is_trip_organizer(trip_id)) with check (public.is_trip_organizer(trip_id));

create or replace function public.create_trip_join_link(target_trip uuid)
returns text language plpgsql security definer set search_path='' as $$
declare raw_token text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  update public.trip_join_links set active=false where trip_id=target_trip and active;
  insert into public.trip_join_links(trip_id,token_hash,created_by)
  values(target_trip,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid());
  return raw_token;
end;
$$;

create or replace function public.accept_trip_join_link(raw_token text, display_name text, phone text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.trip_join_links%rowtype; group_uuid uuid; owner uuid; member_uuid uuid; participant_uuid uuid; clean_name text:=trim(display_name); clean_phone text:=nullif(trim(phone),'');
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if char_length(clean_name)<2 or char_length(clean_name)>100 then raise exception 'valid name required'; end if;
  select * into link from public.trip_join_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') and active and (expires_at is null or expires_at>now()) for update;
  if link.id is null then raise exception 'invalid join link'; end if;
  if exists(select 1 from public.trip_access where trip_id=link.trip_id and profile_id=auth.uid() and role='participant') then return jsonb_build_object('trip_id',link.trip_id,'role','participant'); end if;
  select group_id,organizer_id into group_uuid,owner from public.trips where id=link.trip_id;
  select gm.id into member_uuid from public.group_members gm join public.member_profile_links mpl on mpl.member_id=gm.id where gm.group_id=group_uuid and mpl.profile_id=auth.uid() and mpl.status='active' limit 1;
  if member_uuid is null then
    insert into public.group_members(group_id,display_name,phone,active,local_source_id,created_by) values(group_uuid,clean_name,clean_phone,true,'joined-'||auth.uid()::text,owner) returning id into member_uuid;
    insert into public.member_profile_links(member_id,profile_id,status,authorized_by,linked_at) values(member_uuid,auth.uid(),'active',link.created_by,now());
  else
    update public.group_members set display_name=clean_name,phone=clean_phone,updated_at=now() where id=member_uuid;
  end if;
  insert into public.trip_participants(trip_id,member_id,contributes,settings,local_source_id)
  values(link.trip_id,member_uuid,false,jsonb_build_object('name',clean_name,'phone',clean_phone,'contributionStatus','pending'),'joined-'||auth.uid()::text)
  on conflict(trip_id,member_id) do update set removed_at=null,settings=excluded.settings,updated_at=now() returning id into participant_uuid;
  insert into public.trip_access(trip_id,profile_id,role,granted_by) values(link.trip_id,auth.uid(),'participant',link.created_by) on conflict do nothing;
  perform 1 from public.trip_snapshots where trip_id=link.trip_id for update;
  update public.trip_snapshots set payload=jsonb_set(
    jsonb_set(payload,'{members}',(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(coalesce(payload->'members','[]'::jsonb)) as item(value) where value->>'id'<>member_uuid::text)||jsonb_build_array(jsonb_build_object('id',member_uuid::text,'groupId',group_uuid::text,'name',clean_name,'phone',clean_phone,'active',true))),
    '{people}',(select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements(coalesce(payload->'people','[]'::jsonb)) as item(value) where value->>'id'<>participant_uuid::text)||jsonb_build_array(jsonb_build_object('id',participant_uuid::text,'memberId',member_uuid::text,'trip',payload->'trip'->>'id','name',clean_name,'phone',clean_phone,'participantType','adult','contributes',false,'contributionStatus','pending'))
  ),revision=revision+1,updated_by=auth.uid(),updated_at=now() where trip_id=link.trip_id;
  return jsonb_build_object('trip_id',link.trip_id,'role','participant');
end;
$$;

create or replace function public.participant_invites_schema_version()
returns integer language sql stable security definer set search_path='' as $$ select 2 $$;

revoke all on function public.create_trip_join_link(uuid), public.accept_trip_join_link(text,text,text), public.participant_invites_schema_version() from public;
grant execute on function public.create_trip_join_link(uuid), public.accept_trip_join_link(text,text,text), public.participant_invites_schema_version() to authenticated;

commit;
