create table public.shopping_purchase_batches (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 submitted_by uuid not null references public.profiles(id),
 status text not null default 'draft' check(status in ('draft','submitted','confirmed','rejected')),
 items jsonb not null default '[]' check(jsonb_typeof(items)='array'),
 revision integer not null default 1,
 store_name text not null default '' check(length(store_name)<=100),
 purchased_on date,
 paid_from text check(paid_from in ('personal','fund')),
 total_cents bigint,
 receipt_path text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz
);
create unique index one_market_draft_per_account on public.shopping_purchase_batches(trip_id,submitted_by) where status='draft';
create index shopping_batches_author_idx on public.shopping_purchase_batches(submitted_by);
create index shopping_batches_reviewer_idx on public.shopping_purchase_batches(reviewed_by);
alter table public.shopping_purchase_batches enable row level security;
revoke all on public.shopping_purchase_batches from public,anon,authenticated;
alter table public.shopping_purchase_submissions add column batch_id uuid references public.shopping_purchase_batches(id) on delete cascade;
create index shopping_submissions_batch_idx on public.shopping_purchase_submissions(batch_id);

-- Keep single-item history working, but require reviewing a grouped purchase as a whole.
alter function public.review_shopping_purchase(uuid,boolean) rename to review_shopping_purchase_item;
revoke all on function public.review_shopping_purchase_item(uuid,boolean) from public,anon,authenticated;
create function public.review_shopping_purchase(submission_id uuid, approve boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.shopping_purchase_submissions s where s.id=submission_id and public.is_trip_organizer(s.trip_id)) then raise exception 'access denied'; end if;
 if exists(select 1 from public.shopping_purchase_submissions where id=submission_id and batch_id is not null) then raise exception 'review the complete purchase'; end if;
 perform public.review_shopping_purchase_item(submission_id,approve);
end $$;

create function public.get_market_purchase_workspace(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare workspace jsonb; organizer boolean;
begin
 if not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied'; end if;
 organizer:=public.is_trip_organizer(target_trip);
 workspace:=public.get_shopping_purchase_workspace(target_trip);
 workspace:=jsonb_set(workspace,'{submissions}',(select coalesce(jsonb_agg(s),'[]') from jsonb_array_elements(workspace->'submissions') s where not exists(select 1 from public.shopping_purchase_submissions p where p.id::text=s->>'id' and p.batch_id is not null)));
 return workspace||jsonb_build_object('batches',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'status',b.status,'items',b.items,'revision',b.revision,'store_name',b.store_name,'purchased_on',b.purchased_on,'paid_from',b.paid_from,'total_cents',b.total_cents,'receipt_path',b.receipt_path,'own',b.submitted_by=auth.uid(),'buyer_name',p.display_name) order by b.updated_at desc),'[]')
 from public.shopping_purchase_batches b join public.profiles p on p.id=b.submitted_by where b.trip_id=target_trip and (b.submitted_by=auth.uid() or organizer and b.status<>'draft')));
end $$;

