-- One monetary projection from the organizer's persisted snapshot. Not a public API.
create function public.compute_trip_financials(snapshot jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 source jsonb:=snapshot->'trip'; plan jsonb:=coalesce(snapshot->'trip'->'contributionPlan','{}');
 months jsonb:=coalesce(plan->'months','[]'); mode text:=coalesce(plan->>'mode','fund_first');
 opening bigint; income bigint; returns bigint; expense_paid bigint; expense_planned bigint; shopping_paid bigint:=0; shopping_all bigint:=0;
 selected_year text; market_total boolean; payer_ids text[]; order_ids text[]; eligible text[]; n integer; count_payers integer; index_person integer;
 goals jsonb:='{}'; costs jsonb:='{}'; entry jsonb; amount bigint; cost bigint:=0; goal bigint; expected bigint; projected bigint; credit bigint; applied bigint; reduction bigint; person_id text; group_id text; yield_snapshot jsonb;
begin
 opening:=coalesce((plan->>'openingBalanceCents')::bigint,(source->>'carryoverBalanceCents')::bigint,0);
 select coalesce(sum((x->>'amountCents')::bigint),0) into income from jsonb_array_elements(coalesce(snapshot->'payments','[]')) x;
 select coalesce(sum((x->>'paidCents')::bigint),0),coalesce(sum((x->>'plannedCents')::bigint),0),coalesce(bool_or(x->>'category'='mercado' and coalesce(x->>'marketPurchaseType','')<>'extra' and (coalesce((x->>'paidCents')::bigint,0)<>0 or coalesce((x->>'plannedCents')::bigint,0)<>0)),false) into expense_paid,expense_planned,market_total from jsonb_array_elements(coalesce(snapshot->'expenses','[]')) x;
 select x into yield_snapshot from jsonb_array_elements(coalesce(snapshot->'fundSnapshots','[]')) x order by coalesce(x->>'date','') desc,coalesce(x->>'createdAt','') desc limit 1;
 returns:=(yield_snapshot->>'netYieldCents')::bigint;
 if returns is null then select coalesce(sum((x->>'amountCents')::bigint),0) into returns from jsonb_array_elements(coalesce(snapshot->'fundYields','[]')) x; end if;
 selected_year:=coalesce(snapshot->>'shoppingYear',(select max(x->>'year') from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x));
 if not market_total then
  select coalesce(sum(case when coalesce((x->>'purchased')::boolean,true) then round(coalesce((x->>'actualTotalCents')::numeric,(x->>'quantity')::numeric*(x->>'unitPriceCents')::numeric,0)) else 0 end),0),coalesce(sum(round(coalesce((x->>'actualTotalCents')::numeric,(x->>'quantity')::numeric*(x->>'unitPriceCents')::numeric,0))),0)
  into shopping_paid,shopping_all from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x where x->>'year'=selected_year;
 end if;
 select coalesce(array_agg(value),'{}') into order_ids from jsonb_array_elements_text(coalesce(plan->'participantOrder',plan->'participantIds','[]'));
 select coalesce(array_agg(p->>'id' order by coalesce(array_position(order_ids,p->>'id'),9999),ord),'{}') into payer_ids from jsonb_array_elements(coalesce(snapshot->'people','[]')) with ordinality x(p,ord)
 where not coalesce((p->>'removedFromTrip')::boolean,false) and coalesce((p->>'contributes')::boolean,true) and (jsonb_array_length(coalesce(plan->'participantIds','[]'))=0 or coalesce(plan->'participantIds','[]') ? (p->>'id') or coalesce((p->>'joinedByLink')::boolean,false));
 n:=cardinality(payer_ids); count_payers:=greatest(n,coalesce((plan->>'payerCount')::integer,0));
 foreach person_id in array payer_ids loop costs:=costs||jsonb_build_object(person_id,0); end loop;
 for entry in
  select jsonb_build_object('amount',coalesce((e->>'plannedCents')::bigint,0),'group',coalesce(e->>'consumptionGroupId','')) from jsonb_array_elements(coalesce(snapshot->'expenses','[]')) e
  union all
  select jsonb_build_object('amount',round(coalesce((s->>'actualTotalCents')::numeric,(s->>'quantity')::numeric*(s->>'unitPriceCents')::numeric,0)),'group',coalesce(s->>'consumptionGroupId','')) from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) s where not market_total and s->>'year'=selected_year
 loop
  amount:=greatest(0,(entry->>'amount')::bigint);group_id:=entry->>'group';eligible:=payer_ids;
  if group_id<>'' then select coalesce(array_agg(id order by ord),'{}') into eligible from jsonb_array_elements(coalesce(snapshot->'consumptionGroups','[]')) cg cross join lateral jsonb_array_elements_text(coalesce(cg->'personIds','[]')) with ordinality p(id,ord) where cg->>'id'=group_id and id=any(payer_ids); end if;
  if cardinality(eligible)>0 then cost:=cost+amount;for index_person in 1..cardinality(eligible) loop person_id:=eligible[index_person];costs:=jsonb_set(costs,array[person_id],to_jsonb((costs->>person_id)::bigint+amount/cardinality(eligible)+case when index_person<=amount%cardinality(eligible) then 1 else 0 end));end loop;end if;
 end loop;
 if mode='cost_split' then
  goal:=case when plan->>'costSource'='finance' then cost else coalesce((plan->>'goalCents')::bigint,0) end;expected:=greatest(0,goal-opening);projected:=goal;
  if plan->>'costSource'='finance' then
   goals:=costs;credit:=least(opening,cost);
   while credit>0 loop
    select coalesce(array_agg(id order by ord),'{}') into eligible from unnest(payer_ids) with ordinality p(id,ord) where (goals->>id)::bigint>0;
    exit when cardinality(eligible)=0;applied:=0;
    for index_person in 1..cardinality(eligible) loop person_id:=eligible[index_person];reduction:=least((goals->>person_id)::bigint,credit/cardinality(eligible)+case when index_person<=credit%cardinality(eligible) then 1 else 0 end);goals:=jsonb_set(goals,array[person_id],to_jsonb((goals->>person_id)::bigint-reduction));applied:=applied+reduction;end loop;
    exit when applied=0;credit:=credit-applied;
   end loop;
  elsif n>0 then for index_person in 1..n loop goals:=goals||jsonb_build_object(payer_ids[index_person],expected/n+case when index_person<=expected%n then 1 else 0 end);end loop;end if;
 else
  expected:=count_payers*coalesce((plan->>'monthlyCents')::bigint,0)*jsonb_array_length(months);projected:=opening+expected;
  foreach person_id in array payer_ids loop goals:=goals||jsonb_build_object(person_id,coalesce((plan->>'monthlyCents')::bigint,0)*jsonb_array_length(months));end loop;
 end if;
 return jsonb_build_object('budget_cents',projected,'collected_cents',income,'opening_balance_cents',opening,'yield_cents',returns,'spent_cents',expense_paid+shopping_paid,'planned_cents',expense_planned+shopping_all,'available_cents',opening+income+returns-expense_paid-shopping_paid,
 'remaining_cents',greatest(0,projected-opening-income-returns),'contribution_target_cents',expected,'remaining_contributions_cents',greatest(0,expected-income),'split_total_cents',expected,'confirmed_payer_count',n,'split_per_person_cents',case when n>0 then ceil(expected::numeric/n)::bigint end,'person_goals',goals);
