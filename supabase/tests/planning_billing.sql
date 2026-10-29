begin;
do $$
declare owner_id uuid; guest uuid; g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); catalog jsonb; context jsonb; n integer;
begin
 select id into owner_id from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) order by created_at limit 1;
 select id into guest from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) and id<>owner_id order by created_at limit 1;
 perform set_config('request.jwt.claim.sub','',true);
 catalog:=public.get_junto_plans();
 if (catalog->>'checkout_available')::boolean or jsonb_array_length(catalog->'plans')<>3 then raise exception 'catalog or launch switch incorrect';end if;
 if not exists(select 1 from jsonb_array_elements(catalog->'plans') p where p->>'code'='essential' and (p->>'price_cents')::int=990 and (p->>'participant_limit')::int=20) then raise exception 'essential price wrong';end if;
 if not exists(select 1 from jsonb_array_elements(catalog->'plans') p where p->>'code'='complete' and (p->>'price_cents')::int=1990 and p->>'participant_limit' is null) then raise exception 'complete price wrong';end if;
 begin perform public.get_planning_plan(t);raise exception 'anonymous context accepted';exception when others then if sqlerrm<>'access denied' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,owner_id,'Billing rollback fixture');
 insert into public.trips(id,group_id,organizer_id,name) values(t,g,owner_id,'Billing fixture');
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,owner_id,'organizer',owner_id),(t,guest,'participant',owner_id);
 context:=public.get_planning_plan(t);
 if context->>'mode'<>'evaluation' or not (context->>'can_purchase')::boolean or context->>'plan_code' is not null then raise exception 'evaluation silently restricted or paid entitlement fabricated';end if;
 perform set_config('request.jwt.claim.sub',guest::text,true);
 context:=public.get_planning_plan(t);
 if (context->>'can_purchase')::boolean then raise exception 'guest permitted to purchase for owner';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.get_planning_plan(t);raise exception 'outsider context accepted';exception when others then if sqlerrm<>'access denied' then raise;end if;end;
 if has_table_privilege('authenticated','public.planning_plan_entitlements','INSERT') or has_table_privilege('authenticated','public.planning_plan_entitlements','UPDATE') or has_table_privilege('authenticated','public.planning_plan_orders','INSERT') or has_table_privilege('authenticated','public.junto_billing_configuration','UPDATE') then raise exception 'client can grant paid access or enable billing';end if;
 if exists(select 1 from public.planning_plan_orders where trip_id=t) or exists(select 1 from public.planning_plan_entitlements where trip_id=t) then raise exception 'preview created a charge or changed access';end if;
end $$;
rollback;
