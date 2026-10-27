begin;

create or replace function public.get_participant_trip_view(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; source_trip jsonb; public_trip jsonb; collected bigint:=0; spent bigint:=0; planned bigint:=0; budget bigint:=0; participant_count integer:=0;
begin
  if not exists(select 1 from public.trip_access where trip_id=target_trip and profile_id=auth.uid() and role in ('participant','financial_responsible')) then raise exception 'access denied'; end if;
  select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
  if snapshot is null then raise exception 'trip not found'; end if;
  source_trip:=snapshot->'trip';
  public_trip:=jsonb_build_object(
    'name',source_trip->>'name','eventType',source_trip->>'eventType','region',source_trip->>'region',
    'start',source_trip->>'start','end',source_trip->>'end','guests',source_trip->'guests',
    'eventDate',source_trip->>'eventDate','eventStartTime',source_trip->>'eventStartTime','eventEndTime',source_trip->>'eventEndTime',
    'address',source_trip->>'address','addressComplement',source_trip->>'addressComplement',
    'fundraisingDeadline',source_trip->>'fundraisingDeadline','lifecycleStatus',source_trip->>'lifecycleStatus'
  );
  select count(*) into participant_count from jsonb_array_elements(coalesce(snapshot->'people','[]'::jsonb)) p where not coalesce((p->>'removedFromTrip')::boolean,false);
  select coalesce(sum(coalesce((p->>'amountCents')::bigint,0)),0) into collected from jsonb_array_elements(coalesce(snapshot->'payments','[]'::jsonb)) p;
  select coalesce(sum(coalesce((e->>'paidCents')::bigint,0)),0),coalesce(sum(coalesce((e->>'plannedCents')::bigint,0)),0) into spent,planned from jsonb_array_elements(coalesce(snapshot->'expenses','[]'::jsonb)) e;
  budget:=case when source_trip ? 'totalBudgetCents' then coalesce((source_trip->>'totalBudgetCents')::bigint,0) else coalesce((source_trip->>'budgetCents')::bigint,0)+coalesce((source_trip->>'extrasCents')::bigint,0) end;
  return jsonb_build_object('trip_id',target_trip,'trip',public_trip,'participant_count',participant_count,'summary',jsonb_build_object('budget_cents',budget,'collected_cents',collected,'spent_cents',spent,'planned_cents',planned,'remaining_cents',greatest(0,budget-collected)),'updated_at',(select updated_at from public.trip_snapshots where trip_id=target_trip));
end;
$$;

revoke all on function public.get_participant_trip_view(uuid) from public;
grant execute on function public.get_participant_trip_view(uuid) to authenticated;

commit;
