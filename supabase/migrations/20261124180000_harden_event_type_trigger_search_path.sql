-- Alinha o único trigger security definer que ainda usava search_path = public
-- ao padrão do restante do projeto (search_path vazio). O corpo da função já
-- usa nomes totalmente qualificados (public.trips) e apenas funções de
-- pg_catalog (coalesce, now), então o comportamento não muda.
alter function public.sync_trip_event_type_from_snapshot() set search_path = '';
