-- Endurecimento de acessos e envios de pagamento (achados 1 a 4 de docs/auditoria-rls.md).
-- Usa três contas confirmadas existentes; tudo é desfeito no rollback.
begin;
do $$
declare
 owner_id uuid; coadmin uuid; member uuid;
 g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); t2 uuid:=gen_random_uuid();
 m_member uuid:=gen_random_uuid(); m_other uuid:=gen_random_uuid(); m_member2 uuid:=gen_random_uuid();
 p_member uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid(); p_member2 uuid:=gen_random_uuid();
 sub uuid; n integer; blocked boolean;
begin
 select id into owner_id from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) order by created_at limit 1;
 select id into coadmin from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) and id<>owner_id order by created_at limit 1;
 select id into member from auth.users where email_confirmed_at is not null and not coalesce(is_anonymous,false) and id not in (owner_id,coadmin) order by created_at limit 1;
 if member is null then raise exception 'test needs three confirmed accounts'; end if;

 -- Fixtures (como postgres): viagem t com coadministrador e participante vinculado; viagem t2 onde o participante também está.
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,owner_id,'Hardening fixture');
 insert into public.trips(id,group_id,organizer_id,name) values(t,g,owner_id,'Hardening trip'),(t2,g,owner_id,'Hardening other trip');
 insert into public.group_members(id,group_id,display_name,created_by) values(m_member,g,'Membro',owner_id),(m_other,g,'Outra pessoa',owner_id);
 insert into public.member_profile_links(member_id,profile_id,status,linked_at) values(m_member,member,'active',now());
 insert into public.trip_participants(id,trip_id,member_id) values(p_member,t,m_member),(p_other,t,m_other),(p_member2,t2,m_member);
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,coadmin,'organizer',owner_id),(t,member,'participant',owner_id);

 -- 1. Coadministrador não altera trip_access diretamente.
 perform set_config('request.jwt.claim.sub',coadmin::text,true);
 perform set_config('role','authenticated',true);
 blocked:=false;
 begin insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,member,'organizer',coadmin);
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'co-administrator granted organizer directly'; end if;
 blocked:=false;
 begin delete from public.trip_access where trip_id=t and profile_id=member;
 exception when insufficient_privilege then blocked:=true; end;
 perform set_config('role','none',true);
 if not blocked or not exists(select 1 from public.trip_access where trip_id=t and profile_id=member) then raise exception 'co-administrator removed access directly'; end if;
 perform set_config('request.jwt.claim.sub',coadmin::text,true);
 perform set_config('role','authenticated',true);
 if not exists(select 1 from public.trip_access where trip_id=t and profile_id=coadmin) then raise exception 'co-administrator lost read access to trip_access'; end if;
 perform set_config('role','none',true);

 -- 2. Participante: envio só para o próprio cadastro desta viagem.
 perform set_config('request.jwt.claim.sub',member::text,true);
 perform set_config('role','authenticated',true);
 blocked:=false;
 begin insert into public.payment_submissions(trip_id,participant_id,submitted_by,amount_cents,paid_on) values(t,p_member2,member,1000,current_date);
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'submission accepted with participant from another trip'; end if;
 insert into public.payment_submissions(trip_id,participant_id,submitted_by,amount_cents,paid_on) values(t,p_member,member,1000,current_date) returning id into sub;
 update public.payment_submissions set amount_cents=1500, note='ajuste' where id=sub;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'submitter cannot edit own draft'; end if;
 blocked:=false;
 begin update public.payment_submissions set participant_id=p_other where id=sub;
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'draft moved to another participant'; end if;
 blocked:=false;
 begin update public.payment_submissions set trip_id=t2, participant_id=p_member2 where id=sub;
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'draft moved to another trip'; end if;
 update public.payment_submissions set status='submitted' where id=sub;
 perform set_config('role','none',true);

 -- 3. Organizador confere, mas não altera valor, data ou autoria.
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('role','authenticated',true);
 blocked:=false;
 begin update public.payment_submissions set amount_cents=1 where id=sub;
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'organizer changed submitted amount'; end if;
 blocked:=false;
 begin update public.payment_submissions set submitted_by=owner_id where id=sub;
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'organizer changed submission author'; end if;
 blocked:=false;
 begin update public.payment_submissions set status='confirmed', reviewed_by=coadmin, reviewed_at=now() where id=sub;
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'review attributed to another account'; end if;
 update public.payment_submissions set status='confirmed', reviewed_by=owner_id, reviewed_at=now(), review_note='ok' where id=sub;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'organizer cannot review submission'; end if;
 perform set_config('role','none',true);
 if (select amount_cents from public.payment_submissions where id=sub)<>1500 then raise exception 'amount changed'; end if;

 -- 4. Visitante anônimo só usa as quatro prévias públicas.
 if has_table_privilege('anon','public.trips','SELECT') or has_table_privilege('anon','public.trip_access','INSERT') or has_table_privilege('anon','public.profiles','SELECT') then raise exception 'anon keeps direct table privileges'; end if;
 if has_function_privilege('anon','public.get_planning_plan(uuid)','EXECUTE') or has_function_privilege('anon','public.is_trip_organizer(uuid)','EXECUTE') then raise exception 'anon can call private functions'; end if;
 if not has_function_privilege('anon','public.get_junto_plans()','EXECUTE') or not has_function_privilege('anon','public.preview_participant_access_link(text)','EXECUTE')
  or not has_function_privilege('anon','public.preview_event_invitation(text,uuid)','EXECUTE') or not has_function_privilege('anon','public.get_invite_social_preview(text,text)','EXECUTE') then raise exception 'public previews no longer available to anon'; end if;
 if not has_function_privilege('authenticated','public.get_planning_plan(uuid)','EXECUTE') or not has_function_privilege('authenticated','public.is_trip_organizer(uuid)','EXECUTE') then raise exception 'authenticated lost function access'; end if;
 raise notice 'PASS: co-admins cannot edit access directly, submissions locked to own participant and trip, review limited to review fields, anon limited to public previews';
end $$;
rollback;
