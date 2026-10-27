begin;

alter table public.trip_invites add column if not exists invitee_email text;
create index if not exists trip_invites_participant_status_idx on public.trip_invites(participant_id,status);
update public.trip_invites set status='cancelled' where status='pending' and invitee_email is null;

-- Leitura direta limitada; dados coletivos são entregues pelas RPCs abaixo.
drop policy if exists trips_access_select on public.trips;
create policy trips_access_select on public.trips for select to authenticated using (public.is_trip_organizer(id));

drop policy if exists access_visible_to_trip on public.trip_access;
create policy access_visible_to_trip on public.trip_access for select to authenticated
using (profile_id=auth.uid() or public.is_trip_organizer(trip_id));

drop policy if exists participants_visible_to_trip on public.trip_participants;
create policy participants_visible_to_trip on public.trip_participants for select to authenticated
using (public.is_trip_organizer(trip_id) or exists(
  select 1 from public.member_profile_links mpl
  where mpl.member_id=trip_participants.member_id and mpl.profile_id=auth.uid() and mpl.status='active'
  and exists(select 1 from public.trip_access a where a.trip_id=trip_participants.trip_id and a.profile_id=auth.uid() and a.role in ('participant','financial_responsible'))
));

drop policy if exists audit_trip_select on public.audit_events;
create policy audit_trip_select on public.audit_events for select to authenticated using (public.is_trip_organizer(trip_id));

drop policy if exists submissions_visible on public.payment_submissions;
create policy submissions_visible on public.payment_submissions for select to authenticated
using (public.is_trip_organizer(trip_id) or (submitted_by=auth.uid() and public.can_access_trip(trip_id)));

drop policy if exists submissions_create_own on public.payment_submissions;
create policy submissions_create_own on public.payment_submissions for insert to authenticated with check (
  submitted_by=auth.uid() and public.can_access_trip(trip_id) and exists(
    select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id
    where tp.id=participant_id and tp.trip_id=trip_id and tp.removed_at is null and mpl.profile_id=auth.uid() and mpl.status='active'
  )
);

drop policy if exists receipts_visible on public.payment_receipts;
create policy receipts_visible on public.payment_receipts for select to authenticated using (exists(
  select 1 from public.payment_submissions s where s.id=submission_id
  and (public.is_trip_organizer(s.trip_id) or (s.submitted_by=auth.uid() and public.can_access_trip(s.trip_id)))
));

drop policy if exists receipts_submitter_insert on public.payment_receipts;
create policy receipts_submitter_insert on public.payment_receipts for insert to authenticated with check (
  uploaded_by=auth.uid() and exists(select 1 from public.payment_submissions s
  where s.id=submission_id and s.submitted_by=auth.uid() and public.can_access_trip(s.trip_id))
);