create function public.start_market_purchase(target_trip uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid;
begin
 if not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied'; end if;
 insert into public.shopping_purchase_batches(trip_id,submitted_by) values(target_trip,auth.uid())
 on conflict(trip_id,submitted_by) where status='draft' do update set submitted_by=excluded.submitted_by returning id into batch;
 return batch;
end $$;

create function public.save_market_purchase_item(batch_id uuid, item jsonb, expected_revision integer)
returns integer language plpgsql security definer set search_path='' as $$
declare batch public.shopping_purchase_batches%rowtype; snapshot jsonb; normalized jsonb; next_items jsonb; quantity numeric; amount bigint; item_key text; source_id text; source_item jsonb;
begin
 select * into batch from public.shopping_purchase_batches where id=batch_id for update;
 if batch.id is null or batch.submitted_by<>auth.uid() or not public.can_submit_trip_purchase(batch.trip_id) then raise exception 'access denied'; end if;
 if batch.status<>'draft' then raise exception 'purchase already finalized'; end if;
 if batch.revision<>expected_revision then raise exception 'draft changed; refresh before saving'; end if;
 item_key:=item->>'id'; source_id:=nullif(item->>'source_item_id',''); quantity:=(item->>'quantity')::numeric; amount:=(item->>'total_cents')::bigint;
 if coalesce(length(item_key),0) not between 1 and 100 or coalesce(length(trim(item->>'name')),0) not between 1 and 100 or quantity is null or quantity<=0 or quantity>100000 or amount is null or amount<0 or amount>1000000000 or length(coalesce(item->>'unit',''))>80 then raise exception 'invalid item'; end if;
 if source_id is not null then
  select payload into snapshot from public.trip_snapshots where trip_id=batch.trip_id;
  select x into source_item from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x where x->>'id'=source_id and x->>'year'=coalesce(snapshot->>'shoppingYear',(select max(y->>'year') from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) y));
  if source_item is null then raise exception 'shopping item no longer available'; end if;
 end if;
 normalized:=jsonb_build_object('id',item_key,'source_item_id',source_id,'source_purchased',case when source_id is null then false else coalesce((source_item->>'purchased')::boolean,true) end,'name',trim(item->>'name'),'quantity',quantity,'unit',coalesce(item->>'unit',''),'total_cents',amount,'picked',coalesce((item->>'picked')::boolean,true));
 select coalesce(jsonb_agg(x),'[]') into next_items from jsonb_array_elements(batch.items) x where x->>'id'<>item_key and (source_id is null or coalesce(x->>'source_item_id','')<>source_id);
 if jsonb_array_length(next_items)>=500 then raise exception 'too many items'; end if;
 update public.shopping_purchase_batches set items=next_items||jsonb_build_array(normalized),revision=revision+1,updated_at=now() where id=batch.id;
 return batch.revision+1;
end $$;

create function public.finalize_market_purchase(batch_id uuid, expected_revision integer, store_name text, purchase_date date, funds_source text, invoice_total bigint, receipt_object text default null)
returns text language plpgsql security definer set search_path='' as $$
declare batch public.shopping_purchase_batches%rowtype; item jsonb; total bigint; count_items integer; submission uuid; organizer boolean; new_status text; snapshot jsonb;
begin
 select * into batch from public.shopping_purchase_batches where id=batch_id for update;
 if batch.id is null or batch.submitted_by<>auth.uid() or not public.can_submit_trip_purchase(batch.trip_id) then raise exception 'access denied'; end if;
 if batch.status<>'draft' then raise exception 'purchase already finalized'; end if;
 if batch.revision<>expected_revision then raise exception 'draft changed; refresh before saving'; end if;
 select count(*),coalesce(sum((x->>'total_cents')::bigint),0) into count_items,total from jsonb_array_elements(batch.items) x where coalesce((x->>'picked')::boolean,false);
 if count_items=0 or exists(select 1 from jsonb_array_elements(batch.items) x where (x->>'picked')::boolean and (x->>'total_cents')::bigint<=0) then raise exception 'select items and set their prices'; end if;
 if invoice_total is null or total<>invoice_total then raise exception 'invoice total differs from items'; end if;
 if purchase_date is null or coalesce(length(store_name),0)>100 or funds_source not in ('personal','fund') then raise exception 'invalid purchase details'; end if;
 if receipt_object is not null and (split_part(receipt_object,'/',1)<>batch.trip_id::text or not public.shopping_receipt_permission(receipt_object,true) or not exists(select 1 from storage.objects where bucket_id='shopping-receipts' and name=receipt_object)) then raise exception 'receipt unavailable'; end if;
 organizer:=public.is_trip_organizer(batch.trip_id);
 select payload into snapshot from public.trip_snapshots where trip_id=batch.trip_id for update;
 -- All line submissions, official changes and the invoice commit together.
 for item in select value from jsonb_array_elements(batch.items) where (value->>'picked')::boolean loop
  if not coalesce((item->>'source_purchased')::boolean,false) and exists(select 1 from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x where x->>'id'=item->>'source_item_id' and coalesce((x->>'purchased')::boolean,true)) then raise exception 'item already purchased'; end if;
  submission:=public.submit_shopping_purchase(batch.trip_id,nullif(item->>'source_item_id',''),item->>'name',(item->>'quantity')::numeric,item->>'unit',(item->>'total_cents')::bigint,purchase_date,funds_source,'Compra agrupada',receipt_object);
  update public.shopping_purchase_submissions set batch_id=batch.id where id=submission;
 end loop;
 new_status:=case when organizer then 'confirmed' else 'submitted' end;
 update public.shopping_purchase_batches set status=new_status,store_name=coalesce(finalize_market_purchase.store_name,''),purchased_on=purchase_date,paid_from=funds_source,total_cents=total,receipt_path=receipt_object,revision=revision+1,updated_at=now(),reviewed_by=case when organizer then auth.uid() end,reviewed_at=case when organizer then now() end where id=batch.id;
 return new_status;
