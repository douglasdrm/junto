CREATE OR REPLACE FUNCTION public.create_participant_access_link(target_trip uuid, local_participant_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare participant public.trip_participants%rowtype; raw_token text;
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 select * into participant from public.trip_participants where trip_id=target_trip and local_source_id=local_participant_id and removed_at is null for update;
 if participant.id is null then raise exception 'participant not found'; end if;
 update public.trip_invites set status='cancelled' where participant_id=participant.id and status='pending';
 if exists(select 1 from public.member_profile_links where member_id=participant.member_id and status='active') then
  if exists(select 1 from public.member_profile_links mpl join public.trip_access a on a.profile_id=mpl.profile_id and a.trip_id=target_trip and a.role in ('participant','financial_responsible','organizer')
   where mpl.member_id=participant.member_id and mpl.status='active'
   and not exists(select 1 from public.trip_access_revocations r where r.trip_id=target_trip and r.profile_id=mpl.profile_id)) then
   raw_token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into public.participant_access_links(trip_id,participant_id,token_hash,created_by,status,requested_by,requested_at,reviewed_by,reviewed_at)
   select target_trip,participant.id,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid(),'approved',mpl.profile_id,now(),auth.uid(),now()
   from public.member_profile_links mpl join public.trip_access a on a.profile_id=mpl.profile_id and a.trip_id=target_trip
   where mpl.member_id=participant.member_id and mpl.status='active'
   and not exists(select 1 from public.trip_access_revocations r where r.trip_id=target_trip and r.profile_id=mpl.profile_id)
   limit 1;
   return raw_token;
  end if;
 end if;
 update public.participant_access_links set status='cancelled',reviewed_by=auth.uid(),reviewed_at=now() where participant_id=participant.id and status in ('open','requested');
 raw_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.participant_access_links(trip_id,participant_id,token_hash,created_by) values(target_trip,participant.id,encode(extensions.digest(raw_token,'sha256'),'hex'),auth.uid());
 return raw_token;
end $function$;

CREATE OR REPLACE FUNCTION public.request_participant_access(raw_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare link public.participant_access_links%rowtype; member uuid;
begin
 if not public.is_registered_user() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'confirmed account required'; end if;
 select * into link from public.participant_access_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') for update;
 if link.id is null or link.expires_at<=now() or link.status not in ('open','requested') then raise exception 'invalid or expired link'; end if;
 if link.requested_by is not null and link.requested_by<>auth.uid() then raise exception 'link already requested'; end if;
 select member_id into member from public.trip_participants where id=link.participant_id and trip_id=link.trip_id and removed_at is null;
 if member is null then raise exception 'participant no longer active'; end if;
 if exists(select 1 from public.member_profile_links where member_id=member and status='active' and profile_id<>auth.uid()) then raise exception 'participant already linked'; end if;
 update public.participant_access_links set requested_by=auth.uid(),requested_at=coalesce(requested_at,now()),status='requested' where id=link.id;
 return jsonb_build_object('status','requested');
end $function$