-- Sincroniza participantes relacionais com o snapshot, preservando histórico.
create or replace function public.sync_trip_snapshot(target_trip uuid, new_payload jsonb, expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  next_revision bigint; group_uuid uuid; owner uuid; member_uuid uuid;
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
    insert into public.group_members(group_id,display_name,email,phone,birth_date,active,local_source_id,created_by)
    values(group_uuid,coalesce(nullif(member_row->>'name',''),'Pessoa'),nullif(lower(member_row->>'email'),''),nullif(member_row->>'phone',''),nullif(member_row->>'birthDate','')::date,coalesce((member_row->>'active')::boolean,true),member_row->>'id',owner)
    on conflict(group_id,local_source_id) do update set display_name=excluded.display_name,email=excluded.email,phone=excluded.phone,birth_date=excluded.birth_date,active=excluded.active,updated_at=now();
  end loop;

  for person_row in select value from jsonb_array_elements(coalesce(new_payload->'people','[]'::jsonb)) loop
    select id into member_uuid from public.group_members where group_id=group_uuid and local_source_id=person_row->>'memberId';
    if member_uuid is null then
      insert into public.group_members(group_id,display_name,birth_date,active,local_source_id,created_by)
      values(group_uuid,coalesce(nullif(person_row->>'name',''),'Pessoa'),nullif(person_row->>'birthDate','')::date,true,coalesce(person_row->>'memberId','participant-'||(person_row->>'id')),owner)
      returning id into member_uuid;
    end if;
    is_removed:=coalesce((person_row->>'removedFromTrip')::boolean,false);
    insert into public.trip_participants(trip_id,member_id,contributes,removed_at,settings,local_source_id)
    values(target_trip,member_uuid,coalesce((person_row->>'contributes')::boolean,true),case when is_removed then now() else null end,person_row,person_row->>'id')
    on conflict(trip_id,local_source_id) do update set member_id=excluded.member_id,contributes=excluded.contributes,removed_at=excluded.removed_at,settings=excluded.settings,updated_at=now();
  end loop;

  for existing_participant in select id,member_id,local_source_id from public.trip_participants where trip_id=target_trip loop
    if not exists(select 1 from jsonb_array_elements(coalesce(new_payload->'people','[]'::jsonb)) p
      where p->>'id'=existing_participant.local_source_id and not coalesce((p->>'removedFromTrip')::boolean,false)) then
      update public.trip_participants set removed_at=coalesce(removed_at,now()),updated_at=now() where id=existing_participant.id;
      update public.trip_invites set status='cancelled' where participant_id=existing_participant.id and status='pending';
      delete from public.trip_access a using public.member_profile_links mpl
      where a.trip_id=target_trip and a.role in ('participant','financial_responsible')
      and mpl.member_id=existing_participant.member_id and mpl.profile_id=a.profile_id;
    end if;
  end loop;
  return next_revision;
end;
$$;

drop function if exists public.create_participant_invite(uuid,text);
create or replace function public.create_participant_invite(target_trip uuid, local_participant_id text, invited_email text)
returns text language plpgsql security definer set search_path='' as $$
declare raw_token text:=encode(extensions.gen_random_bytes(32),'hex'); target_participant uuid; normalized_email text:=lower(trim(invited_email));
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  if normalized_email!~'^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'valid invitee email required'; end if;
  select id into target_participant from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id and removed_at is null;
  if target_participant is null then raise exception 'participant not found'; end if;
  update public.trip_invites set status='cancelled' where participant_id=target_participant and role='participant' and status='pending';
  insert into public.trip_invites(trip_id,participant_id,role,token_hash,destination_hint,invitee_email,status,expires_at,created_by)
  values(target_trip,target_participant,'participant',encode(extensions.digest(raw_token,'sha256'),'hex'),normalized_email,normalized_email,'pending',now()+interval '7 days',auth.uid());
  return raw_token;
end;
$$;

create or replace function public.create_admin_invite(target_trip uuid, invited_email text)
returns text language plpgsql security definer set search_path='' as $$
declare raw_token text:=encode(extensions.gen_random_bytes(32),'hex'); normalized_email text:=lower(trim(invited_email));
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  if normalized_email!~'^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'valid invitee email required'; end if;
  insert into public.trip_invites(trip_id,participant_id,role,token_hash,destination_hint,invitee_email,status,expires_at,created_by)
  values(target_trip,null,'organizer',encode(extensions.digest(raw_token,'sha256'),'hex'),normalized_email,normalized_email,'pending',now()+interval '7 days',auth.uid());
  return raw_token;
end;
$$;

create or replace function public.accept_trip_invite(raw_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.trip_invites%rowtype; participant_member uuid; existing_profile uuid; authenticated_email text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select lower(email) into authenticated_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  select * into invitation from public.trip_invites where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') and status='pending' and expires_at>now() for update;
  if invitation.id is null then raise exception 'invalid or expired invite'; end if;
  if invitation.invitee_email is null or authenticated_email is null or authenticated_email<>lower(invitation.invitee_email) then raise exception 'invite email mismatch'; end if;
  if invitation.participant_id is not null then
    select member_id into participant_member from public.trip_participants where id=invitation.participant_id and trip_id=invitation.trip_id and removed_at is null;
    if participant_member is null then raise exception 'participant no longer active'; end if;
    select profile_id into existing_profile from public.member_profile_links where member_id=participant_member and status='active';
    if existing_profile is not null and existing_profile<>auth.uid() then raise exception 'participant already linked'; end if;
    insert into public.member_profile_links(member_id,profile_id,status,authorized_by,linked_at)
    values(participant_member,auth.uid(),'active',invitation.created_by,now())
    on conflict(member_id) do update set profile_id=excluded.profile_id,status='active',authorized_by=excluded.authorized_by,linked_at=now();
  end if;
  insert into public.trip_access(trip_id,profile_id,role,granted_by) values(invitation.trip_id,auth.uid(),invitation.role,invitation.created_by) on conflict do nothing;
  update public.trip_invites set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
  return jsonb_build_object('trip_id',invitation.trip_id,'role',invitation.role);
end;
$$;

create or replace function public.list_my_trip_views()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('trip_id',q.trip_id,'role',q.role,'name',q.name,'event_type',q.event_type,'updated_at',q.updated_at) order by q.updated_at desc),'[]'::jsonb)
  from (select t.id trip_id,case when t.organizer_id=auth.uid() or bool_or(a.role='organizer') then 'organizer' else 'participant' end role,t.name,t.event_type,s.updated_at
    from public.trips t join public.trip_access a on a.trip_id=t.id and a.profile_id=auth.uid() join public.trip_snapshots s on s.trip_id=t.id
    group by t.id,t.organizer_id,t.name,t.event_type,s.updated_at) q;
