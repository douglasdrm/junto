-- One-time plans belong to a planning, not to a monthly user subscription.
-- Checkout/enforcement are deliberately off until the provider is connected and verified.
create table public.junto_plan_catalog (
 code text primary key check(code in ('free','essential','complete')),
 name text not null,
 price_cents integer not null check(price_cents>=0),
 participant_limit integer check(participant_limit>0),
 active_planning_limit integer check(active_planning_limit>0),
 features jsonb not null,
 sort_order integer not null unique,
 active boolean not null default true
);
insert into public.junto_plan_catalog(code,name,price_cents,participant_limit,active_planning_limit,features,sort_order) values
 ('free','Juntô Grátis',0,10,1,'{"invites":true,"companions":true,"potluck":true,"basic_finance":true,"detailed_shopping":false}',1),
 ('essential','Juntô Essencial',990,20,null,'{"invites":true,"companions":true,"potluck":true,"basic_finance":true,"fund":true,"payments":true,"receipts":true,"detailed_shopping":false}',2),
 ('complete','Juntô Completo',1990,null,null,'{"invites":true,"companions":true,"potluck":true,"basic_finance":true,"fund":true,"payments":true,"receipts":true,"detailed_shopping":true,"consumption_groups":true}',3);
create table public.junto_billing_configuration (
 singleton boolean primary key default true check(singleton),
 provider text not null default 'asaas' check(provider='asaas'),
 checkout_enabled boolean not null default false,
 enforcement_enabled boolean not null default false
);
insert into public.junto_billing_configuration(singleton) values(true);
create table public.planning_plan_entitlements (
 trip_id uuid primary key references public.trips(id) on delete cascade,
 plan_code text not null references public.junto_plan_catalog(code),
 source text not null check(source in ('purchase','free','complimentary')),
 status text not null check(status in ('active','revoked')),
 provider_payment_id text unique,
 granted_at timestamptz not null default now()
);
create table public.planning_plan_orders (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 purchaser_id uuid not null references public.profiles(id),
 plan_code text not null references public.junto_plan_catalog(code),
 amount_cents integer not null check(amount_cents>0),
 upgrade_credit_cents integer not null default 0 check(upgrade_credit_cents>=0),
 include_fee_in_split boolean not null default false,
 status text not null default 'pending' check(status in ('pending','paid','cancelled','refunded','expired')),
 provider_payment_id text unique,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create index planning_plan_orders_trip_idx on public.planning_plan_orders(trip_id);
create index planning_plan_orders_purchaser_idx on public.planning_plan_orders(purchaser_id);
create index planning_plan_orders_plan_idx on public.planning_plan_orders(plan_code);
create index planning_plan_entitlements_plan_idx on public.planning_plan_entitlements(plan_code);
alter table public.junto_plan_catalog enable row level security;
alter table public.junto_billing_configuration enable row level security;
alter table public.planning_plan_entitlements enable row level security;
alter table public.planning_plan_orders enable row level security;
revoke all on public.junto_plan_catalog,public.junto_billing_configuration,public.planning_plan_entitlements,public.planning_plan_orders from public,anon,authenticated;

-- Public price information only; neither provider credentials nor customer data are exposed.
create function public.get_junto_plans() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('checkout_available',coalesce((select checkout_enabled from public.junto_billing_configuration where singleton),false),'plans',coalesce((select jsonb_agg(jsonb_build_object('code',code,'name',name,'price_cents',price_cents,'participant_limit',participant_limit,'active_planning_limit',active_planning_limit,'features',features) order by sort_order) from public.junto_plan_catalog where active),'[]'));
$$;
create function public.get_planning_plan(target_trip uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare enabled boolean; entitlement public.planning_plan_entitlements; owner boolean;
begin
 if auth.uid() is null or not public.can_access_trip(target_trip) then raise exception 'access denied';end if;
 select enforcement_enabled into enabled from public.junto_billing_configuration where singleton;
 select * into entitlement from public.planning_plan_entitlements where trip_id=target_trip and status='active';
 select organizer_id=auth.uid() into owner from public.trips where id=target_trip;
 return jsonb_build_object('mode',case when not coalesce(enabled,false) then 'evaluation' else 'commercial' end,'plan_code',entitlement.plan_code,'can_purchase',coalesce(owner,false),'checkout_available',coalesce((select checkout_enabled from public.junto_billing_configuration where singleton),false));
end $$;
revoke all on function public.get_junto_plans(),public.get_planning_plan(uuid) from public,anon;
grant execute on function public.get_junto_plans() to anon,authenticated;
grant execute on function public.get_planning_plan(uuid) to authenticated;
