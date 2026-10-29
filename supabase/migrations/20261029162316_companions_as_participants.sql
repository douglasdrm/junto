-- Revised after safety review: no change to sync_trip_snapshot, no payment writes.
-- Preflight: 2 existing companions in 1 event. A private checkpoint precedes adoption.
do $$ begin
 if (select count(*) from public.event_companions)>2 or (select count(distinct trip_id) from public.event_companions)>1 then
  raise exception 'Existing companion scope changed; review before migration';
 end if;
end $$;
-- Attendance and financial eligibility use the same participant identity.
alter table public.event_companions add column contributes boolean not null default true;
alter table public.event_companions add column member_id uuid references public.group_members(id);
alter table public.event_companions add column participant_id uuid references public.trip_participants(id);
alter table public.event_companions add column removed_at timestamptz;
drop index public.event_companions_name_idx;
create unique index event_companions_name_idx on public.event_companions(trip_id,responsible_id,lower(btrim(name))) where removed_at is null;
create index event_companions_member_idx on public.event_companions(member_id);
create index event_companions_participant_idx on public.event_companions(participant_id);

create function public.refresh_companion_participants(target_trip uuid) returns void
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; next_payload jsonb; group_uuid uuid; local_trip text; owner_id uuid; c public.event_companions; pid text; mid text; person jsonb; member jsonb; parents text; ids jsonb; ordering jsonb; total integer; payers integer;
begin
 select group_id,organizer_id into group_uuid,owner_id from public.trips where id=target_trip;
 select payload into snapshot from public.trip_snapshots where trip_id=target_trip for update;
 if snapshot is null then return;end if;
 next_payload:=snapshot;local_trip:=snapshot->'trip'->>'id';
 for c in select * from public.event_companions where trip_id=target_trip order by id for update loop
  pid:='companion-'||c.id::text;mid:='companion-member-'||c.id::text;
  if c.member_id is null then
   insert into public.group_members(group_id,display_name,active,local_source_id,created_by) values(group_uuid,c.name,true,mid,owner_id) returning id into c.member_id;
  else update public.group_members set display_name=c.name,updated_at=now() where id=c.member_id;end if;
  select coalesce(tp.local_source_id,tp.id::text) into parents from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.status='active' and mpl.profile_id=c.responsible_id where tp.trip_id=target_trip and tp.removed_at is null order by tp.created_at limit 1;
  select value into person from jsonb_array_elements(coalesce(next_payload->'people','[]')) where value->>'id'=pid;
  person:=coalesce(person,jsonb_build_object('id',pid,'memberId',mid,'trip',local_trip,'familyId','','familyGroup','','birthDate','','age',null,'customTargetCents',null,'targetCents',null,'weightOverride',true,'useAgeRule',false));
  person:=person||jsonb_build_object('name',c.name,'participantType',case when c.kind='child' then 'child' else 'adult' end,'contributes',c.contributes,'share',case when c.contributes then 1 else 0 end,'contributionStatus','configured','responsibleId',coalesce(parents,''),'companionId',c.id,'joinedByLink',true,'removedFromTrip',c.removed_at is not null);
  next_payload:=jsonb_set(next_payload,'{people}',coalesce((select jsonb_agg(case when value->>'id'=pid then person else value end) from jsonb_array_elements(coalesce(next_payload->'people','[]'))),'[]'));
  if not exists(select 1 from jsonb_array_elements(next_payload->'people') where value->>'id'=pid) then next_payload:=jsonb_set(next_payload,'{people}',(next_payload->'people')||jsonb_build_array(person));end if;
  select value into member from jsonb_array_elements(coalesce(next_payload->'members','[]')) where value->>'id'=mid;
  member:=coalesce(member,jsonb_build_object('id',mid,'groupId',snapshot->'trip'->>'groupId','birthDate','','active',true,'relationships','[]'::jsonb))||jsonb_build_object('name',c.name,'classification',case when c.kind='child' then 'child' else 'adult' end,'defaultContributes',c.contributes);
  next_payload:=jsonb_set(next_payload,'{members}',coalesce((select jsonb_agg(case when value->>'id'=mid then member else value end) from jsonb_array_elements(coalesce(next_payload->'members','[]'))),'[]'));
  if not exists(select 1 from jsonb_array_elements(next_payload->'members') where value->>'id'=mid) then next_payload:=jsonb_set(next_payload,'{members}',(next_payload->'members')||jsonb_build_array(member));end if;
  if c.participant_id is null then
   insert into public.trip_participants(trip_id,member_id,contributes,settings,local_source_id,removed_at) values(target_trip,c.member_id,c.contributes,person,pid,c.removed_at) returning id into c.participant_id;
  else update public.trip_participants set contributes=c.contributes,settings=person,removed_at=c.removed_at,updated_at=now() where id=c.participant_id;end if;
  update public.event_companions set member_id=c.member_id,participant_id=c.participant_id where id=c.id;
 end loop;
 -- Deleted companions remain historical people; payments and their beneficiary IDs survive.
 next_payload:=jsonb_set(next_payload,'{people}',coalesce((select jsonb_agg(case when value ? 'companionId' and not exists(select 1 from public.event_companions ec where ec.id::text=value->>'companionId' and ec.trip_id=target_trip and ec.removed_at is null) then value||'{"removedFromTrip":true}'::jsonb else value end) from jsonb_array_elements(coalesce(next_payload->'people','[]'))),'[]'));
 update public.trip_participants tp set removed_at=coalesce(tp.removed_at,now()),updated_at=now() where tp.trip_id=target_trip and tp.local_source_id like 'companion-%' and not exists(select 1 from public.event_companions ec where ec.participant_id=tp.id and ec.removed_at is null);
 select count(*),count(*) filter(where coalesce((value->>'contributes')::boolean,true)) into total,payers from jsonb_array_elements(next_payload->'people') where not coalesce((value->>'removedFromTrip')::boolean,false);
 next_payload:=jsonb_set(next_payload,'{trip}',(next_payload->'trip')||jsonb_build_object('guests',total,'payers',payers));
 if jsonb_typeof(next_payload->'trip'->'contributionPlan')='object' then
  select coalesce(jsonb_agg(value),'[]') into ids from jsonb_array_elements(coalesce(next_payload->'trip'->'contributionPlan'->'participantIds','[]')) where value#>>'{}' not like 'companion-%';
  select coalesce(jsonb_agg(value),'[]') into ordering from jsonb_array_elements(coalesce(next_payload->'trip'->'contributionPlan'->'participantOrder','[]')) where value#>>'{}' not like 'companion-%';
  select ids||coalesce(jsonb_agg(value->'id'),'[]'),ordering||coalesce(jsonb_agg(value->'id'),'[]') into ids,ordering from jsonb_array_elements(next_payload->'people') where value ? 'companionId' and not coalesce((value->>'removedFromTrip')::boolean,false) and coalesce((value->>'contributes')::boolean,true);
  next_payload:=jsonb_set(next_payload,'{trip,contributionPlan}',(next_payload->'trip'->'contributionPlan')||jsonb_build_object('peopleCount',total,'payerCount',payers,'participantIds',ids,'participantOrder',ordering));
 end if;
 if octet_length(next_payload::text)>5242880 then raise exception 'trip payload too large';end if;
 if jsonb_array_length(next_payload->'people')>500 then raise exception 'too many participants';end if;
 if next_payload is distinct from snapshot then update public.trip_snapshots set payload=next_payload,revision=revision+1,updated_at=now(),updated_by=coalesce(auth.uid(),owner_id) where trip_id=target_trip;end if;
