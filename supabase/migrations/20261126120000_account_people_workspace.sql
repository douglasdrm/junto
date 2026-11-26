-- Grupos, pessoas, Turmas e vínculos passam a pertencer à conta (antes só existiam dentro do snapshot
-- de cada planejamento, e o menu de grupos ficava vazio sem um planejamento aberto).
-- Teste: supabase/tests/account_people_workspace.sql
begin;

create table public.account_people_workspaces (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.account_people_workspaces enable row level security;
revoke all on public.account_people_workspaces from anon, authenticated;

-- Ids de grupos que aparecem só em planejamentos de outras pessoas às quais a conta tem acesso.
create or replace function public.account_people_foreign_groups(account uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  select distinct s.payload->'group'->>'id'
  from public.trip_snapshots s join public.trips t on t.id=s.trip_id
  where t.organizer_id<>account and s.payload->'group'->>'id' is not null
    and exists(select 1 from public.trip_access a where a.trip_id=t.id and a.profile_id=account)
  except
  select s.payload->'group'->>'id'
  from public.trip_snapshots s join public.trips t on t.id=s.trip_id
  where t.organizer_id=account and s.payload->'group'->>'id' is not null;
$$;

create or replace function public.get_account_people_workspace()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me uuid:=auth.uid(); stored public.account_people_workspaces; owned jsonb;
begin
  if me is null or not exists(select 1 from auth.users where id=me and not coalesce(is_anonymous,false)) then
    raise exception 'registered account required' using errcode='42501';
  end if;
  select * into stored from public.account_people_workspaces where owner_id=me;
  -- Dados de grupo dos planejamentos próprios: inicializam a conta e trazem grupos criados em outro aparelho.
  select coalesce(jsonb_agg(jsonb_build_object(
      'group', s.payload->'group',
      'members', coalesce(s.payload->'members','[]'::jsonb),
      'groupFamilies', coalesce(s.payload->'groupFamilies','[]'::jsonb),
      'relationships', coalesce(s.payload->'relationships','[]'::jsonb),
      'peopleMapLayouts', coalesce(s.payload->'peopleMapLayouts','[]'::jsonb),
      'roomPreferences', coalesce(s.payload->'roomPreferences','[]'::jsonb)
    ) order by s.updated_at), '[]'::jsonb)
  into owned
  from public.trip_snapshots s join public.trips t on t.id=s.trip_id
  where t.organizer_id=me and jsonb_typeof(s.payload->'group')='object';
  return jsonb_build_object('revision', coalesce(stored.revision,0), 'payload', stored.payload, 'owned_trip_groups', owned);
end $$;

create or replace function public.save_account_people_workspace(new_payload jsonb, expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid:=auth.uid(); foreign_ids text[]; clean jsonb:='{}'::jsonb; key text; next_revision bigint;
begin
  if me is null or not exists(select 1 from auth.users where id=me and not coalesce(is_anonymous,false)) then
    raise exception 'registered account required' using errcode='42501';
  end if;
  if new_payload is null or jsonb_typeof(new_payload)<>'object' then raise exception 'invalid payload' using errcode='22023'; end if;
  if octet_length(new_payload::text)>5242880 then raise exception 'payload too large' using errcode='54000'; end if;
  select coalesce(array_agg(id),'{}') into foreign_ids from public.account_people_foreign_groups(me) id;
  -- Mantém só listas conhecidas e descarta grupos de planejamentos de outras pessoas.
  clean:=jsonb_build_object('schemaVersion',1,'groups',coalesce((
    select jsonb_agg(item) from jsonb_array_elements(case when jsonb_typeof(new_payload->'groups')='array' then new_payload->'groups' else '[]'::jsonb end) item
    where jsonb_typeof(item)='object' and not (item->>'id' = any(foreign_ids))),'[]'::jsonb));
  foreach key in array array['members','groupFamilies','relationships','peopleMapLayouts','roomPreferences'] loop
    clean:=clean||jsonb_build_object(key,coalesce((
      select jsonb_agg(item) from jsonb_array_elements(case when jsonb_typeof(new_payload->key)='array' then new_payload->key else '[]'::jsonb end) item
      where jsonb_typeof(item)='object' and not (coalesce(item->>'groupId','') = any(foreign_ids))),'[]'::jsonb));
  end loop;
  insert into public.account_people_workspaces as w(owner_id,payload,revision,updated_at)
  values(me,clean,1,now())
  on conflict (owner_id) do update set payload=excluded.payload,revision=w.revision+1,updated_at=now()
    where w.revision=expected_revision
  returning revision into next_revision;
  if next_revision is null or (next_revision=1 and expected_revision<>0) then
    raise exception 'revision conflict' using errcode='40001';
  end if;
  return jsonb_build_object('revision',next_revision,'payload',clean);
end $$;

revoke all on function public.account_people_foreign_groups(uuid) from public, anon, authenticated;
revoke all on function public.get_account_people_workspace() from public, anon;
revoke all on function public.save_account_people_workspace(jsonb,bigint) from public, anon;
grant execute on function public.get_account_people_workspace() to authenticated;
grant execute on function public.save_account_people_workspace(jsonb,bigint) to authenticated;

commit;
