begin;
do $$
declare owner_id uuid; guest uuid; g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); other_trip uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); other_item uuid:=gen_random_uuid();
begin
 select id into owner_id from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) order by created_at limit 1;
 select id into guest from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) and id<>owner_id order by created_at limit 1;
 if guest is null then raise exception 'two test identities required';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,owner_id,'Deletion rollback fixture');
 insert into public.trips(id,group_id,organizer_id,name,event_type) values(t,g,owner_id,'Deletion fixture','celebration'),(other_trip,g,owner_id,'Preserved fixture','celebration');
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,owner_id,'organizer',owner_id),(t,guest,'organizer',owner_id);
 insert into public.event_companions(id,trip_id,responsible_id,name,kind) values(c,t,owner_id,'Companion fixture','adult'),(other_c,other_trip,owner_id,'Other companion','adult');
 insert into public.event_potluck_settings(trip_id,mode) values(t,'potluck'),(other_trip,'potluck');
 insert into public.event_potluck_items(id,trip_id,name,quantity,unit,created_by,from_list) values(item,t,'Dish fixture',1,'unidade',owner_id,true),(other_item,other_trip,'Preserved dish',1,'unidade',owner_id,true);
 insert into public.event_potluck_claims(item_id,profile_id,quantity,scope,label,companion_id) values(item,owner_id,1,'person','Companion fixture',c),(other_item,owner_id,1,'person','Other companion',other_c);
 -- Individual removal is still restricted, independent of full-event deletion.
 begin delete from public.event_companions where id=c;raise exception 'companion protection lost';exception when foreign_key_violation then null;end;
 perform set_config('request.jwt.claim.sub',guest::text,true);
 begin perform public.delete_owned_trip(t);raise exception 'co-admin deletion accepted';exception when others then if sqlerrm<>'only the trip owner can delete this planning' then raise;end if;end;
 if not exists(select 1 from public.event_potluck_claims where item_id=item) then raise exception 'unauthorized attempt removed claims';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.delete_owned_trip(t);raise exception 'anonymous deletion accepted';exception when others then if sqlerrm<>'authentication required' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.delete_owned_trip(t);
 if exists(select 1 from public.trips where id=t) or exists(select 1 from public.event_companions where trip_id=t) or exists(select 1 from public.event_potluck_claims where item_id=item) then raise exception 'event cascade incomplete';end if;
 if not exists(select 1 from public.trips where id=other_trip) or not exists(select 1 from public.event_potluck_claims where item_id=other_item) or not exists(select 1 from public.event_companions where id=other_c) then raise exception 'another event was changed';end if;
 if not exists(select 1 from public.travel_groups where id=g) then raise exception 'permanent group removed';end if;
 if has_function_privilege('anon','public.delete_owned_trip(uuid)','EXECUTE') then raise exception 'anonymous API exposed';end if;
end $$;
rollback;