end $$;
revoke all on function public.compute_trip_financials(jsonb) from public,anon,authenticated;

create function public.get_trip_financial_summary(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;
begin
 if auth.uid() is null or not public.can_access_trip(target_trip) then raise exception 'access denied'; end if;
 select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
 if snapshot is null then raise exception 'trip not found'; end if;
 return (public.compute_trip_financials(snapshot)-'person_goals')||jsonb_build_object('updated_at',(select updated_at from public.trip_snapshots where trip_id=target_trip));
end $$;

create function public.get_my_trip_financial_report(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; person_id text; person jsonb; mapping_count integer; financials jsonb; expected bigint; paid bigint; monthly_items jsonb:='[]'; history jsonb:='[]'; months jsonb; month text; month_index integer; target bigint; month_paid bigint; due bigint:=0; current_month text:=to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM'); payment jsonb; amount bigint; payment_months jsonb;
begin
 if auth.uid() is null or not public.can_access_trip(target_trip) then raise exception 'access denied'; end if;
 select count(*),min(tp.local_source_id) into mapping_count,person_id from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.profile_id=auth.uid() and mpl.status='active' where tp.trip_id=target_trip and tp.removed_at is null;
 if mapping_count=0 then return jsonb_build_object('available',false,'reason','participant_not_linked'); end if;
 if mapping_count<>1 then raise exception 'ambiguous participant link'; end if;
 select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
 select p into person from jsonb_array_elements(coalesce(snapshot->'people','[]')) p where p->>'id'=person_id and not coalesce((p->>'removedFromTrip')::boolean,false);
 if person is null then return jsonb_build_object('available',false,'reason','participant_not_found'); end if;
 financials:=public.compute_trip_financials(snapshot);expected:=coalesce((financials->'person_goals'->>person_id)::bigint,0);paid:=0;
 for payment in select value from jsonb_array_elements(coalesce(snapshot->'payments','[]')) loop
  select coalesce(sum((a->>'amountCents')::bigint),0) into amount from jsonb_array_elements(coalesce(payment->'allocations','[]')) a where a->>'participantId'=person_id;
  if amount>0 then
   paid:=paid+amount;
   select coalesce(jsonb_agg(distinct coalesce(a->>'referenceMonth',payment->>'referenceMonth')) filter(where coalesce(a->>'referenceMonth',payment->>'referenceMonth') is not null),'[]') into payment_months
   from jsonb_array_elements(case when jsonb_array_length(coalesce(payment->'monthAllocations','[]'))>0 then payment->'monthAllocations' else coalesce(payment->'allocations','[]') end) a where a->>'participantId'=person_id;
   history:=history||jsonb_build_array(jsonb_build_object('date',payment->>'date','amount_cents',amount,'months',payment_months));
  end if;
 end loop;
 months:=coalesce(snapshot->'trip'->'contributionPlan'->'months','[]');
 if jsonb_array_length(months)>0 then for month_index in 0..jsonb_array_length(months)-1 loop
  month:=months->>month_index;target:=expected/jsonb_array_length(months)+case when month_index<expected%jsonb_array_length(months) then 1 else 0 end;
  select coalesce(sum((a->>'amountCents')::bigint),0) into month_paid from jsonb_array_elements(coalesce(snapshot->'payments','[]')) p cross join lateral jsonb_array_elements(case when jsonb_array_length(coalesce(p->'monthAllocations','[]'))>0 then p->'monthAllocations' else coalesce(p->'allocations','[]') end) a where a->>'participantId'=person_id and coalesce(a->>'referenceMonth',p->>'referenceMonth')=month;
  monthly_items:=monthly_items||jsonb_build_array(jsonb_build_object('month',month,'expected_cents',target,'paid_cents',month_paid,'remaining_cents',greatest(0,target-month_paid)));
  if month<=current_month then due:=due+greatest(0,target-month_paid);end if;
 end loop;end if;
 return jsonb_build_object('available',true,'name',person->>'name','configured',snapshot->'trip' ? 'contributionPlan','contributes',coalesce((person->>'contributes')::boolean,true),'expected_cents',expected,'paid_cents',paid,'remaining_cents',greatest(0,expected-paid),'credit_cents',greatest(0,paid-expected),'due_remaining_cents',due,'installments',monthly_items,'payments',history,'updated_at',(select updated_at from public.trip_snapshots where trip_id=target_trip));
end $$;

-- Retain shared event details while replacing its incomplete money projection.
alter function public.get_participant_trip_view(uuid) rename to get_participant_trip_view_base;
revoke all on function public.get_participant_trip_view_base(uuid) from public,anon,authenticated;
create function public.get_participant_trip_view(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare shared jsonb;
begin
 shared:=public.get_participant_trip_view_base(target_trip);
 return shared||jsonb_build_object('summary',public.get_trip_financial_summary(target_trip),'personal_report',public.get_my_trip_financial_report(target_trip));
end $$;
revoke all on function public.get_trip_financial_summary(uuid),public.get_my_trip_financial_report(uuid),public.get_participant_trip_view(uuid) from public,anon;
grant execute on function public.get_trip_financial_summary(uuid),public.get_my_trip_financial_report(uuid),public.get_participant_trip_view(uuid) to authenticated;
