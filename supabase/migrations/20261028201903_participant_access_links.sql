-- Individual access links bind an existing participant; they never add attendees.
create table public.participant_access_links (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 participant_id uuid not null references public.trip_participants(id) on delete cascade,
 token_hash text not null unique,
 status text not null default 'open' check(status in ('open','requested','approved','rejected','cancelled')),
 requested_by uuid references public.profiles(id),
 created_by uuid not null references public.profiles(id),
 reviewed_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 requested_at timestamptz,
 reviewed_at timestamptz
);
create index participant_access_links_trip_idx on public.participant_access_links(trip_id,status);
create index participant_access_links_participant_idx on public.participant_access_links(participant_id);
create index participant_access_links_requester_idx on public.participant_access_links(requested_by) where requested_by is not null;
create index participant_access_links_creator_idx on public.participant_access_links(created_by);
create index participant_access_links_reviewer_idx on public.participant_access_links(reviewed_by) where reviewed_by is not null;
alter table public.participant_access_links enable row level security;
revoke all on public.participant_access_links from public,anon,authenticated;

create function public.create_participant_access_link(target_trip uuid, local_participant_id text)
returns text language plpgsql security definer set search_path='' as $$
declare participant public.trip_participants%rowtype; raw_token text;
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 select * into participant from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id and removed_at is null for update;
 if participant.id is null then raise exception 'participant not found'; end if;
 if exists(select 1 from public.member_profile_links where member_id=participant.member_id and status='active') then raise exception 'participant already linked'; end if;
 update public.participant_access_links set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where participant_id=participant.id and status in ('open','requested');
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.participant_access_links(trip_id,participant_id,token_hash,created_by) values(target_trip,participant.id,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid());
 return raw_token;
end $$;

create function public.request_participant_access(raw_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.participant_access_links%rowtype; member uuid;
begin
 if not public.is_registered_user() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'confirmed account required'; end if;
 select * into link from public.participant_access_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') for update;
 if link.id is null or link.expires_at<=now() or link.status not in ('open','requested') then raise exception 'invalid or expired link'; end if;
 if link.requested_by is not null and link.requested_by<>auth.uid() then raise exception 'link already requested'; end if;
 select member_id into member from public.trip_participants where id=link.participant_id and trip_id=link.trip_id and removed_at is null;
 if member is null then raise exception 'participant no longer active'; end if;
 if exists(select 1 from public.member_profile_links where member_id=member and status='active') then raise exception 'participant already linked'; end if;
 update public.participant_access_links set requested_by=auth.uid(),requested_at=coalesce(requested_at,now()),status='requested' where id=link.id;
 return jsonb_build_object('status','requested');
end $$;

create function public.list_participant_access_links(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'participant_id',tp.local_source_id,'participant_name',gm.display_name,'status',l.status,'expired',l.expires_at<=now(),'requester_name',p.display_name,'requester_email',u.email) order by l.created_at desc),'[]'::jsonb)
 from public.participant_access_links l join public.trip_participants tp on tp.id=l.participant_id and tp.trip_id=l.trip_id join public.group_members gm on gm.id=tp.member_id left join public.profiles p on p.id=l.requested_by left join auth.users u on u.id=l.requested_by
 where l.trip_id=target_trip and l.status in ('open','requested') and tp.removed_at is null);
end $$;

create function public.review_participant_access_link(link_id uuid, approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare link public.participant_access_links%rowtype; participant public.trip_participants%rowtype; existing_profile uuid;
begin
 select * into link from public.participant_access_links where id=link_id for update;
 if link.id is null or not public.is_trip_organizer(link.trip_id) then raise exception 'access denied'; end if;
 if link.status not in ('open','requested') then raise exception 'request already reviewed'; end if;
 if not approve then
  update public.participant_access_links set status='rejected',reviewed_by=auth.uid(),reviewed_at=now() where id=link.id; return;
 end if;
 if link.status<>'requested' or link.requested_by is null or link.expires_at<=now() then raise exception 'request unavailable'; end if;
 if not exists(select 1 from auth.users where id=link.requested_by and email_confirmed_at is not null and not is_anonymous) then raise exception 'confirmed account required'; end if;
 select * into participant from public.trip_participants where id=link.participant_id and trip_id=link.trip_id and removed_at is null for update;
 if participant.id is null then raise exception 'participant no longer active'; end if;
 perform pg_advisory_xact_lock(hashtextextended(link.trip_id::text||':'||link.requested_by::text,0));
 -- Serialize competing links in the same group before checking ownership.
 perform 1 from public.group_members where id=participant.member_id for update;
 select profile_id into existing_profile from public.member_profile_links where member_id=participant.member_id;
 if existing_profile is not null and existing_profile<>link.requested_by then raise exception 'participant already linked'; end if;
 if exists(select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id where tp.trip_id=link.trip_id and tp.removed_at is null and tp.member_id<>participant.member_id and mpl.profile_id=link.requested_by and mpl.status='active') then raise exception 'account already linked to another participant'; end if;
 insert into public.member_profile_links(member_id,profile_id,status,authorized_by,linked_at) values(participant.member_id,link.requested_by,'active',auth.uid(),now()) on conflict(member_id) do update set status='active',authorized_by=excluded.authorized_by,linked_at=now();
 delete from public.trip_access_revocations where trip_id=link.trip_id and profile_id=link.requested_by;
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(link.trip_id,link.requested_by,'participant',auth.uid()) on conflict do nothing;
 update public.participant_access_links set status='approved',reviewed_by=auth.uid(),reviewed_at=now() where id=link.id;
 update public.participant_access_links set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where participant_id=participant.id and id<>link.id and status in ('open','requested');
end $$;

create function public.link_my_participant(target_trip uuid, local_participant_id text)
returns void language plpgsql security definer set search_path='' as $$
declare participant public.trip_participants%rowtype; existing_profile uuid;
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 select * into participant from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id and removed_at is null for update;
 if participant.id is null then raise exception 'participant not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(target_trip::text||':'||auth.uid()::text,0));
 perform 1 from public.group_members where id=participant.member_id for update;
 select profile_id into existing_profile from public.member_profile_links where member_id=participant.member_id;
 if existing_profile is not null and existing_profile<>auth.uid() then raise exception 'participant already linked'; end if;
 if exists(select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id where tp.trip_id=target_trip and tp.removed_at is null and tp.member_id<>participant.member_id and mpl.profile_id=auth.uid() and mpl.status='active') then raise exception 'account already linked to another participant'; end if;
 insert into public.member_profile_links(member_id,profile_id,status,authorized_by,linked_at) values(participant.member_id,auth.uid(),'active',auth.uid(),now()) on conflict(member_id) do update set status='active',authorized_by=excluded.authorized_by,linked_at=now();
 update public.participant_access_links set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where participant_id=participant.id and status in ('open','requested');
 -- Preserve the organizer role; this operation changes no money or attendance.
end $$;

revoke all on function public.create_participant_access_link(uuid,text),public.request_participant_access(text),public.list_participant_access_links(uuid),public.review_participant_access_link(uuid,boolean),public.link_my_participant(uuid,text) from public,anon;
grant execute on function public.create_participant_access_link(uuid,text),public.request_participant_access(text),public.list_participant_access_links(uuid),public.review_participant_access_link(uuid,boolean),public.link_my_participant(uuid,text) to authenticated;
