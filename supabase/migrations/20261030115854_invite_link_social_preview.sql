-- Token-scoped public metadata for messaging previews. Never accepts an invite.
create function public.get_invite_social_preview(raw_token text, link_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid; token_digest text; cover text; result jsonb;
begin
 if raw_token is null or raw_token!~'^[a-f0-9]{64}$' or link_kind not in ('join','access','invite') then
  return jsonb_build_object('status','invalid');
 end if;
 token_digest:=encode(extensions.digest(raw_token,'sha256'),'hex');
 if link_kind='join' then
  select l.trip_id into target from public.trip_join_links l
  where l.token_hash=token_digest and l.active and (l.expires_at is null or l.expires_at>now());
 end if;
 -- Legacy ?join= links may refer to individual access, resolved by the app too.
 if link_kind='access' or (link_kind='join' and target is null) then
  select l.trip_id into target from public.participant_access_links l
  join public.trip_participants p on p.id=l.participant_id and p.trip_id=l.trip_id
  where l.token_hash=token_digest and l.status in ('open','requested','approved')
   and l.expires_at>now() and p.removed_at is null;
 end if;
 if link_kind='invite' then
  select i.trip_id into target from public.trip_invites i
  join public.trip_participants p on p.id=i.participant_id and p.trip_id=i.trip_id
  where i.token_hash=token_digest and i.status='pending' and i.expires_at>now() and p.removed_at is null;
 end if;
 if target is null then return jsonb_build_object('status','invalid'); end if;
 select jsonb_build_object('status','available','name',left(t.name,150),
  'kind',case when t.event_type='trip' then 'viagem' else 'evento' end)
 into result from public.trips t where t.id=target;
 select s.payload->'trip'->>'coverImage' into cover from public.trip_snapshots s where s.trip_id=target;
 if cover is not null and length(cover)<=2000000 and cover~*'^(data:image/(png|jpeg|webp);base64,|https://)' then
  result:=result||jsonb_build_object('cover_image',cover);
 end if;
 return coalesce(result,jsonb_build_object('status','invalid'));
end $$;
revoke all on function public.get_invite_social_preview(text,text) from public;
grant execute on function public.get_invite_social_preview(text,text) to anon,authenticated;
comment on function public.get_invite_social_preview(text,text) is
 'Read-only title/type/cover for a valid unguessable invite token; excludes identity, address and financial data.';
