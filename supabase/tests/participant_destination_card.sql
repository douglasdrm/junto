begin;
do $$
declare own uuid; guest uuid; g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); result jsonb;
begin
 select id into own from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null order by created_at limit 1;
 select id into guest from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null and id<>own order by created_at limit 1;
 perform set_config('request.jwt.claim.sub',own::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,own,'Temporary destination card');
 insert into public.trips(id,group_id,organizer_id,name) values(t,g,own,'Temporary destination card');
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,own,'organizer',own),(t,guest,'participant',own);
 insert into public.trip_snapshots(trip_id,payload,revision,updated_by) values(t,'{"trip":{"id":"local","name":"Fixture","start":"2027-01-07","destinationDetails":{"name":"Casa fixture","address":"Rua fixture, 12","private_note":"do not share","photos":["https://example.com/house.jpg","javascript:alert(1)","data:image/jpeg;base64,AAA"]}},"payments":[],"people":[],"expenses":[],"houses":[{"name":"Private option","note":"private host contacts","price":90000}]}',1,own);
 perform set_config('request.jwt.claim.sub',guest::text,true);
 result:=public.get_participant_trip_view(t);
 if result->'destination_details'->>'address'<>'Rua fixture, 12' then raise exception 'destination missing';end if;
 if jsonb_array_length(result->'destination_details'->'photos')<>2 then raise exception 'unsafe photo not filtered';end if;
 if result::text like '%do not share%' or result::text like '%private host contacts%' then raise exception 'private data exposed';end if;
 if result->'summary'<>public.get_trip_financial_summary(t) then raise exception 'financial summary changed';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.get_participant_trip_view(t);raise exception 'outsider allowed';exception when others then if sqlerrm='outsider allowed' then raise;end if;end;
end $$;
rollback;
