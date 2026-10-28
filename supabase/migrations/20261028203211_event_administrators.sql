-- Users may edit their contact details, never their platform administration flag.
revoke update on public.profiles from public,anon,authenticated;
grant update(display_name,phone,avatar_path,updated_at) on public.profiles to authenticated;

create function public.list_event_administrators(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid;
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 select organizer_id into owner_id from public.trips where id=target_trip;
 return jsonb_build_object('can_manage',auth.uid()=owner_id,
 'administrators',(select coalesce(jsonb_agg(jsonb_build_object('profile_id',p.id,'name',p.display_name,'email',u.email,'owner',p.id=owner_id,'can_remove',auth.uid()=owner_id and p.id<>owner_id) order by (p.id=owner_id) desc,p.display_name),'[]') from public.profiles p join auth.users u on u.id=p.id where p.id=owner_id or exists(select 1 from public.trip_access a where a.trip_id=target_trip and a.profile_id=p.id and a.role='organizer')),
 'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',invitee_email,'expired',expires_at<=now()) order by created_at desc),'[]') from public.trip_invites where trip_id=target_trip and role='organizer' and status='pending'));
end $$;

create function public.remove_event_administrator(target_trip uuid, target_profile uuid)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid; target_email text;
begin
 select organizer_id into owner_id from public.trips where id=target_trip for update;
 if auth.uid() is null or owner_id<>auth.uid() then raise exception 'only planning owner can remove administrators'; end if;
 if target_profile=owner_id then raise exception 'cannot remove planning owner'; end if;
 select lower(email) into target_email from auth.users where id=target_profile;
 delete from public.trip_access where trip_id=target_trip and profile_id=target_profile and role='organizer';
 update public.trip_invites set status='cancelled' where trip_id=target_trip and role='organizer' and status='pending' and lower(invitee_email)=target_email;
 -- Participant access and platform privileges are independent and stay unchanged.
end $$;

create function public.cancel_event_admin_invitation(target_trip uuid, invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_trip_organizer(target_trip) then raise exception 'access denied'; end if;
 update public.trip_invites set status='cancelled' where id=invitation_id and trip_id=target_trip and role='organizer' and status='pending';
end $$;
revoke all on function public.list_event_administrators(uuid),public.remove_event_administrator(uuid,uuid),public.cancel_event_admin_invitation(uuid,uuid) from public,anon;
grant execute on function public.list_event_administrators(uuid),public.remove_event_administrator(uuid,uuid),public.cancel_event_admin_invitation(uuid,uuid) to authenticated;
