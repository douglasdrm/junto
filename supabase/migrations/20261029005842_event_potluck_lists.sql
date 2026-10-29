-- Independent of shopping costs, payments and snapshot synchronisation.
create table public.event_potluck_settings (
 trip_id uuid primary key references public.trips(id) on delete cascade,
 mode text not null default 'off' check(mode in ('off','potluck','mixed')),
 allow_extras boolean not null default true,
 revision bigint not null default 1
);
create table public.event_potluck_items (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.event_potluck_settings(trip_id) on delete cascade,
 name text not null check(length(name) between 1 and 100),
 category text not null default 'Outros' check(length(category) between 1 and 40),
 quantity numeric(10,2) not null check(quantity>0 and quantity<=10000),
 unit text not null default 'unidades' check(length(unit) between 1 and 40),
 note text not null default '' check(length(note)<=500),
 created_by uuid not null references public.profiles(id),
 from_list boolean not null,
 created_at timestamptz not null default now()
);
create index event_potluck_items_trip_idx on public.event_potluck_items(trip_id);
create index event_potluck_items_author_idx on public.event_potluck_items(created_by);
create table public.event_potluck_claims (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.event_potluck_items(id) on delete cascade,
 profile_id uuid not null references public.profiles(id),
 quantity numeric(10,2) not null check(quantity>0 and quantity<=10000),
 scope text not null check(scope in ('person','family')),
 label text not null check(length(label) between 1 and 100),
 delivered boolean not null default false,
 unique(item_id,profile_id)
);
create index event_potluck_claims_profile_idx on public.event_potluck_claims(profile_id);
alter table public.event_potluck_settings enable row level security;
alter table public.event_potluck_items enable row level security;
alter table public.event_potluck_claims enable row level security;
revoke all on public.event_potluck_settings,public.event_potluck_items,public.event_potluck_claims from public,anon,authenticated;

create function public.get_event_potluck(target_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.event_potluck_settings; prefs jsonb; organizer boolean;
begin
 if auth.uid() is null or not public.can_access_trip(target_trip) then raise exception 'access denied'; end if;
 organizer:=public.is_trip_organizer(target_trip);
 select * into s from public.event_potluck_settings where trip_id=target_trip;
 select payload->'trip' into prefs from public.trip_snapshots where trip_id=target_trip;
 return jsonb_build_object('organizer',organizer,'can_choose',public.can_submit_trip_purchase(target_trip),
 'mode',coalesce(s.mode,prefs->>'potluckMode','off'),'allow_extras',coalesce(s.allow_extras,(prefs->>'potluckAllowExtras')::boolean,true),
 'revision',coalesce(s.revision,1),'items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',i.id,'name',i.name,'category',i.category,'quantity',i.quantity,'unit',i.unit,'note',i.note,'from_list',i.from_list,
 'own',i.created_by=auth.uid(),'claims',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'quantity',c.quantity,'scope',c.scope,'label',c.label,'responsible_name',(select display_name from public.profiles where id=c.profile_id),'delivered',c.delivered,'own',c.profile_id=auth.uid()) order by c.id) from public.event_potluck_claims c where c.item_id=i.id),'[]'::jsonb)) order by i.created_at,i.id) from public.event_potluck_items i where i.trip_id=target_trip),'[]'::jsonb));
end $$;

