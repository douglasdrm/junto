-- Grupos da conta: inicialização pelos planejamentos próprios, revisão, isolamento entre contas e
-- descarte de grupos de planejamentos de outras pessoas. Tudo é desfeito no rollback.
begin;
do $$
declare
 owner_id uuid; coadmin uuid; outsider uuid;
 g uuid:=gen_random_uuid(); g2 uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid();
 result jsonb; rev bigint; blocked boolean;
begin
 select id into owner_id from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) order by created_at limit 1;
 select id into coadmin from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) and id<>owner_id order by created_at limit 1;
 select id into outsider from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) and id not in (owner_id,coadmin) order by created_at limit 1;
 if outsider is null then raise exception 'test needs three confirmed accounts'; end if;

 -- Planejamento do dono com o grupo "local-owner"; o coadministrador tem um planejamento próprio com "local-co".
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,owner_id,'Workspace fixture');
 insert into public.trips(id,group_id,organizer_id,name) values(t,g,owner_id,'Owner trip');
 insert into public.trip_snapshots(trip_id,payload,revision,updated_by) values(t,jsonb_build_object(
   'trip',jsonb_build_object('id','local-trip','groupId','local-owner'),
   'group',jsonb_build_object('id','local-owner','name','Família do dono'),
   'members',jsonb_build_array(jsonb_build_object('id','m1','groupId','local-owner','name','Ricardo'),jsonb_build_object('id','m2','groupId','local-owner','name','Thalles')),
   'relationships',jsonb_build_array(jsonb_build_object('id','r1','groupId','local-owner','fromMemberId','m1','toMemberId','m2','type','parent'))),1,owner_id);
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,coadmin,'organizer',owner_id);
 perform set_config('request.jwt.claim.sub',coadmin::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g2,coadmin,'Co fixture');
 insert into public.trips(id,group_id,organizer_id,name) values(t2,g2,coadmin,'Co trip');
 insert into public.trip_snapshots(trip_id,payload,revision,updated_by) values(t2,jsonb_build_object('trip',jsonb_build_object('id','co-trip'),'group',jsonb_build_object('id','local-co','name','Família do coadmin')),1,coadmin);

 perform set_config('role','authenticated',true);

 -- Dono: sem nada salvo, recebe os grupos dos planejamentos próprios para inicializar.
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 result:=public.get_account_people_workspace();
 if (result->>'revision')::bigint<>0 or result->'payload'<>'null'::jsonb then raise exception 'unexpected stored workspace: %',result; end if;
 if jsonb_array_length(result->'owned_trip_groups')<>1 or result->'owned_trip_groups'->0->'group'->>'id'<>'local-owner'
    or result->'owned_trip_groups'->0->'relationships'->0->>'type'<>'parent' then raise exception 'bootstrap missing owner group: %',result; end if;

 -- Salvar: revisão 0 -> 1 -> 2; revisão antiga é recusada.
 result:=public.save_account_people_workspace(jsonb_build_object(
   'groups',jsonb_build_array(jsonb_build_object('id','local-owner','name','Família do dono'),jsonb_build_object('id','new-group','name','Amigos')),
   'members',jsonb_build_array(jsonb_build_object('id','m1','groupId','local-owner','name','Ricardo'),jsonb_build_object('id','m9','groupId','new-group','name','Lia')),
   'relationships','[]'::jsonb,'unexpected','x'),0);
 rev:=(result->>'revision')::bigint;
 if rev<>1 or result->'payload' ? 'unexpected' then raise exception 'first save wrong: %',result; end if;
 result:=public.save_account_people_workspace(result->'payload',1);
 if (result->>'revision')::bigint<>2 then raise exception 'second save wrong'; end if;
 blocked:=false;
 begin perform public.save_account_people_workspace('{}'::jsonb,1); exception when serialization_failure then blocked:=true; end;
 if not blocked then raise exception 'stale revision accepted'; end if;
 result:=public.get_account_people_workspace();
 if (result->>'revision')::bigint<>2 or jsonb_array_length(result->'payload'->'groups')<>2 then raise exception 'stored workspace wrong: %',result; end if;

 -- Coadministrador: o grupo do dono (planejamento compartilhado) é descartado; o grupo próprio fica.
 perform set_config('request.jwt.claim.sub',coadmin::text,true);
 result:=public.get_account_people_workspace();
 if exists(select 1 from jsonb_array_elements(result->'owned_trip_groups') x where x->'group'->>'id'='local-owner') then raise exception 'co-admin bootstrap includes owner group'; end if;
 result:=public.save_account_people_workspace(jsonb_build_object(
   'groups',jsonb_build_array(jsonb_build_object('id','local-owner'),jsonb_build_object('id','local-co')),
   'members',jsonb_build_array(jsonb_build_object('id','m1','groupId','local-owner'),jsonb_build_object('id','c1','groupId','local-co')),
   'relationships',jsonb_build_array(jsonb_build_object('id','r1','groupId','local-owner'))),0);
 if exists(select 1 from jsonb_array_elements(result->'payload'->'groups') x where x->>'id'='local-owner')
    or exists(select 1 from jsonb_array_elements(result->'payload'->'members') x where x->>'groupId'='local-owner')
    or jsonb_array_length(result->'payload'->'relationships')<>0 then raise exception 'foreign group kept: %',result; end if;
 if not exists(select 1 from jsonb_array_elements(result->'payload'->'groups') x where x->>'id'='local-co') then raise exception 'own group dropped'; end if;

 -- Outra conta não vê os dados do dono; ninguém acessa a tabela diretamente; visitante anônimo não chama as funções.
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 result:=public.get_account_people_workspace();
 if result->'payload'<>'null'::jsonb or jsonb_array_length(result->'owned_trip_groups')<>0 then raise exception 'workspace leaked to another account'; end if;
 blocked:=false;
 begin perform 1 from public.account_people_workspaces; exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'direct table access allowed'; end if;
 perform set_config('role','none',true);
 if has_function_privilege('anon','public.get_account_people_workspace()','EXECUTE') or has_function_privilege('authenticated','public.account_people_foreign_groups(uuid)','EXECUTE') then raise exception 'function privileges too wide'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 blocked:=false;
 begin perform public.get_account_people_workspace(); exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'anonymous context accepted'; end if;
 raise notice 'PASS: account workspace bootstrap from own trips, revisions, foreign groups dropped, isolation between accounts, no direct access';
end $$;
rollback;
