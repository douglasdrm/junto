-- Mantém a classificação do planejamento alinhada ao snapshot local.
-- Registros antigos continuam como viagem; novos eventos usam celebration.
create or replace function public.sync_trip_event_type_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  local_type text := coalesce(new.payload->'trip'->>'eventType', 'trip');
begin
  update public.trips
  set event_type = case when local_type = 'event' then 'celebration' else 'trip' end,
      updated_at = now()
  where id = new.trip_id;
  return new;
end;
$$;

drop trigger if exists trip_snapshots_sync_event_type on public.trip_snapshots;
create trigger trip_snapshots_sync_event_type
after insert or update of payload on public.trip_snapshots
for each row execute function public.sync_trip_event_type_from_snapshot();

update public.trips as target
set event_type = case
  when coalesce(snapshot.payload->'trip'->>'eventType', 'trip') = 'event' then 'celebration'
  else 'trip'
end
from public.trip_snapshots as snapshot
where snapshot.trip_id = target.id;