create function public.change_event_potluck(target_trip uuid, action text, body jsonb, expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.event_potluck_settings; i public.event_potluck_items; c public.event_potluck_claims; organizer boolean; prefs jsonb; q numeric; claimed numeric; chosen_item uuid; display text;
begin
 if auth.uid() is null or not public.can_submit_trip_purchase(target_trip) then raise exception 'access denied'; end if;
 organizer:=public.is_trip_organizer(target_trip);
 select payload->'trip' into prefs from public.trip_snapshots where trip_id=target_trip;
 insert into public.event_potluck_settings(trip_id,mode,allow_extras) values(target_trip,coalesce(prefs->>'potluckMode','off'),coalesce((prefs->>'potluckAllowExtras')::boolean,true)) on conflict do nothing;
 select * into s from public.event_potluck_settings where trip_id=target_trip for update;
 if s.revision<>expected_revision then raise exception 'list changed'; end if;
 if action='settings' then
  if not organizer then raise exception 'access denied'; end if;
  update public.event_potluck_settings set mode=body->>'mode',allow_extras=(body->>'allow_extras')::boolean where trip_id=target_trip;
 elsif s.mode='off' then raise exception 'list disabled';
 elsif action in ('item','extra') then
  if action='item' and not organizer then raise exception 'access denied'; end if;
  if action='extra' and not s.allow_extras then raise exception 'only listed items'; end if;
  q:=(body->>'quantity')::numeric;
  if q is null or q<=0 or q>10000 or q<>round(q,2) then raise exception 'invalid quantity'; end if;
  chosen_item:=nullif(body->>'id','')::uuid;
  if chosen_item is not null then
   select * into i from public.event_potluck_items where id=chosen_item and trip_id=target_trip;
   if i.id is null or not organizer or action<>'item' then raise exception 'access denied'; end if;
   select coalesce(sum(quantity),0) into claimed from public.event_potluck_claims where event_potluck_claims.item_id=i.id;
   if q<claimed then raise exception 'quantity below reserved'; end if;
   update public.event_potluck_items set name=btrim(body->>'name'),category=btrim(body->>'category'),quantity=q,unit=btrim(body->>'unit'),note=coalesce(body->>'note',''),from_list=true where id=i.id;
  else
   insert into public.event_potluck_items(trip_id,name,category,quantity,unit,note,created_by,from_list) values(target_trip,btrim(body->>'name'),btrim(body->>'category'),q,btrim(body->>'unit'),coalesce(body->>'note',''),auth.uid(),action='item') returning id into chosen_item;
   if action='extra' then
    select display_name into display from public.profiles where id=auth.uid();
    insert into public.event_potluck_claims(item_id,profile_id,quantity,scope,label) values(chosen_item,auth.uid(),q,body->>'scope',left(coalesce(nullif(btrim(body->>'label'),''),display,'Participante'),100));
   end if;
  end if;
 elsif action='claim' then
  select * into i from public.event_potluck_items where id=(body->>'item_id')::uuid and trip_id=target_trip;
  if i.id is null then raise exception 'item not found'; end if;
  if not i.from_list and not s.allow_extras then raise exception 'only listed items'; end if;
  q:=(body->>'quantity')::numeric;
  if q is null or q<=0 or q>10000 or q<>round(q,2) then raise exception 'invalid quantity'; end if;
  select coalesce(sum(quantity),0) into claimed from public.event_potluck_claims where event_potluck_claims.item_id=i.id and profile_id<>auth.uid();
  if claimed+q>i.quantity then raise exception 'not enough remaining'; end if;
  select display_name into display from public.profiles where id=auth.uid();
  insert into public.event_potluck_claims(item_id,profile_id,quantity,scope,label) values(i.id,auth.uid(),q,body->>'scope',left(coalesce(nullif(btrim(body->>'label'),''),display,'Participante'),100))
  on conflict(item_id,profile_id) do update set quantity=excluded.quantity,scope=excluded.scope,label=excluded.label,delivered=false;
 elsif action in ('unclaim','delivered') then
  select ec.* into c from public.event_potluck_claims ec join public.event_potluck_items ei on ei.id=ec.item_id where ec.id=(body->>'id')::uuid and ei.trip_id=target_trip;
  if c.id is null or not (organizer or c.profile_id=auth.uid()) then raise exception 'access denied'; end if;
  if action='unclaim' then delete from public.event_potluck_claims where id=c.id;
  else update public.event_potluck_claims set delivered=coalesce((body->>'delivered')::boolean,false) where id=c.id; end if;
 elsif action='delete' then
  select * into i from public.event_potluck_items where id=(body->>'id')::uuid and trip_id=target_trip;
  if i.id is null or not organizer then raise exception 'access denied'; end if;
  if exists(select 1 from public.event_potluck_claims where event_potluck_claims.item_id=i.id) then raise exception 'remove reservations first'; end if;
  delete from public.event_potluck_items where id=i.id;
 else raise exception 'unknown action'; end if;
 update public.event_potluck_settings set revision=revision+1 where trip_id=target_trip;
 return public.get_event_potluck(target_trip);
end $$;
revoke all on function public.get_event_potluck(uuid),public.change_event_potluck(uuid,text,jsonb,bigint) from public,anon;
grant execute on function public.get_event_potluck(uuid),public.change_event_potluck(uuid,text,jsonb,bigint) to authenticated;
