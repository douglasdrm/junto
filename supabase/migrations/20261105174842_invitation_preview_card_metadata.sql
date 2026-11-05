-- Read-only preview metadata. Does not restore access or change invitation acceptance.
create or replace function public.preview_event_invitation(raw_token text default null,saved_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare link public.trip_join_links%rowtype; details jsonb; result jsonb;
begin
 if saved_id is not null then
  select l.* into link from public.trip_invitation_responses r join public.trip_join_links l on l.id=r.join_link_id
  where r.id=saved_id and r.profile_id=auth.uid();
 else
  select * into link from public.trip_join_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') and active and (expires_at is null or expires_at>now());
 end if;
 if link.id is null then return jsonb_build_object('status','invalid'); end if;
 select payload->'trip' into details from public.trip_snapshots where trip_id=link.trip_id;
 select jsonb_build_object('status','available','name',left(t.name,150),'kind',case when t.event_type='trip' then 'Viagem' else 'Evento' end,
 'date',coalesce(details->>'eventDate',details->>'start',t.starts_on::text),'end_date',coalesce(details->>'end',t.ends_on::text),
 'time',details->>'eventStartTime','region',left(details->>'region',200),
 'can_respond',link.active and (link.expires_at is null or link.expires_at>now()) and not exists(select 1 from public.trip_access_revocations where trip_id=link.trip_id and profile_id=auth.uid()))
 into result from public.trips t where t.id=link.trip_id;
 if length(details->>'coverImage')<=2000000 and details->>'coverImage' ~* '^(data:image/(png|jpeg|webp);base64,|https://)' then
  result:=result||jsonb_build_object('cover_image',details->>'coverImage');
 end if;
 result:=result||jsonb_build_object('participant_count',(select count(*) from public.trip_participants where trip_id=link.trip_id and removed_at is null),'participant_initials',(select coalesce(jsonb_agg(initial),'[]'::jsonb) from (select upper(left(coalesce(nullif(p.settings->>'name',''),m.display_name,'?'),1)) as initial from public.trip_participants p join public.group_members m on m.id=p.member_id where p.trip_id=link.trip_id and p.removed_at is null order by p.id limit 5) initials),'response_blocked',exists(select 1 from public.trip_access_revocations where trip_id=link.trip_id and profile_id=auth.uid()));
 return coalesce(result,jsonb_build_object('status','invalid'));
end $$;
revoke all on function public.preview_event_invitation(text,uuid) from public;
grant execute on function public.preview_event_invitation(text,uuid) to anon,authenticated;

