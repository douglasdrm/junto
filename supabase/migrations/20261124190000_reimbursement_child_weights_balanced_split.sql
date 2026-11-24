-- Regras financeiras (24/11/2026):
-- 1. Compra paga com dinheiro de quem comprou (paidFrom = personal) só conta como saída
--    paga quando o organizador confirma o reembolso (reimbursedAt); até lá é saída futura.
-- 2. Criança incluída como pagante paga meia cota (13 anos ou mais paga inteira), tanto
--    no rateio quanto no "juntar antes". Por padrão, crianças entram como não pagantes.
-- 3. Centavos do rateio são distribuídos de forma equilibrada entre os pagantes, para que
--    as cotas difiram no máximo em 1 centavo e somem exatamente o total.
-- Espelha a lógica do front em stage42-core.js (splitWeighted) e stage43.js.
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
 goals jsonb:='{}'; weights jsonb:='{}'; extras jsonb:='{}'; parts jsonb; ordered text[]; weight_sum bigint; rest bigint; cursor_index integer; monthly bigint; costs jsonb:='{}'; entry jsonb; amount bigint; cost bigint:=0; goal bigint; expected bigint; projected bigint; credit bigint; applied bigint; reduction bigint; person_id text; group_id text; yield_snapshot jsonb; receivables bigint:=0; participant_targets bigint:=0; person_paid bigint; overpaid bigint:=0; allocated bigint; future_expenses bigint; cash_in bigint;
