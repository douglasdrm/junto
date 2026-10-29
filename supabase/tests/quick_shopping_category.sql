begin;
do $$
declare own uuid; guest uuid; g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); original jsonb:='{"trip":{"id":"local"},"shoppingItems":[{"id":"a","quantity":2,"unitPriceCents":399},{"id":"b","category":"Especial"}],"payments":[{"amountCents":12345}]}'; doc jsonb; rev bigint;
begin
 select id into own from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null order by created_at limit 1;
 select id into guest from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null and id<>own order by created_at limit 1;
 perform set_config('request.jwt.claim.sub',own::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,own,'Temporary categories test');
 insert into public.trips(id,group_id,organizer_id,name) values(t,g,own,'Temporary categories test');
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,own,'organizer',own),(t,guest,'participant',own);
 insert into public.trip_snapshots(trip_id,payload,revision,updated_by) values(t,original,1,own);
 perform set_config('request.jwt.claim.sub',guest::text,true);
 begin perform public.set_shopping_item_category(t,'a','Bebidas',1);raise exception 'guest edited category';exception when others then if sqlerrm<>'access denied' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',own::text,true);
 begin perform public.set_shopping_item_category(t,'a','Bebidas',0);raise exception 'stale category accepted';exception when others then if sqlerrm<>'sync conflict' then raise;end if;end;
 rev:=public.set_shopping_item_category(t,'a',' Mercearia ',1);
 select payload into doc from public.trip_snapshots where trip_id=t;
 if rev<>2 or doc->'shoppingItems'->0->>'category'<>'Mercearia' then raise exception 'category missing';end if;
 if ((doc->'shoppingItems'->0)-'category')<>(original->'shoppingItems'->0) or doc->'shoppingItems'->1<>original->'shoppingItems'->1 or doc->'payments'<>original->'payments' then raise exception 'other item data changed';end if;
 begin perform public.set_shopping_item_category(t,'missing','Limpeza',2);raise exception 'wrong item accepted';exception when others then if sqlerrm<>'item not found or ambiguous' then raise;end if;end;
end $$;
rollback;
