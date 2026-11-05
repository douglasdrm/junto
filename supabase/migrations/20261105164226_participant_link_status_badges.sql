-- Read-only indicators for organizers; never expose account IDs or financial data.
create function public.get_participant_link_status(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_trip_organizer(target_trip),false) then
  raise exception 'access denied' using errcode='42501';
 end if;
 return (
  select coalesce(jsonb_agg(jsonb_build_object(
   'participant_id',tp.local_source_id,
   'is_self',coalesce(mpl.profile_id=auth.uid(),false),
   'status',case
    when exists(select 1 from public.trip_access_revocations r where r.trip_id=tp.trip_id and (r.participant_id=tp.id or r.profile_id=mpl.profile_id)) then 'revoked'
    when mpl.profile_id is not null and exists(select 1 from public.trip_access a where a.trip_id=tp.trip_id and a.profile_id=mpl.profile_id) then 'linked'
    when l.status='requested' and l.expires_at>now() then 'requested'
    when (l.status='open' and l.expires_at>now()) or (i.status='pending' and i.expires_at>now()) then 'invited'
    when l.status in ('open','requested') or i.status='pending' then 'expired'
    else 'unlinked' end
  ) order by tp.created_at,tp.id),'[]'::jsonb)
  from public.trip_participants tp
  left join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.status='active'
  left join lateral (select x.status,x.expires_at from public.participant_access_links x where x.trip_id=tp.trip_id and x.participant_id=tp.id and x.status in ('open','requested') order by x.created_at desc,x.id desc limit 1) l on true
  left join lateral (select x.status,x.expires_at from public.trip_invites x where x.trip_id=tp.trip_id and x.participant_id=tp.id and x.status='pending' order by x.created_at desc,x.id desc limit 1) i on true
  where tp.trip_id=target_trip and tp.removed_at is null
 );
end $$;
revoke all on function public.get_participant_link_status(uuid) from public,anon;
grant execute on function public.get_participant_link_status(uuid) to authenticated;
