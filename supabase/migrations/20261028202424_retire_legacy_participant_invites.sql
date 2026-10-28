-- A new link or self-link replaces earlier email invitations for the same person.
create or replace function public.create_participant_access_link(target_trip uuid, local_participant_id text)
returns text language plpgsql security definer set search_path='' as $$
declare participant public.trip_participants%rowtype; raw_token text;
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 select * into participant from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id and removed_at is null for update;
 if participant.id is null then raise exception 'participant not found'; end if;
 update public.trip_invites set status='cancelled' where participant_id=participant.id and status='pending';
 if exists(select 1 from public.member_profile_links where member_id=participant.member_id and status='active') then raise exception 'participant already linked'; end if;
 update public.participant_access_links set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where participant_id=participant.id and status in ('open','requested');
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.participant_access_links(trip_id,participant_id,token_hash,created_by) values(target_trip,participant.id,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid());
 return raw_token;
end $$;

create or replace function public.link_my_participant(target_trip uuid, local_participant_id text)
returns void language plpgsql security definer set search_path='' as $$
declare participant public.trip_participants%rowtype; existing_profile uuid;
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 select * into participant from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id and removed_at is null for update;
 if participant.id is null then raise exception 'participant not found'; end if;
 update public.trip_invites set status='cancelled' where participant_id=participant.id and status='pending';
 perform pg_advisory_xact_lock(hashtextextended(target_trip::text||':'||auth.uid()::text,0));
 perform 1 from public.group_members where id=participant.member_id for update;
 select profile_id into existing_profile from public.member_profile_links where member_id=participant.member_id;
 if existing_profile is not null and existing_profile<>auth.uid() then raise exception 'participant already linked'; end if;
 if exists(select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id where tp.trip_id=target_trip and tp.removed_at is null and tp.member_id<>participant.member_id and mpl.profile_id=auth.uid() and mpl.status='active') then raise exception 'account already linked to another participant'; end if;
 insert into public.member_profile_links(member_id,profile_id,status,authorized_by,linked_at) values(participant.member_id,auth.uid(),'active',auth.uid(),now()) on conflict(member_id) do update set status='active',authorized_by=excluded.authorized_by,linked_at=now();
 update public.participant_access_links set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where participant_id=participant.id and status in ('open','requested');
 -- Preserve the organizer role; this operation changes no money or attendance.
end $$;