end $$;
revoke all on function public.refresh_companion_participants(uuid) from public,anon,authenticated;

create or replace function public.get_event_companions(target_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.event_companion_settings; organizer boolean;
begin
 if auth.uid() is null or not public.can_access_trip(target_trip) then raise exception 'access denied';end if;
 organizer:=public.is_trip_organizer(target_trip);
 select * into s from public.event_companion_settings where trip_id=target_trip;
 return jsonb_build_object('enabled',exists(select 1 from public.trips where id=target_trip and event_type='celebration'),'organizer',organizer,'can_manage',public.can_submit_trip_purchase(target_trip),'allowed',coalesce(s.allowed,true),'limit',coalesce(s.per_person_limit,20),'revision',coalesce(s.revision,1),
 'participant_names',coalesce((select jsonb_agg(gm.display_name) from public.trip_participants tp join public.group_members gm on gm.id=tp.member_id where tp.trip_id=target_trip and tp.removed_at is null),'[]'),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'contributes',c.contributes,'revision',c.revision,'own',c.responsible_id=auth.uid(),'responsible_name',coalesce(p.display_name,'Participante')) order by c.created_at,c.id) from public.event_companions c join public.profiles p on p.id=c.responsible_id where c.trip_id=target_trip and c.removed_at is null),'[]'));
end $$;

alter function public.change_event_companions(uuid,text,jsonb,bigint) rename to change_event_companions_detached;
revoke all on function public.change_event_companions_detached(uuid,text,jsonb,bigint) from public,anon,authenticated;
-- Exclude removed attendance from the per-responsible limit in the existing validated workflow.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.change_event_companions_detached(uuid,text,jsonb,bigint)'::regprocedure);
 definition:=replace(definition,'where trip_id=target_trip and responsible_id=rid','where trip_id=target_trip and responsible_id=rid and removed_at is null');
 execute definition;
