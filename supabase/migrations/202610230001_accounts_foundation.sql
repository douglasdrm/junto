begin;

create extension if not exists pgcrypto;

create type public.trip_role as enum ('organizer', 'participant', 'financial_responsible');
create type public.link_status as enum ('pending', 'active', 'revoked');
create type public.invite_status as enum ('pending', 'accepted', 'cancelled', 'expired');
create type public.submission_status as enum ('draft', 'submitted', 'confirmed', 'rejected', 'changes_requested');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  avatar_path text,
  platform_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.travel_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '',
  local_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, local_source_id)
);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  email text,
  phone text,
  birth_date date,
  avatar_path text,
  active boolean not null default true,
  local_source_id text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id, local_source_id)
);

create table public.member_profile_links (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.group_members(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status public.link_status not null default 'pending',
  authorized_by uuid references public.profiles(id),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(member_id),
  unique(member_id, profile_id)
);

create table public.family_relationships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups(id) on delete cascade,
  from_member_id uuid not null references public.group_members(id) on delete cascade,
  to_member_id uuid not null references public.group_members(id) on delete cascade,
  relationship_type text not null,
  label text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (from_member_id <> to_member_id),
  unique(group_id, from_member_id, to_member_id, relationship_type)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.travel_groups(id) on delete cascade,
  organizer_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 120),
  event_type text not null default 'trip' check (event_type in ('trip', 'meeting', 'celebration', 'other')),
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  settings jsonb not null default '{}'::jsonb,
  local_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organizer_id, local_source_id)
);

create table public.trip_access (
  trip_id uuid not null references public.trips(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.trip_role not null,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (trip_id, profile_id, role)
);

create table public.trip_participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  member_id uuid not null references public.group_members(id),
  contributes boolean not null default true,
  responsible_participant_id uuid references public.trip_participants(id),
  removed_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  local_source_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id, member_id),
  unique(trip_id, local_source_id)
);

