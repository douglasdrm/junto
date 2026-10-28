create table public.shopping_purchase_submissions (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 participant_id uuid references public.trip_participants(id),
 submitted_by uuid not null references public.profiles(id),
 shopping_item_id text,
 item_name text not null check(length(item_name) between 1 and 100),
 quantity numeric not null check(quantity>0 and quantity<=100000),
 unit text not null default '' check(length(unit)<=80),
 total_cents bigint not null check(total_cents>0 and total_cents<=1000000000),
 purchased_on date not null,
 paid_from text not null check(paid_from in ('personal','fund')),
 note text not null default '' check(length(note)<=1000),
 receipt_path text,
 status text not null default 'submitted' check(status in ('submitted','confirmed','rejected')),
 official_item_id text,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references public.profiles(id)
);
create index shopping_submissions_trip_idx on public.shopping_purchase_submissions(trip_id,status);
create index shopping_submissions_author_idx on public.shopping_purchase_submissions(submitted_by);
create index shopping_submissions_participant_idx on public.shopping_purchase_submissions(participant_id);
create index shopping_submissions_reviewer_idx on public.shopping_purchase_submissions(reviewed_by);
create unique index shopping_one_pending_item_idx on public.shopping_purchase_submissions(trip_id,shopping_item_id) where status='submitted' and shopping_item_id is not null;
alter table public.shopping_purchase_submissions enable row level security;
revoke all on public.shopping_purchase_submissions from public,anon,authenticated;

create function public.can_submit_trip_purchase(target_trip uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.is_trip_organizer(target_trip) or exists(
  select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.profile_id=auth.uid() and mpl.status='active'
  join public.trip_access a on a.trip_id=tp.trip_id and a.profile_id=auth.uid() and a.role in ('participant','financial_responsible')
  where tp.trip_id=target_trip and tp.removed_at is null
  and not exists(select 1 from public.trip_access_revocations r where r.trip_id=target_trip and r.profile_id=auth.uid())
 ));
$$;

