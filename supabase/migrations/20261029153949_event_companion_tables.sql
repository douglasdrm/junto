-- Companions are attendance records, never implicit debtors or account grants.
create table public.event_companion_settings (
 trip_id uuid primary key references public.trips(id) on delete cascade,
 allowed boolean not null default true,
 per_person_limit integer not null default 20 check(per_person_limit between 0 and 100),
 revision bigint not null default 1
);
create table public.event_companions (
 id uuid primary key default gen_random_uuid(),
 trip_id uuid not null references public.trips(id) on delete cascade,
 responsible_id uuid not null references public.profiles(id),
 name text not null check(length(btrim(name)) between 1 and 100),
 kind text not null check(kind in ('adult','child')),
 revision bigint not null default 1,
 created_at timestamptz not null default now()
);
create unique index event_companions_name_idx on public.event_companions(trip_id,responsible_id,lower(btrim(name)));
create index event_companions_responsible_idx on public.event_companions(responsible_id);
alter table public.event_companion_settings enable row level security;
alter table public.event_companions enable row level security;
revoke all on public.event_companion_settings,public.event_companions from public,anon,authenticated;
alter table public.event_potluck_claims add column companion_id uuid references public.event_companions(id) on delete restrict;
create index event_potluck_claims_companion_idx on public.event_potluck_claims(companion_id);

