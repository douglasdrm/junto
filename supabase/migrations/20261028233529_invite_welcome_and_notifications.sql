-- Only a holder of the unguessable individual token can see this minimal greeting.
create function public.preview_participant_access_link(raw_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if raw_token is null or raw_token!~'^[0-9a-f]{64}$' then return jsonb_build_object('status','invalid'); end if;
 select case when l.expires_at<=now() then jsonb_build_object('status','expired')
  when l.status not in ('open','requested','approved') or tp.removed_at is not null then jsonb_build_object('status','invalid')
  else jsonb_build_object('status',l.status,'first_name',split_part(trim(gm.display_name),' ',1),'trip_name',t.name,'kind',case when t.event_type='trip' then 'viagem' else 'evento' end) end
 into result from public.participant_access_links l join public.trip_participants tp on tp.id=l.participant_id and tp.trip_id=l.trip_id join public.group_members gm on gm.id=tp.member_id join public.trips t on t.id=l.trip_id
 where l.token_hash=encode(extensions.digest(raw_token,'sha256'),'hex');
 return coalesce(result,jsonb_build_object('status','invalid'));
end $$;
revoke all on function public.preview_participant_access_link(text) from public;
grant execute on function public.preview_participant_access_link(text) to anon,authenticated;

create function public.list_my_admin_notifications()
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
 ) q);
end $$;
revoke all on function public.list_my_admin_notifications() from public,anon;
grant execute on function public.list_my_admin_notifications() to authenticated;
