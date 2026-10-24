begin;

alter table public.trip_invites alter column participant_id drop not null;

create table public.trip_snapshots (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.trip_snapshots enable row level security;
create policy snapshots_organizer_select on public.trip_snapshots for select to authenticated using (public.is_trip_organizer(trip_id));
grant select on public.trip_snapshots to authenticated;

create function public.import_local_trip(payload jsonb, content_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner uuid := auth.uid();
  local_trip jsonb := payload->'trip';
  local_group jsonb := payload->'group';
  group_uuid uuid;
  trip_uuid uuid;
  member_uuid uuid;
  member_row jsonb;
  person_row jsonb;
  local_trip_id text := local_trip->>'id';
  local_group_id text := coalesce(local_group->>'id', local_trip->>'groupId', 'group-'||local_trip_id);
begin
  if owner is null then raise exception 'authentication required'; end if;
  if local_trip_id is null or coalesce(local_trip->>'name','')='' then raise exception 'invalid trip'; end if;
  if octet_length(payload::text) > 5242880 then raise exception 'trip payload too large'; end if;
  if jsonb_array_length(coalesce(payload->'people','[]'::jsonb)) > 500 then raise exception 'too many participants'; end if;

  insert into public.travel_groups(owner_id,name,description,local_source_id)
  values(owner,coalesce(nullif(local_group->>'name',''),'Grupo da viagem'),coalesce(local_group->>'description',''),local_group_id)
  on conflict(owner_id,local_source_id) do update set name=excluded.name,description=excluded.description,updated_at=now()
  returning id into group_uuid;

  for member_row in select value from jsonb_array_elements(coalesce(payload->'members','[]'::jsonb)) loop
    insert into public.group_members(group_id,display_name,email,phone,birth_date,active,local_source_id,created_by)
    values(group_uuid,coalesce(nullif(member_row->>'name',''),'Pessoa'),nullif(member_row->>'email',''),nullif(member_row->>'phone',''),nullif(member_row->>'birthDate','')::date,coalesce((member_row->>'active')::boolean,true),member_row->>'id',owner)
    on conflict(group_id,local_source_id) do update set display_name=excluded.display_name,email=excluded.email,phone=excluded.phone,birth_date=excluded.birth_date,active=excluded.active,updated_at=now();
  end loop;

  insert into public.trips(group_id,organizer_id,name,event_type,starts_on,ends_on,status,settings,local_source_id)
  values(group_uuid,owner,local_trip->>'name','trip',nullif(local_trip->>'start','')::date,nullif(local_trip->>'end','')::date,'active',local_trip,local_trip_id)
  on conflict(organizer_id,local_source_id) do update set name=excluded.name,starts_on=excluded.starts_on,ends_on=excluded.ends_on,settings=excluded.settings,updated_at=now()
  returning id into trip_uuid;

  insert into public.trip_access(trip_id,profile_id,role,granted_by) values(trip_uuid,owner,'organizer',owner) on conflict do nothing;

  for person_row in select value from jsonb_array_elements(coalesce(payload->'people','[]'::jsonb)) loop
    select id into member_uuid from public.group_members where group_id=group_uuid and local_source_id=person_row->>'memberId';
    if member_uuid is null then
      insert into public.group_members(group_id,display_name,birth_date,active,local_source_id,created_by)
      values(group_uuid,coalesce(nullif(person_row->>'name',''),'Pessoa'),nullif(person_row->>'birthDate','')::date,true,coalesce(person_row->>'memberId','participant-'||(person_row->>'id')),owner)
      returning id into member_uuid;
    end if;
    insert into public.trip_participants(trip_id,member_id,contributes,removed_at,settings,local_source_id)
    values(trip_uuid,member_uuid,coalesce((person_row->>'contributes')::boolean,true),case when coalesce((person_row->>'removedFromTrip')::boolean,false) then now() else null end,person_row,person_row->>'id')
    on conflict(trip_id,local_source_id) do update set contributes=excluded.contributes,removed_at=excluded.removed_at,settings=excluded.settings,updated_at=now();
  end loop;

  insert into public.trip_snapshots(trip_id,payload,revision,updated_by) values(trip_uuid,payload,1,owner)
  on conflict(trip_id) do update set payload=excluded.payload,revision=public.trip_snapshots.revision+1,updated_by=owner,updated_at=now();

  insert into public.migration_imports(owner_id,content_hash,schema_version,status,summary,completed_at)
  values(owner,content_hash,1,'completed',jsonb_build_object('trip_id',trip_uuid,'local_trip_id',local_trip_id),now())
  on conflict(owner_id,content_hash) do update set status='completed',summary=excluded.summary,completed_at=now();

  return jsonb_build_object('trip_id',trip_uuid,'revision',(select revision from public.trip_snapshots where trip_id=trip_uuid));
end;
$$;

create function public.sync_trip_snapshot(target_trip uuid, new_payload jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare next_revision bigint;
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  if octet_length(new_payload::text) > 5242880 then raise exception 'trip payload too large'; end if;
  update public.trip_snapshots set payload=new_payload,revision=revision+1,updated_by=auth.uid(),updated_at=now()
  where trip_id=target_trip and revision=expected_revision returning revision into next_revision;
  if next_revision is null then raise exception 'sync conflict'; end if;
  return next_revision;
end;
$$;

create function public.create_trip_invite(target_trip uuid, invite_role public.trip_role default 'organizer')
returns text language plpgsql security definer set search_path='' as $$
declare raw_token text := encode(extensions.gen_random_bytes(32),'hex');
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  if invite_role <> 'organizer' then raise exception 'unsupported role'; end if;
  insert into public.trip_invites(trip_id,participant_id,role,token_hash,status,expires_at,created_by)
  values(target_trip,null,invite_role,encode(extensions.digest(raw_token,'sha256'),'hex'),'pending',now()+interval '7 days',auth.uid());
  return raw_token;
end;
$$;

create function public.accept_trip_invite(raw_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.trip_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into invitation from public.trip_invites where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') and status='pending' and expires_at>now() for update;
  if invitation.id is null then raise exception 'invalid or expired invite'; end if;
  insert into public.trip_access(trip_id,profile_id,role,granted_by) values(invitation.trip_id,auth.uid(),invitation.role,invitation.created_by) on conflict do nothing;
  update public.trip_invites set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
  return jsonb_build_object('trip_id',invitation.trip_id,'role',invitation.role);
end;
$$;

revoke all on function public.import_local_trip(jsonb,text), public.sync_trip_snapshot(uuid,jsonb,bigint), public.create_trip_invite(uuid,public.trip_role), public.accept_trip_invite(text) from public;
grant execute on function public.import_local_trip(jsonb,text), public.sync_trip_snapshot(uuid,jsonb,bigint), public.create_trip_invite(uuid,public.trip_role), public.accept_trip_invite(text) to authenticated;

commit;
