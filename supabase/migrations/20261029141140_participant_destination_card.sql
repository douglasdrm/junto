-- Share only explicit destination fields, never house notes, costs or contacts.
create or replace function public.get_participant_trip_view(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare shared jsonb; snapshot jsonb; details jsonb; photos jsonb;
begin
 shared:=public.get_participant_trip_view_base(target_trip);
 select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
 details:=coalesce(snapshot->'trip'->'destinationDetails','{}'::jsonb);
 select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into photos from (
  select value,ord from jsonb_array_elements(case when jsonb_typeof(details->'photos')='array' then details->'photos' else '[]'::jsonb end) with ordinality p(value,ord)
  where jsonb_typeof(value)='string' and length(value#>>'{}')<=600000 and (value#>>'{}')~*'^(https://|data:image/(jpeg|png|webp);base64,)' order by ord limit 6
 ) allowed_photos;
 return shared||jsonb_build_object('summary',public.get_trip_financial_summary(target_trip),'personal_report',public.get_my_trip_financial_report(target_trip),
 'destination_details',jsonb_build_object('name',left(coalesce(nullif(details->>'name',''),case when jsonb_array_length(coalesce(snapshot->'houses','[]'::jsonb))=1 then snapshot->'houses'->0->>'name' end,''),150),
 'address',left(coalesce(nullif(details->>'address',''),snapshot->'trip'->>'address',''),500),'photos',photos));
end $$;