end $$;

create function public.review_market_purchase(batch_id uuid, approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare batch public.shopping_purchase_batches%rowtype; submission record;
begin
 select * into batch from public.shopping_purchase_batches where id=batch_id for update;
 if batch.id is null or not public.is_trip_organizer(batch.trip_id) then raise exception 'access denied'; end if;
 if batch.status<>'submitted' then raise exception 'purchase already reviewed'; end if;
 for submission in select id from public.shopping_purchase_submissions s where s.batch_id=batch.id order by id loop
  perform public.review_shopping_purchase_item(submission.id,approve);
 end loop;
 update public.shopping_purchase_batches set status=case when approve then 'confirmed' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=batch.id;
end $$;

create function public.attach_market_purchase_receipt(batch_id uuid, receipt_object text)
returns void language plpgsql security definer set search_path='' as $$
declare batch public.shopping_purchase_batches%rowtype;
begin
 select * into batch from public.shopping_purchase_batches where id=batch_id for update;
 if batch.id is null or not public.can_submit_trip_purchase(batch.trip_id) or not (batch.submitted_by=auth.uid() or public.is_trip_organizer(batch.trip_id)) then raise exception 'access denied'; end if;
 if batch.status='draft' or batch.receipt_path is not null then raise exception 'receipt already attached or purchase not finalized'; end if;
 if receipt_object is null or split_part(receipt_object,'/',1)<>batch.trip_id::text or not public.shopping_receipt_permission(receipt_object,true) or not exists(select 1 from storage.objects where bucket_id='shopping-receipts' and name=receipt_object) then raise exception 'receipt unavailable'; end if;
 update public.shopping_purchase_batches set receipt_path=receipt_object,updated_at=now() where id=batch.id;
 update public.shopping_purchase_submissions set receipt_path=receipt_object where shopping_purchase_submissions.batch_id=batch.id;
end $$;

revoke all on function public.review_shopping_purchase(uuid,boolean),public.get_market_purchase_workspace(uuid),public.start_market_purchase(uuid),public.save_market_purchase_item(uuid,jsonb,integer),public.finalize_market_purchase(uuid,integer,text,date,text,bigint,text),public.review_market_purchase(uuid,boolean),public.attach_market_purchase_receipt(uuid,text) from public,anon;
grant execute on function public.review_shopping_purchase(uuid,boolean),public.get_market_purchase_workspace(uuid),public.start_market_purchase(uuid),public.save_market_purchase_item(uuid,jsonb,integer),public.finalize_market_purchase(uuid,integer,text,date,text,bigint,text),public.review_market_purchase(uuid,boolean),public.attach_market_purchase_receipt(uuid,text) to authenticated;
