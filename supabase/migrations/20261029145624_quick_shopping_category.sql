create function public.set_shopping_item_category(target_trip uuid,item_id text,category text,expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; revision bigint; found_count integer; updated_items jsonb;
begin
 if auth.uid() is null or not public.is_trip_organizer(target_trip) then raise exception 'access denied';end if;
 if category is null or length(category)>60 then raise exception 'invalid category';end if;
 select s.payload,s.revision into snapshot,revision from public.trip_snapshots s where trip_id=target_trip for update;
 if revision is null or revision is distinct from expected_revision then raise exception 'sync conflict';end if;
 select count(*) into found_count from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]'::jsonb)) x where x->>'id'=item_id;
 if found_count<>1 then raise exception 'item not found or ambiguous';end if;
 select jsonb_agg(case when x->>'id'=item_id then x||jsonb_build_object('category',btrim(category)) else x end order by ord) into updated_items from jsonb_array_elements(snapshot->'shoppingItems') with ordinality a(x,ord);
 update public.trip_snapshots s set payload=jsonb_set(snapshot,'{shoppingItems}',updated_items),revision=s.revision+1,updated_by=auth.uid(),updated_at=now() where trip_id=target_trip;
 return revision+1;
end $$;
revoke all on function public.set_shopping_item_category(uuid,text,text,bigint) from public,anon;
grant execute on function public.set_shopping_item_category(uuid,text,text,bigint) to authenticated;
