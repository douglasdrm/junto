begin;
-- Organizer-only read access to invitation responses; no attendance or financial changes.
create or replace function public.list_trip_invitation_responses(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_registered_user() or not public.is_trip_organizer(target_trip) then raise exception 'access denied';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',coalesce(nullif(p.display_name,''),'Convidado'),'response',r.response,'updated_at',r.updated_at) order by r.updated_at desc),'[]'::jsonb)
 from public.trip_invitation_responses r join public.profiles p on p.id=r.profile_id join public.trip_join_links l on l.id=r.join_link_id
 where r.trip_id=target_trip
 and not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=r.profile_id and not(v.reason='participant_removed' and v.revoked_at<l.created_at))
 and (r.response<>'accepted' or not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=r.profile_id)));
end $$;
revoke all on function public.list_trip_invitation_responses(uuid) from public,anon;
grant execute on function public.list_trip_invitation_responses(uuid) to authenticated;
create or replace function public.list_my_admin_notifications()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_registered_user() then return '[]'::jsonb; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'type',q.kind,'trip_id',q.trip_id,'trip_name',q.trip_name,'participant_name',q.participant_name,'requester_name',q.requester_name,'requester_email',q.requester_email,'amount_cents',q.amount_cents,'created_at',q.created_at) order by q.created_at desc),'[]') from (
  select l.id,'access_request'::text kind,l.trip_id,t.name trip_name,gm.display_name participant_name,p.display_name requester_name,u.email::text requester_email,null::bigint amount_cents,coalesce(l.requested_at,l.created_at) created_at
  from public.participant_access_links l join public.trips t on t.id=l.trip_id join public.trip_participants tp on tp.id=l.participant_id and tp.trip_id=l.trip_id join public.group_members gm on gm.id=tp.member_id join public.profiles p on p.id=l.requested_by join auth.users u on u.id=l.requested_by
  where l.status='requested' and l.expires_at>now() and tp.removed_at is null and public.is_trip_organizer(l.trip_id)
  union all
  select b.id,'purchase_batch',b.trip_id,t.name,null,p.display_name,null,b.total_cents,b.updated_at
  from public.shopping_purchase_batches b join public.trips t on t.id=b.trip_id join public.profiles p on p.id=b.submitted_by where b.status='submitted' and public.is_trip_organizer(b.trip_id)
  union all
  select s.id,'purchase_item',s.trip_id,t.name,s.item_name,p.display_name,null,s.total_cents,s.created_at
  from public.shopping_purchase_submissions s join public.trips t on t.id=s.trip_id join public.profiles p on p.id=s.submitted_by where s.status='submitted' and s.batch_id is null and public.is_trip_organizer(s.trip_id)
  union all
  select r.id,'invitation_maybe',r.trip_id,t.name,null,p.display_name,null,null::bigint,r.updated_at
  from public.trip_invitation_responses r join public.trips t on t.id=r.trip_id join public.profiles p on p.id=r.profile_id join public.trip_join_links l on l.id=r.join_link_id
  where r.response='maybe' and public.is_trip_organizer(r.trip_id) and l.active and (l.expires_at is null or l.expires_at>now())
   and not exists(select 1 from public.trip_access_revocations v where v.trip_id=r.trip_id and v.profile_id=r.profile_id and not(v.reason='participant_removed' and v.revoked_at<l.created_at))
 ) q);
end $$;
revoke all on function public.list_my_admin_notifications() from public,anon;
grant execute on function public.list_my_admin_notifications() to authenticated;

commit;