$$;

create or replace function public.get_participant_trip_view(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; source_trip jsonb; public_trip jsonb; collected bigint:=0; spent bigint:=0; planned bigint:=0; budget bigint:=0; participant_count integer:=0;
begin
  if not exists(select 1 from public.trip_access where trip_id=target_trip and profile_id=auth.uid() and role in ('participant','financial_responsible')) then raise exception 'access denied'; end if;
  select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
  if snapshot is null then raise exception 'trip not found'; end if;
  source_trip:=snapshot->'trip';
  public_trip:=jsonb_build_object('name',source_trip->>'name','eventType',source_trip->>'eventType','region',source_trip->>'region','start',source_trip->>'start','end',source_trip->>'end','guests',source_trip->'guests','fundraisingDeadline',source_trip->>'fundraisingDeadline','lifecycleStatus',source_trip->>'lifecycleStatus');
  select count(*) into participant_count from jsonb_array_elements(coalesce(snapshot->'people','[]'::jsonb)) p where not coalesce((p->>'removedFromTrip')::boolean,false);
  select coalesce(sum(coalesce((p->>'amountCents')::bigint,0)),0) into collected from jsonb_array_elements(coalesce(snapshot->'payments','[]'::jsonb)) p;
  select coalesce(sum(coalesce((e->>'paidCents')::bigint,0)),0),coalesce(sum(coalesce((e->>'plannedCents')::bigint,0)),0) into spent,planned from jsonb_array_elements(coalesce(snapshot->'expenses','[]'::jsonb)) e;
  budget:=case when source_trip ? 'totalBudgetCents' then coalesce((source_trip->>'totalBudgetCents')::bigint,0) else coalesce((source_trip->>'budgetCents')::bigint,0)+coalesce((source_trip->>'extrasCents')::bigint,0) end;
  return jsonb_build_object('trip_id',target_trip,'trip',public_trip,'participant_count',participant_count,'summary',jsonb_build_object('budget_cents',budget,'collected_cents',collected,'spent_cents',spent,'planned_cents',planned,'remaining_cents',greatest(0,budget-collected)),'updated_at',(select updated_at from public.trip_snapshots where trip_id=target_trip));
end;
$$;

create or replace function public.list_trip_participant_access(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('participant_id',q.participant_id,'name',q.name,'email',q.email,'invite_status',q.invite_status,'access_active',q.access_active) order by q.name),'[]'::jsonb) into result
  from (select tp.local_source_id participant_id,gm.display_name name,coalesce(i.invitee_email,gm.email) email,i.status invite_status,(a.profile_id is not null) access_active
    from public.trip_participants tp join public.group_members gm on gm.id=tp.member_id
    left join lateral (select ti.invitee_email,ti.status from public.trip_invites ti where ti.participant_id=tp.id order by ti.created_at desc limit 1) i on true
    left join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.status='active'
    left join public.trip_access a on a.trip_id=tp.trip_id and a.profile_id=mpl.profile_id and a.role='participant'
    where tp.trip_id=target_trip and tp.removed_at is null) q;
  return result;
end;
$$;

create or replace function public.revoke_trip_participant_access(target_trip uuid, local_participant_id text)
returns void language plpgsql security definer set search_path='' as $$
declare target_member uuid; target_participant uuid;
begin
  if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
  select id,member_id into target_participant,target_member from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id;
  if target_participant is null then raise exception 'participant not found'; end if;
  update public.trip_invites set status='cancelled' where participant_id=target_participant and status='pending';
  delete from public.trip_access a using public.member_profile_links mpl where a.trip_id=target_trip and a.role in ('participant','financial_responsible') and mpl.member_id=target_member and mpl.profile_id=a.profile_id;
end;
$$;

create or replace function public.participant_invites_schema_version()
returns integer language sql stable security definer set search_path='' as $$ select 1 $$;

revoke all on function public.create_trip_invite(uuid,public.trip_role) from authenticated;
revoke all on function public.sync_trip_snapshot(uuid,jsonb,bigint), public.accept_trip_invite(text), public.create_participant_invite(uuid,text,text), public.create_admin_invite(uuid,text), public.list_my_trip_views(), public.get_participant_trip_view(uuid), public.list_trip_participant_access(uuid), public.revoke_trip_participant_access(uuid,text), public.participant_invites_schema_version() from public;
grant execute on function public.sync_trip_snapshot(uuid,jsonb,bigint), public.accept_trip_invite(text), public.create_participant_invite(uuid,text,text), public.create_admin_invite(uuid,text), public.list_my_trip_views(), public.get_participant_trip_view(uuid), public.list_trip_participant_access(uuid), public.revoke_trip_participant_access(uuid,text), public.participant_invites_schema_version() to authenticated;

commit;
