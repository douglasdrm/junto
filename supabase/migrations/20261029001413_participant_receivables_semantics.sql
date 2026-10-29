-- Outstanding contributions are the sum of each participant's unpaid balance.
-- Group cash, yield, unassigned money and someone else's credit never settle those balances.
CREATE OR REPLACE FUNCTION public.compute_trip_financials(snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
 source jsonb:=snapshot->'trip'; plan jsonb:=coalesce(snapshot->'trip'->'contributionPlan','{}');
 months jsonb:=coalesce(plan->'months','[]'); mode text:=coalesce(plan->>'mode','fund_first');
 opening bigint; income bigint; returns bigint; expense_paid bigint; expense_planned bigint; shopping_paid bigint:=0; shopping_all bigint:=0;
 selected_year text; market_total boolean; payer_ids text[]; order_ids text[]; eligible text[]; n integer; count_payers integer; index_person integer;
 goals jsonb:='{}'; costs jsonb:='{}'; entry jsonb; amount bigint; cost bigint:=0; goal bigint; expected bigint; projected bigint; credit bigint; applied bigint; reduction bigint; person_id text; group_id text; yield_snapshot jsonb; receivables bigint:=0; participant_targets bigint:=0; person_paid bigint; overpaid bigint:=0; allocated bigint; future_expenses bigint; cash_in bigint;
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
  if group_id<>'' then select coalesce(array_agg(id order by ord),'{}') into eligible from (select id,min(ord) ord from jsonb_array_elements(coalesce(snapshot->'consumptionGroups','[]')) cg cross join lateral jsonb_array_elements_text(coalesce(cg->'personIds','[]')) with ordinality p(id,ord) where cg->>'id'=group_id and id=any(payer_ids) group by id) members; end if;
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
 foreach person_id in array payer_ids loop
  select coalesce(sum((a->>'amountCents')::bigint),0) into person_paid
  from jsonb_array_elements(coalesce(snapshot->'payments','[]')) p
  cross join lateral jsonb_array_elements(coalesce(p->'allocations','[]')) a where a->>'participantId'=person_id;
  participant_targets:=participant_targets+coalesce((goals->>person_id)::bigint,0);
  receivables:=receivables+greatest(0,coalesce((goals->>person_id)::bigint,0)-person_paid);
  overpaid:=overpaid+greatest(0,person_paid-coalesce((goals->>person_id)::bigint,0));
 end loop;
 select coalesce(sum((a->>'amountCents')::bigint),0) into allocated from jsonb_array_elements(coalesce(snapshot->'payments','[]')) p cross join lateral jsonb_array_elements(coalesce(p->'allocations','[]')) a;
 future_expenses:=greatest(0,expense_planned-expense_paid)+shopping_all-shopping_paid;
 cash_in:=opening+income+returns;
 return jsonb_build_object('budget_cents',projected,'collected_cents',income,'opening_balance_cents',opening,'yield_cents',returns,'spent_cents',expense_paid+shopping_paid,'planned_cents',expense_planned+shopping_all,'available_cents',opening+income+returns-expense_paid-shopping_paid,
 'remaining_cents',receivables,'contribution_target_cents',expected,'remaining_contributions_cents',receivables,'participant_target_cents',participant_targets,'covered_contributions_cents',participant_targets-receivables,'overpaid_contributions_cents',overpaid,'unallocated_contributions_cents',greatest(0,income-allocated),'cash_in_cents',cash_in,'future_expenses_cents',future_expenses,'projected_balance_cents',cash_in-expense_paid-shopping_paid+receivables-future_expenses,'split_total_cents',expected,'confirmed_payer_count',n,'split_per_person_cents',case when n>0 then ceil(expected::numeric/n)::bigint end,'person_goals',goals);
end $function$