create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  participant_id uuid not null references public.trip_participants(id) on delete cascade,
  role public.trip_role not null default 'participant',
  token_hash text not null unique,
  destination_hint text,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  participant_id uuid not null references public.trip_participants(id),
  submitted_by uuid not null references public.profiles(id),
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  reference_month date,
  note text not null default '',
  status public.submission_status not null default 'draft',
  confirmed_payment_id uuid,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.payment_submissions(id) on delete cascade,
  storage_path text not null unique,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.migration_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  content_hash text not null,
  schema_version integer not null,
  status text not null check (status in ('started', 'completed', 'failed')),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(owner_id, content_hash)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  trip_id uuid references public.trips(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index trip_access_profile_idx on public.trip_access(profile_id, trip_id);
create index trip_participants_trip_idx on public.trip_participants(trip_id) where removed_at is null;
create index member_links_profile_idx on public.member_profile_links(profile_id) where status = 'active';
create index submissions_trip_status_idx on public.payment_submissions(trip_id, status);
create index audit_trip_created_idx on public.audit_events(trip_id, created_at desc);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create function public.can_access_trip(target_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trips t
    where t.id = target_trip and (
      t.organizer_id = auth.uid() or exists (
        select 1 from public.trip_access a
        where a.trip_id = t.id and a.profile_id = auth.uid()
      )
    )
  );
$$;

create function public.is_trip_organizer(target_trip uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trips t
    where t.id = target_trip and (
      t.organizer_id = auth.uid() or exists (
        select 1 from public.trip_access a
        where a.trip_id = t.id and a.profile_id = auth.uid() and a.role = 'organizer'
      )
    )
  );
$$;

revoke all on function public.can_access_trip(uuid) from public;
revoke all on function public.is_trip_organizer(uuid) from public;
grant execute on function public.can_access_trip(uuid), public.is_trip_organizer(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.travel_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.member_profile_links enable row level security;
alter table public.family_relationships enable row level security;
alter table public.trips enable row level security;
alter table public.trip_access enable row level security;
alter table public.trip_participants enable row level security;
alter table public.trip_invites enable row level security;
alter table public.payment_submissions enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.migration_imports enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy groups_owner_all on public.travel_groups for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy members_group_owner_all on public.group_members for all to authenticated using (exists(select 1 from public.travel_groups g where g.id = group_id and g.owner_id = auth.uid())) with check (exists(select 1 from public.travel_groups g where g.id = group_id and g.owner_id = auth.uid()));
create policy links_self_or_group_owner_select on public.member_profile_links for select to authenticated using (profile_id = auth.uid() or exists(select 1 from public.group_members m join public.travel_groups g on g.id=m.group_id where m.id=member_id and g.owner_id=auth.uid()));
create policy relationships_group_owner_all on public.family_relationships for all to authenticated using (exists(select 1 from public.travel_groups g where g.id=group_id and g.owner_id=auth.uid())) with check (exists(select 1 from public.travel_groups g where g.id=group_id and g.owner_id=auth.uid()));
create policy trips_access_select on public.trips for select to authenticated using (public.can_access_trip(id));
create policy trips_owner_insert on public.trips for insert to authenticated with check (organizer_id = auth.uid() and exists(select 1 from public.travel_groups g where g.id=group_id and g.owner_id=auth.uid()));
create policy trips_organizer_update on public.trips for update to authenticated using (public.is_trip_organizer(id)) with check (public.is_trip_organizer(id) and exists(select 1 from public.travel_groups g where g.id=group_id and g.owner_id=auth.uid()));
create policy access_visible_to_trip on public.trip_access for select to authenticated using (public.can_access_trip(trip_id));
create policy access_managed_by_organizer on public.trip_access for all to authenticated using (public.is_trip_organizer(trip_id)) with check (public.is_trip_organizer(trip_id));
create policy participants_visible_to_trip on public.trip_participants for select to authenticated using (public.can_access_trip(trip_id));
create policy participants_managed_by_organizer on public.trip_participants for all to authenticated using (public.is_trip_organizer(trip_id)) with check (public.is_trip_organizer(trip_id));
create policy invites_organizer_all on public.trip_invites for all to authenticated using (public.is_trip_organizer(trip_id)) with check (public.is_trip_organizer(trip_id));
create policy submissions_visible on public.payment_submissions for select to authenticated using (public.is_trip_organizer(trip_id) or submitted_by=auth.uid());
create policy submissions_create_own on public.payment_submissions for insert to authenticated with check (submitted_by=auth.uid() and exists(select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id where tp.id=participant_id and tp.trip_id=trip_id and tp.removed_at is null and mpl.profile_id=auth.uid() and mpl.status='active'));
create policy submissions_update_own_draft on public.payment_submissions for update to authenticated using (submitted_by=auth.uid() and status in ('draft','changes_requested')) with check (submitted_by=auth.uid() and status in ('draft','submitted') and confirmed_payment_id is null and reviewed_by is null and reviewed_at is null);
create policy submissions_organizer_review on public.payment_submissions for update to authenticated using (public.is_trip_organizer(trip_id)) with check (public.is_trip_organizer(trip_id));
create policy receipts_visible on public.payment_receipts for select to authenticated using (exists(select 1 from public.payment_submissions s where s.id=submission_id and (s.submitted_by=auth.uid() or public.is_trip_organizer(s.trip_id))));
create policy receipts_submitter_insert on public.payment_receipts for insert to authenticated with check (uploaded_by=auth.uid() and exists(select 1 from public.payment_submissions s where s.id=submission_id and s.submitted_by=auth.uid()));
create policy imports_owner_all on public.migration_imports for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy audit_trip_select on public.audit_events for select to authenticated using (public.can_access_trip(trip_id));

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update(display_name, phone, avatar_path, updated_at) on public.profiles to authenticated;
grant select, insert, update, delete on public.travel_groups, public.group_members, public.family_relationships, public.trips, public.trip_access, public.trip_participants, public.trip_invites, public.migration_imports to authenticated;
grant select on public.member_profile_links, public.audit_events to authenticated;
grant select, insert, update on public.payment_submissions, public.payment_receipts to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 10485760, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy receipt_objects_owner_insert on storage.objects for insert to authenticated
with check (bucket_id='payment-receipts' and (storage.foldername(name))[1]=auth.uid()::text);

create policy receipt_objects_authorized_select on storage.objects for select to authenticated
using (
  bucket_id='payment-receipts' and (
    owner_id::text=auth.uid()::text or exists(
      select 1 from public.payment_receipts r
      join public.payment_submissions s on s.id=r.submission_id
      where r.storage_path=name and public.is_trip_organizer(s.trip_id)
    )
  )
);

create policy receipt_objects_owner_delete on storage.objects for delete to authenticated
using (bucket_id='payment-receipts' and owner_id::text=auth.uid()::text);

commit;