begin
 opening:=coalesce((plan->>'openingBalanceCents')::bigint,(source->>'carryoverBalanceCents')::bigint,0);
 select coalesce(sum((x->>'amountCents')::bigint),0) into income from jsonb_array_elements(coalesce(snapshot->'payments','[]')) x;
 select coalesce(sum((x->>'paidCents')::bigint),0),coalesce(sum((x->>'plannedCents')::bigint),0),coalesce(bool_or(x->>'category'='mercado' and coalesce(x->>'marketPurchaseType','')<>'extra' and (coalesce((x->>'paidCents')::bigint,0)<>0 or coalesce((x->>'plannedCents')::bigint,0)<>0)),false) into expense_paid,expense_planned,market_total from jsonb_array_elements(coalesce(snapshot->'expenses','[]')) x;
 select x into yield_snapshot from jsonb_array_elements(coalesce(snapshot->'fundSnapshots','[]')) x order by coalesce(x->>'date','') desc,coalesce(x->>'createdAt','') desc limit 1;
 returns:=(yield_snapshot->>'netYieldCents')::bigint;
 if returns is null then select coalesce(sum((x->>'amountCents')::bigint),0) into returns from jsonb_array_elements(coalesce(snapshot->'fundYields','[]')) x; end if;
 selected_year:=coalesce(snapshot->>'shoppingYear',(select max(x->>'year') from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x));
 if not market_total then
  select coalesce(sum(case when coalesce((x->>'purchased')::boolean,true) and not (coalesce(x->>'paidFrom','')='personal' and coalesce(x->>'reimbursedAt','')='') then round(coalesce((x->>'actualTotalCents')::numeric,(x->>'quantity')::numeric*(x->>'unitPriceCents')::numeric,0)) else 0 end),0),coalesce(sum(round(coalesce((x->>'actualTotalCents')::numeric,(x->>'quantity')::numeric*(x->>'unitPriceCents')::numeric,0))),0)
  into shopping_paid,shopping_all from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x where x->>'year'=selected_year;
 end if;
 select coalesce(array_agg(value),'{}') into order_ids from jsonb_array_elements_text(coalesce(plan->'participantOrder',plan->'participantIds','[]'));
 select coalesce(array_agg(p->>'id' order by coalesce(array_position(order_ids,p->>'id'),9999),ord),'{}') into payer_ids from jsonb_array_elements(coalesce(snapshot->'people','[]')) with ordinality x(p,ord)
 where not coalesce((p->>'removedFromTrip')::boolean,false) and coalesce((p->>'contributes')::boolean,true) and (jsonb_array_length(coalesce(plan->'participantIds','[]'))=0 or coalesce(plan->'participantIds','[]') ? (p->>'id') or coalesce((p->>'joinedByLink')::boolean,false));
 n:=cardinality(payer_ids); count_payers:=greatest(n,coalesce((plan->>'payerCount')::integer,0));
 select coalesce(jsonb_object_agg(p->>'id',case when p->>'participantType'='child' and not coalesce(nullif(p->>'age','')::numeric>=13,false) then 1 else 2 end),'{}') into weights from jsonb_array_elements(coalesce(snapshot->'people','[]')) p where p->>'id'=any(payer_ids);
 foreach person_id in array payer_ids loop costs:=costs||jsonb_build_object(person_id,0); end loop;
 for entry in
  select jsonb_build_object('amount',coalesce((e->>'plannedCents')::bigint,0),'group',coalesce(e->>'consumptionGroupId','')) from jsonb_array_elements(coalesce(snapshot->'expenses','[]')) e
  union all
  select jsonb_build_object('amount',round(coalesce((s->>'actualTotalCents')::numeric,(s->>'quantity')::numeric*(s->>'unitPriceCents')::numeric,0)),'group',coalesce(s->>'consumptionGroupId','')) from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) s where not market_total and s->>'year'=selected_year
 loop
  amount:=greatest(0,(entry->>'amount')::bigint);group_id:=entry->>'group';eligible:=payer_ids;
  if group_id<>'' then select coalesce(array_agg(id order by ord),'{}') into eligible from (select id,min(ord) ord from jsonb_array_elements(coalesce(snapshot->'consumptionGroups','[]')) cg cross join lateral jsonb_array_elements_text(coalesce(cg->'personIds','[]')) with ordinality p(id,ord) where cg->>'id'=group_id and id=any(payer_ids) group by id) members; end if;
  if cardinality(eligible)>0 then
   cost:=cost+amount;parts:='{}';
   select coalesce(sum(coalesce((weights->>id)::bigint,2)),0) into weight_sum from unnest(eligible) id;
   if weight_sum>0 then
    foreach person_id in array eligible loop parts:=parts||jsonb_build_object(person_id,floor(amount::numeric*coalesce((weights->>person_id)::bigint,2)/weight_sum)::bigint);end loop;
    select amount-coalesce(sum(value::bigint),0) into rest from jsonb_each_text(parts);
    select coalesce(array_agg(id order by coalesce((extras->>id)::bigint,0),ord),'{}') into ordered from unnest(eligible) with ordinality e(id,ord) where coalesce((weights->>id)::bigint,2)>0;
    cursor_index:=1;
    while rest>0 and cardinality(ordered)>0 loop
     person_id:=ordered[cursor_index];parts:=jsonb_set(parts,array[person_id],to_jsonb((parts->>person_id)::bigint+1));extras:=jsonb_set(extras,array[person_id],to_jsonb(coalesce((extras->>person_id)::bigint,0)+1),true);rest:=rest-1;cursor_index:=cursor_index%cardinality(ordered)+1;
    end loop;
    foreach person_id in array eligible loop costs:=jsonb_set(costs,array[person_id],to_jsonb((costs->>person_id)::bigint+(parts->>person_id)::bigint));end loop;
   end if;
  end if;
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
  elsif n>0 then
   select coalesce(sum(coalesce((weights->>id)::bigint,2)),0) into weight_sum from unnest(payer_ids) id;
   foreach person_id in array payer_ids loop goals:=goals||jsonb_build_object(person_id,case when weight_sum>0 then floor(expected::numeric*coalesce((weights->>person_id)::bigint,2)/weight_sum)::bigint else 0 end);end loop;
   select expected-coalesce(sum(value::bigint),0) into rest from jsonb_each_text(goals);
   select coalesce(array_agg(id order by ord),'{}') into ordered from unnest(payer_ids) with ordinality e(id,ord) where coalesce((weights->>id)::bigint,2)>0;
   cursor_index:=1;
   while rest>0 and cardinality(ordered)>0 loop person_id:=ordered[cursor_index];goals:=jsonb_set(goals,array[person_id],to_jsonb((goals->>person_id)::bigint+1));rest:=rest-1;cursor_index:=cursor_index%cardinality(ordered)+1;end loop;
  end if;
 else
  monthly:=coalesce((plan->>'monthlyCents')::bigint,0);expected:=0;
  foreach person_id in array payer_ids loop goal:=round(monthly::numeric*coalesce((weights->>person_id)::bigint,2)/2)*jsonb_array_length(months);goals:=goals||jsonb_build_object(person_id,goal);expected:=expected+goal;end loop;
  projected:=opening+expected;
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
 'remaining_cents',receivables,'contribution_target_cents',expected,'remaining_contributions_cents',receivables,'participant_target_cents',participant_targets,'covered_contributions_cents',participant_targets-receivables,'overpaid_contributions_cents',overpaid,'unallocated_contributions_cents',greatest(0,income-allocated),'cash_in_cents',cash_in,'future_expenses_cents',future_expenses,'projected_balance_cents',cash_in-expense_paid-shopping_paid+receivables-future_expenses,'split_total_cents',expected,'confirmed_payer_count',n,'split_per_person_cents',(select max(value::bigint) from jsonb_each_text(goals) where coalesce((weights->>key)::bigint,2)=2),'reimbursable_cents',case when market_total then 0 else shopping_all-shopping_paid-(select coalesce(sum(round(coalesce((x->>'actualTotalCents')::numeric,(x->>'quantity')::numeric*(x->>'unitPriceCents')::numeric,0))),0) from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x where x->>'year'=selected_year and not coalesce((x->>'purchased')::boolean,true)) end,'person_goals',goals);
end $function$