end $$;
create function public.change_event_companions(target_trip uuid,action text,body jsonb,expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare before_ids uuid[]; chosen uuid; organizer boolean;
begin
 if auth.uid() is null or not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied';end if;
 organizer:=public.is_trip_organizer(target_trip);
 perform pg_advisory_xact_lock(hashtextextended(target_trip::text,7214));
 -- Match the lock order of snapshot synchronisation.
 perform 1 from public.trip_snapshots where trip_id=target_trip for update;
 select coalesce(array_agg(id),'{}') into before_ids from public.event_companions where trip_id=target_trip;
 chosen:=nullif(body->>'id','')::uuid;
 if chosen is not null and exists(select 1 from public.event_companions where id=chosen and removed_at is not null) then raise exception 'access denied';end if;
 if not organizer and chosen is not null and body ? 'contributes' and (body->>'contributes')::boolean is distinct from (select contributes from public.event_companions where id=chosen and trip_id=target_trip) then raise exception 'organizer sets contribution';end if;
 if action='remove' and exists(select 1 from public.trip_snapshots where trip_id=target_trip and (payload->'payments')::text like '%companion-'||chosen::text||'%') then raise exception 'companion has payments';end if;
 perform public.change_event_companions_detached(target_trip,action,body,expected_revision);
 if action='save' then
  if chosen is null then select id into chosen from public.event_companions where trip_id=target_trip and not(id=any(before_ids));end if;
  if organizer then update public.event_companions set contributes=coalesce((body->>'contributes')::boolean,contributes) where id=chosen;end if;
 end if;
 perform public.refresh_companion_participants(target_trip);
 return public.get_event_companions(target_trip);
end $$;
revoke all on function public.change_event_companions(uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.change_event_companions(uuid,text,jsonb,bigint) to authenticated;

-- Only companion-linked participant rows are reflected back into attendance.
-- The central snapshot synchronisation function remains unchanged.
create function public.reflect_companion_participant() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.event_companions ec set
  name=coalesce(nullif(btrim(new.settings->>'name'),''),ec.name),
  kind=case when new.settings->>'participantType'='child' then 'child' else 'adult' end,
  contributes=new.contributes,removed_at=new.removed_at,revision=ec.revision+1
 where ec.participant_id=new.id and (ec.name is distinct from coalesce(nullif(btrim(new.settings->>'name'),''),ec.name)
 or ec.kind is distinct from case when new.settings->>'participantType'='child' then 'child' else 'adult' end
 or ec.contributes is distinct from new.contributes or ec.removed_at is distinct from new.removed_at);
 update public.event_potluck_claims claims set label=ec.name from public.event_companions ec where ec.participant_id=new.id and claims.companion_id=ec.id and claims.label is distinct from ec.name;
 return new;
end $$;
revoke all on function public.reflect_companion_participant() from public,anon,authenticated;
create trigger reflect_companion_participant after update of settings,contributes,removed_at on public.trip_participants for each row execute function public.reflect_companion_participant();

-- Private recovery checkpoint for the small set of existing affected events.
create table public.companion_participant_migration_backups (
 trip_id uuid primary key references public.trips(id) on delete cascade,
 snapshot_payload jsonb not null,
 snapshot_revision bigint not null,
 created_at timestamptz not null default now()
);
alter table public.companion_participant_migration_backups enable row level security;
revoke all on public.companion_participant_migration_backups from public,anon,authenticated;
insert into public.companion_participant_migration_backups(trip_id,snapshot_payload,snapshot_revision)
 select s.trip_id,s.payload,s.revision from public.trip_snapshots s where exists(select 1 from public.event_companions ec where ec.trip_id=s.trip_id);
do $$ declare t uuid;begin for t in select trip_id from public.companion_participant_migration_backups loop perform public.refresh_companion_participants(t);end loop;end $$;

-- Preserve the existing private destination/finance projection and enrich only attendee labels.
alter function public.get_participant_trip_view(uuid) rename to get_participant_trip_view_before_companion_labels;
revoke all on function public.get_participant_trip_view_before_companion_labels(uuid) from public,anon,authenticated;
create function public.get_participant_trip_view(target_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; confirmed jsonb;
begin
 result:=public.get_participant_trip_view_before_companion_labels(target_trip);
 select coalesce(jsonb_agg(jsonb_build_object('name',person->>'name','contributes',coalesce((person->>'contributes')::boolean,true),'is_companion',person ? 'companionId','responsible_name',case when person ? 'companionId' then (select p.display_name from public.event_companions ec join public.profiles p on p.id=ec.responsible_id where ec.id::text=person->>'companionId' and ec.trip_id=target_trip) end) order by ord),'[]') into confirmed from public.trip_snapshots s cross join lateral jsonb_array_elements(coalesce(s.payload->'people','[]')) with ordinality a(person,ord) where s.trip_id=target_trip and not coalesce((person->>'removedFromTrip')::boolean,false) and not exists(select 1 from public.trip_participants tp join public.trip_invites ti on ti.participant_id=tp.id where tp.trip_id=target_trip and tp.local_source_id=person->>'id' and ti.status in ('pending','expired'));
 return jsonb_set(result,'{shared_details,confirmed}',confirmed);
end $$;
revoke all on function public.get_participant_trip_view(uuid) from public,anon;
grant execute on function public.get_participant_trip_view(uuid) to authenticated;
