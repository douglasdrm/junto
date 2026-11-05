-- Apply only with the permanent-account invitation client release. Prepared, not applied.
create or replace function public.accept_trip_join_link(raw_token text,display_name text,phone text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link_id uuid;
begin
 select id into link_id from public.trip_join_links where token_hash=encode(extensions.digest(raw_token,'sha256'),'hex') and active and (expires_at is null or expires_at>now());
 if link_id is null then raise exception 'invalid join link'; end if;
 return public.accept_registered_join_link_id(link_id,display_name,phone);
end $$;
revoke all on function public.accept_trip_join_link(text,text,text) from public,anon;
grant execute on function public.accept_trip_join_link(text,text,text) to authenticated;

