begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-avatars','profile-avatars',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_view_profile_avatar(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (
    split_part(object_name,'/',1)=auth.uid()::text
    or exists(
      select 1 from public.profiles p
      where p.avatar_path=object_name and p.id::text=split_part(object_name,'/',1) and exists(
        select 1 from public.trips t
        where (t.organizer_id=p.id or exists(select 1 from public.trip_access target_access where target_access.trip_id=t.id and target_access.profile_id=p.id))
          and (t.organizer_id=auth.uid() or exists(select 1 from public.trip_access viewer_access where viewer_access.trip_id=t.id and viewer_access.profile_id=auth.uid()))
      )
    )
  );
$$;
revoke all on function public.can_view_profile_avatar(text) from public,anon;
grant execute on function public.can_view_profile_avatar(text) to authenticated;

create policy profile_avatars_visible_to_shared_members on storage.objects for select to authenticated
using(bucket_id='profile-avatars' and public.can_view_profile_avatar(name));
create policy profile_avatars_own_insert on storage.objects for insert to authenticated
with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy profile_avatars_own_update on storage.objects for update to authenticated
using(bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check(bucket_id='profile-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.get_trip_visual_details(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; result jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from public.trips t where t.id=target_trip and
      (t.organizer_id=auth.uid() or exists(select 1 from public.trip_access a where a.trip_id=t.id and a.profile_id=auth.uid()))
  ) then raise exception 'access denied'; end if;
  select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
  if snapshot is null then raise exception 'trip not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',person->>'id','name',person->>'name',
    'avatar_path',(
      select profile.avatar_path from public.profiles profile
      where (
        profile.id::text=person->>'profileId'
        or exists(select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id
          where tp.trip_id=target_trip and tp.local_source_id=person->>'id' and tp.removed_at is null
            and mpl.profile_id=profile.id and mpl.status='active')
      ) and exists(select 1 from public.trips target where target.id=target_trip and
        (target.organizer_id=profile.id or exists(select 1 from public.trip_access a where a.trip_id=target_trip and a.profile_id=profile.id)))
      limit 1
    )
  )),'[]'::jsonb) into result
  from jsonb_array_elements(coalesce(snapshot->'people','[]'::jsonb)) person
  where not coalesce((person->>'removedFromTrip')::boolean,false)
    and not exists(select 1 from public.trip_participants tp join public.trip_invites ti on ti.participant_id=tp.id
      where tp.trip_id=target_trip and tp.local_source_id=person->>'id' and ti.status in ('pending','expired'));
  return jsonb_build_object('trip_id',target_trip,'cover_image',snapshot->'trip'->>'coverImage','members',result);
end;
$$;
revoke all on function public.get_trip_visual_details(uuid) from public,anon;
grant execute on function public.get_trip_visual_details(uuid) to authenticated;
commit;
