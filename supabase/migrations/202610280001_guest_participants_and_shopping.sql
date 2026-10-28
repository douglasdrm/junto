begin;

create or replace function public.get_participant_trip_view(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  snapshot jsonb; source_trip jsonb; public_trip jsonb;
  collected bigint:=0; spent bigint:=0; planned bigint:=0; budget bigint:=0;
  expense_spent bigint:=0; expense_planned bigint:=0;
  shopping_spent bigint:=0; shopping_planned bigint:=0;
  confirmed_payers integer:=0; split_total bigint:=0; participant_count integer:=0; shopping_year integer; has_market_total boolean:=false;
begin
  if not exists(
    select 1 from public.trip_access
    where trip_id=target_trip and profile_id=auth.uid()
      and role in ('participant','financial_responsible')
  ) then raise exception 'access denied'; end if;

  select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
  if snapshot is null then raise exception 'trip not found'; end if;
  source_trip:=snapshot->'trip';
  public_trip:=jsonb_build_object(
    'contributionMode',coalesce(source_trip->'contributionPlan'->>'mode',source_trip->>'contributionPreference','fund_first'),
    'name',source_trip->>'name','eventType',source_trip->>'eventType','region',source_trip->>'region',
    'start',source_trip->>'start','end',source_trip->>'end','guests',source_trip->'guests',
    'eventDate',source_trip->>'eventDate','eventStartTime',source_trip->>'eventStartTime','eventEndTime',source_trip->>'eventEndTime',
    'address',source_trip->>'address','addressComplement',source_trip->>'addressComplement',
    'fundraisingDeadline',source_trip->>'fundraisingDeadline','lifecycleStatus',source_trip->>'lifecycleStatus'
  );

  select count(*) into participant_count
  from jsonb_array_elements(coalesce(snapshot->'people','[]'::jsonb)) p
  where not coalesce((p->>'removedFromTrip')::boolean,false)
  and not exists(select 1 from public.trip_participants tp join public.trip_invites ti on ti.participant_id=tp.id
    where tp.trip_id=target_trip and tp.local_source_id=p->>'id' and ti.status in ('pending','expired'));

  select coalesce(sum(coalesce((p->>'amountCents')::bigint,0)),0) into collected
  from jsonb_array_elements(coalesce(snapshot->'payments','[]'::jsonb)) p;

  select
    coalesce(sum(coalesce((e->>'paidCents')::bigint,0)),0),
    coalesce(sum(coalesce((e->>'plannedCents')::bigint,0)),0),
    coalesce(bool_or(
      e->>'category'='mercado'
      and coalesce(e->>'marketPurchaseType','')<>'extra'
      and (coalesce((e->>'paidCents')::bigint,0)>0 or coalesce((e->>'plannedCents')::bigint,0)>0)
    ),false)
  into expense_spent,expense_planned,has_market_total
  from jsonb_array_elements(coalesce(snapshot->'expenses','[]'::jsonb)) e;

  shopping_year:=case
    when coalesce(snapshot->>'shoppingYear','')~'^[0-9]{4}$' then (snapshot->>'shoppingYear')::integer
    else (
      select max((item->>'year')::integer)
      from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]'::jsonb)) item
      where coalesce(item->>'year','')~'^[0-9]{4}$'
    )
  end;

  if not has_market_total and shopping_year is not null then
    select
      coalesce(sum(case when coalesce((item->>'purchased')::boolean,true) then
        case when item ? 'actualTotalCents' and item->>'actualTotalCents' is not null
          then coalesce((item->>'actualTotalCents')::bigint,0)
          else round(coalesce((item->>'quantity')::numeric,0)*coalesce((item->>'unitPriceCents')::numeric,0))::bigint
        end else 0 end),0),
      coalesce(sum(case when not coalesce((item->>'purchased')::boolean,true) then
        case when item ? 'actualTotalCents' and item->>'actualTotalCents' is not null
          then coalesce((item->>'actualTotalCents')::bigint,0)
          else round(coalesce((item->>'quantity')::numeric,0)*coalesce((item->>'unitPriceCents')::numeric,0))::bigint
        end else 0 end),0)
    into shopping_spent,shopping_planned
    from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]'::jsonb)) item
    where coalesce(item->>'year','')~'^[0-9]{4}$' and (item->>'year')::integer=shopping_year;
  end if;

  spent:=expense_spent+shopping_spent;
  planned:=expense_planned+shopping_spent+shopping_planned;
  budget:=case
    when source_trip->'contributionPlan'->>'mode'='cost_split'
      and source_trip->'contributionPlan'->>'costSource'='finance'
      then planned
    when source_trip ? 'totalBudgetCents' then coalesce((source_trip->>'totalBudgetCents')::bigint,0)
    else coalesce((source_trip->>'budgetCents')::bigint,0)+coalesce((source_trip->>'extrasCents')::bigint,0)
  end;

  select count(*) into confirmed_payers
  from jsonb_array_elements(coalesce(snapshot->'people','[]'::jsonb)) p
  where not coalesce((p->>'removedFromTrip')::boolean,false)
    and coalesce((p->>'contributes')::boolean,true)
    and not exists(select 1 from public.trip_participants tp join public.trip_invites ti on ti.participant_id=tp.id
      where tp.trip_id=target_trip and tp.local_source_id=p->>'id' and ti.status in ('pending','expired'));
  split_total:=greatest(0,budget-coalesce((source_trip->'contributionPlan'->>'openingBalanceCents')::bigint,0));

  return jsonb_build_object(
     'trip_id',target_trip,'trip',public_trip,'participant_count',participant_count,
    'shared_details',jsonb_build_object(
      'confirmed',(select coalesce(jsonb_agg(jsonb_build_object('name',p->>'name')),'[]'::jsonb)
        from jsonb_array_elements(coalesce(snapshot->'people','[]'::jsonb)) p
        where not coalesce((p->>'removedFromTrip')::boolean,false)
        and not exists(select 1 from public.trip_participants tp join public.trip_invites ti on ti.participant_id=tp.id
          where tp.trip_id=target_trip and tp.local_source_id=p->>'id' and ti.status in ('pending','expired'))),
      'pending',(select coalesce(jsonb_agg(jsonb_build_object('name',p->>'name')),'[]'::jsonb)
        from jsonb_array_elements(coalesce(snapshot->'people','[]'::jsonb)) p
        where not coalesce((p->>'removedFromTrip')::boolean,false)
        and exists(select 1 from public.trip_participants tp join public.trip_invites ti on ti.participant_id=tp.id
          where tp.trip_id=target_trip and tp.local_source_id=p->>'id' and ti.status in ('pending','expired'))),
      'shopping',(select coalesce(jsonb_agg(jsonb_build_object(
        'name',item->>'name','quantity',item->'quantity','unit',item->>'unit',
        'purchased',coalesce((item->>'purchased')::boolean,true),
        'totalCents',coalesce((item->>'actualTotalCents')::numeric,round(coalesce((item->>'quantity')::numeric,0)*coalesce((item->>'unitPriceCents')::numeric,0)))
      )),'[]'::jsonb) from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]'::jsonb)) item
        where shopping_year is null or item->>'year'=shopping_year::text)
    ),
    'summary',jsonb_build_object(
      'split_total_cents',split_total,'confirmed_payer_count',confirmed_payers,
      'split_per_person_cents',case when confirmed_payers>0 then ceil(split_total::numeric/confirmed_payers)::bigint else null end,
      'budget_cents',budget,'collected_cents',collected,
      'spent_cents',spent,'planned_cents',planned,
      'remaining_cents',greatest(0,budget-collected)
    ),
    'updated_at',(select updated_at from public.trip_snapshots where trip_id=target_trip)
  );
end;
$$;

revoke all on function public.get_participant_trip_view(uuid) from public, anon;
grant execute on function public.get_participant_trip_view(uuid) to authenticated;
commit;