create function public.shopping_receipt_permission(object_path text, uploading boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare target uuid;
begin
 if auth.uid() is null or split_part(object_path,'/',1)!~'^[0-9a-fA-F-]{36}$' then return false; end if;
 begin target:=split_part(object_path,'/',1)::uuid; exception when invalid_text_representation then return false; end;
 if not public.can_submit_trip_purchase(target) then return false; end if;
 if uploading then return split_part(object_path,'/',2)=auth.uid()::text and split_part(object_path,'/',3)<>''; end if;
 return exists(select 1 from public.shopping_purchase_submissions s where s.trip_id=target and s.receipt_path=object_path and (s.submitted_by=auth.uid() or public.is_trip_organizer(target)));
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('shopping-receipts','shopping-receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy shopping_receipts_insert on storage.objects for insert to authenticated
with check(bucket_id='shopping-receipts' and public.shopping_receipt_permission(name,true));
create policy shopping_receipts_select on storage.objects for select to authenticated
using(bucket_id='shopping-receipts' and public.shopping_receipt_permission(name,false));

create function public.get_shopping_purchase_workspace(target_trip uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; selected_year text; organizer boolean;
begin
 if not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied'; end if;
 organizer:=public.is_trip_organizer(target_trip);
 select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
 selected_year:=coalesce(snapshot->>'shoppingYear',(select max(item->>'year') from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) item));
 return jsonb_build_object('organizer',organizer,'items',(select coalesce(jsonb_agg(jsonb_build_object('id',item->>'id','name',item->>'name','quantity',item->'quantity','unit',item->>'unit','totalCents',coalesce((item->>'actualTotalCents')::numeric,round(coalesce((item->>'quantity')::numeric,0)*coalesce((item->>'unitPriceCents')::numeric,0))),'purchased',coalesce((item->>'purchased')::boolean,true))),'[]') from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) item where item->>'year'=selected_year),
 'submissions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'item_name',s.item_name,'quantity',s.quantity,'unit',s.unit,'total_cents',s.total_cents,'purchased_on',s.purchased_on,'paid_from',s.paid_from,'note',s.note,'status',s.status,'receipt_path',s.receipt_path,'buyer_name',p.display_name,'created_at',s.created_at) order by s.created_at desc),'[]') from public.shopping_purchase_submissions s join public.profiles p on p.id=s.submitted_by where s.trip_id=target_trip and (organizer or s.submitted_by=auth.uid())));
end $$;

create function public.review_shopping_purchase(submission_id uuid, approve boolean)
returns void language plpgsql security definer set search_path='' as $$
declare submission public.shopping_purchase_submissions%rowtype; snapshot jsonb; entries jsonb; item jsonb; updated_item jsonb; official_id text; selected_year integer; found boolean:=false;
begin
 select * into submission from public.shopping_purchase_submissions where id=submission_id for update;
 if submission.id is null or not public.is_trip_organizer(submission.trip_id) then raise exception 'access denied'; end if;
 if submission.status<>'submitted' then raise exception 'purchase already reviewed'; end if;
 if not approve then update public.shopping_purchase_submissions set status='rejected',reviewed_at=now(),reviewed_by=auth.uid() where id=submission.id; return; end if;
 if submission.participant_id is not null and not exists(select 1 from public.trip_participants where id=submission.participant_id and trip_id=submission.trip_id and removed_at is null) then raise exception 'participant no longer active'; end if;
 select payload into snapshot from public.trip_snapshots where trip_id=submission.trip_id for update;
 if snapshot is null then raise exception 'trip not found'; end if;
 selected_year:=coalesce(nullif(snapshot->>'shoppingYear','')::integer,extract(year from current_date)::integer);
 entries:='[]'; official_id:=coalesce(submission.shopping_item_id,gen_random_uuid()::text);
 for item in select value from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) loop
  if item->>'id'=submission.shopping_item_id then
   found:=true;
   if coalesce((item->>'purchased')::boolean,true) and not public.is_trip_organizer(submission.trip_id) then raise exception 'item already purchased'; end if;
   -- A guest submission must not overwrite a purchase confirmed in the meantime.
   if coalesce((item->>'purchased')::boolean,true) and submission.participant_id is not null and submission.submitted_by<>auth.uid() then raise exception 'item already purchased'; end if;
   updated_item:=item||jsonb_build_object('name',submission.item_name,'quantity',submission.quantity,'unit',submission.unit,'actualTotalCents',submission.total_cents,'unitPriceCents',round(submission.total_cents/submission.quantity),'purchased',true,'purchasedAt',submission.purchased_on,'buyerProfileId',submission.submitted_by,'paidFrom',submission.paid_from,'purchaseSubmissionId',submission.id,'updatedAt',now());
   entries:=entries||jsonb_build_array(updated_item);
  else entries:=entries||jsonb_build_array(item); end if;
 end loop;
 if submission.shopping_item_id is not null and not found then raise exception 'shopping item no longer available'; end if;
 if submission.shopping_item_id is null then entries:=entries||jsonb_build_array(jsonb_build_object('id',official_id,'trip',snapshot->'trip'->>'id','year',selected_year,'name',submission.item_name,'quantity',submission.quantity,'unit',submission.unit,'actualTotalCents',submission.total_cents,'unitPriceCents',round(submission.total_cents/submission.quantity),'purchased',true,'purchasedAt',submission.purchased_on,'buyerProfileId',submission.submitted_by,'paidFrom',submission.paid_from,'purchaseSubmissionId',submission.id,'createdAt',now())); end if;
 update public.trip_snapshots set payload=jsonb_set(snapshot,'{shoppingItems}',entries),revision=revision+1,updated_at=now(),updated_by=auth.uid() where trip_id=submission.trip_id;
 update public.shopping_purchase_submissions set status='confirmed',official_item_id=official_id,reviewed_at=now(),reviewed_by=auth.uid() where id=submission.id;
end $$;

create function public.submit_shopping_purchase(target_trip uuid, item_id text, item_name text, item_quantity numeric, item_unit text, amount_cents bigint, purchase_date date, funds_source text, purchase_note text default '', receipt_object text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare participant uuid; submission uuid; snapshot jsonb; source_item jsonb; organizer boolean;
begin
 if not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied'; end if;
 organizer:=public.is_trip_organizer(target_trip);
 if not organizer then select tp.id into participant from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id and mpl.profile_id=auth.uid() and mpl.status='active' where tp.trip_id=target_trip and tp.removed_at is null limit 1; end if;
 select payload into snapshot from public.trip_snapshots where trip_id=target_trip;
 if snapshot is null then raise exception 'trip not found'; end if;
 if item_id is not null then
  select value into source_item from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) where value->>'id'=item_id and value->>'year'=coalesce(snapshot->>'shoppingYear',(select max(x->>'year') from jsonb_array_elements(coalesce(snapshot->'shoppingItems','[]')) x));
  if source_item is null then raise exception 'shopping item not found'; end if;
  if not organizer and coalesce((source_item->>'purchased')::boolean,true) then raise exception 'item already purchased'; end if;
 end if;
 if receipt_object is not null and (split_part(receipt_object,'/',1)<>target_trip::text or not public.shopping_receipt_permission(receipt_object,true) or not exists(select 1 from storage.objects where bucket_id='shopping-receipts' and name=receipt_object)) then raise exception 'receipt unavailable'; end if;
 insert into public.shopping_purchase_submissions(trip_id,participant_id,submitted_by,shopping_item_id,item_name,quantity,unit,total_cents,purchased_on,paid_from,note,receipt_path)
 values(target_trip,participant,auth.uid(),item_id,trim(item_name),item_quantity,coalesce(item_unit,''),amount_cents,purchase_date,funds_source,coalesce(purchase_note,''),receipt_object) returning id into submission;
 if organizer then perform public.review_shopping_purchase(submission,true); end if;
 return submission;
end $$;

revoke all on function public.can_submit_trip_purchase(uuid),public.shopping_receipt_permission(text,boolean),public.get_shopping_purchase_workspace(uuid),public.review_shopping_purchase(uuid,boolean),public.submit_shopping_purchase(uuid,text,text,numeric,text,bigint,date,text,text,text) from public,anon;
grant execute on function public.can_submit_trip_purchase(uuid),public.shopping_receipt_permission(text,boolean),public.get_shopping_purchase_workspace(uuid),public.review_shopping_purchase(uuid,boolean),public.submit_shopping_purchase(uuid,text,text,numeric,text,bigint,date,text,text,text) to authenticated;
