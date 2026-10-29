begin;
do $$
declare own uuid; guest uuid; g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); doc jsonb; s jsonb; r jsonb; summary_admin jsonb; month_a text:=to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM'); month_b text:=to_char((now() at time zone 'America/Sao_Paulo')+interval '1 month','YYYY-MM');
begin
 select id into own from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null order by created_at limit 1;
 select id into guest from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null and id<>own order by created_at limit 1;
 if guest is null then raise exception 'two confirmed fixture accounts required';end if;
 perform set_config('request.jwt.claim.sub',own::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,own,'Temporary shared finance test');
 insert into public.trips(id,group_id,organizer_id,name) values(t,g,own,'Temporary shared finance test');
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,own,'organizer',own),(t,guest,'participant',own);
 insert into public.group_members(id,group_id,display_name,created_by) values(m,g,'Self fixture',own);
 insert into public.trip_participants(id,trip_id,member_id,local_source_id) values(p,t,m,'self');
 insert into public.member_profile_links(member_id,profile_id,status,authorized_by) values(m,guest,'active',own);
 doc:=jsonb_build_object('trip',jsonb_build_object('id',t,'contributionPlan',jsonb_build_object('mode','fund_first','openingBalanceCents',5000,'monthlyCents',10000,'payerCount',2,'participantIds',jsonb_build_array('self','other'),'participantOrder',jsonb_build_array('self','other'),'months',jsonb_build_array(month_a,month_b))),'shoppingYear',2026,
 'people',jsonb_build_array(jsonb_build_object('id','self','name','Self fixture','contributes',true),jsonb_build_object('id','other','name','OTHER PRIVATE NAME','contributes',true),jsonb_build_object('id','child','name','Child','contributes',false)),
 'payments',jsonb_build_array(jsonb_build_object('date','2026-10-01','payer','OTHER PRIVATE PAYER','note','OTHER PRIVATE NOTE','amountCents',8000,'referenceMonth',month_a,'allocations',jsonb_build_array(jsonb_build_object('participantId','self','amountCents',3000),jsonb_build_object('participantId','other','amountCents',5000))),jsonb_build_object('date','2026-10-02','amountCents',1000,'referenceMonth',month_a,'allocations',jsonb_build_array(jsonb_build_object('participantId','other','amountCents',1000)))),
 'expenses',jsonb_build_array(jsonb_build_object('plannedCents',2000,'paidCents',1000,'category','aluguel')),
 'shoppingItems',jsonb_build_array(jsonb_build_object('id','bought','year',2026,'quantity',1,'unitPriceCents',400,'purchased',true),jsonb_build_object('id','planned','year',2026,'quantity',1,'unitPriceCents',600,'purchased',false)),
 'fundSnapshots',jsonb_build_array(jsonb_build_object('date','2026-10-01','netYieldCents',900),jsonb_build_object('date','2026-10-02','netYieldCents',700)),
 'fundYields',jsonb_build_array(jsonb_build_object('amountCents',999999)));
 insert into public.trip_snapshots(trip_id,payload,revision,updated_by) values(t,doc,1,own);
 summary_admin:=public.get_trip_financial_summary(t);
 if summary_admin->>'budget_cents'<>'45000' or summary_admin->>'collected_cents'<>'9000' or summary_admin->>'yield_cents'<>'700' or summary_admin->>'available_cents'<>'13300' or summary_admin->>'remaining_cents'<>'30300' or summary_admin->>'remaining_contributions_cents'<>'31000' then raise exception 'shared summary formula mismatch: %',summary_admin;end if;
 if summary_admin ? 'person_goals' then raise exception 'other peoples goals exposed';end if;
 perform set_config('request.jwt.claim.sub',guest::text,true);
 if public.get_trip_financial_summary(t)<>summary_admin or public.get_participant_trip_view(t)->'summary'<>summary_admin then raise exception 'administrator and guest totals differ';end if;
 r:=public.get_my_trip_financial_report(t);
 if r->>'name'<>'Self fixture' or r->>'expected_cents'<>'20000' or r->>'paid_cents'<>'3000' or r->>'remaining_cents'<>'17000' or r->>'due_remaining_cents'<>'7000' then raise exception 'personal report totals wrong: %',r;end if;
 if jsonb_array_length(r->'payments')<>1 or r->'payments'->0->>'amount_cents'<>'3000' or r::text like '%OTHER PRIVATE%' then raise exception 'collective payment leaked other participants';end if;
 if r->'installments'->0->>'paid_cents'<>'3000' or r->'installments'->1->>'remaining_cents'<>'10000' then raise exception 'installment allocation wrong';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.get_my_trip_financial_report(t);raise exception 'unauthorized report allowed';exception when others then if sqlerrm='unauthorized report allowed' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',own::text,true);
 r:=public.get_my_trip_financial_report(t);
 if r->>'available'<>'false' then raise exception 'organizer automatically received another persons report';end if;
 -- Cost split mirrors the existing allocation engine, including consumption groups and opening credit.
 doc:=jsonb_set(doc,'{trip,contributionPlan}',jsonb_build_object('mode','cost_split','costSource','finance','openingBalanceCents',1,'participantIds',jsonb_build_array('self','other'),'months',jsonb_build_array(month_a)));
 doc:=jsonb_set(doc,'{expenses}',jsonb_build_array(jsonb_build_object('plannedCents',10001,'paidCents',0,'consumptionGroupId','group')));
 doc:=jsonb_set(doc,'{shoppingItems}','[]'::jsonb);
 doc:=doc||jsonb_build_object('consumptionGroups',jsonb_build_array(jsonb_build_object('id','group','personIds',jsonb_build_array('self','self','other'))));
 s:=public.compute_trip_financials(doc);
 if s->>'budget_cents'<>'10001' or s->'person_goals'->>'self'<>'5000' or s->'person_goals'->>'other'<>'5000' then raise exception 'consumption group/opening credit mismatch';end if;
 -- A general market total replaces itemized market charges, without counting them twice.
 doc:=jsonb_set(doc,'{expenses}',jsonb_build_array(jsonb_build_object('plannedCents',2000,'paidCents',1500,'category','mercado')));
 doc:=jsonb_set(doc,'{shoppingItems}',jsonb_build_array(jsonb_build_object('year',2026,'actualTotalCents',9000,'purchased',true)));
 s:=public.compute_trip_financials(doc);if s->>'spent_cents'<>'1500' or s->>'planned_cents'<>'2000' then raise exception 'market double counted';end if;
 if has_function_privilege('anon','public.get_my_trip_financial_report(uuid)','execute') or has_function_privilege('authenticated','public.compute_trip_financials(jsonb)','execute') or has_function_privilege('authenticated','public.get_participant_trip_view_base(uuid)','execute') then raise exception 'private financial function exposed';end if;
end $$;
rollback;
select 'PASS: administrator/participant summary parity, initial balance and latest yield, no duplicate market cost, own payment allocations only, future/current installments, consumption groups, exact cents and access isolation; fixtures rolled back' as result;
