-- Corrige os achados 1 a 4 de docs/auditoria-rls.md.
-- Teste: supabase/tests/access_hardening.sql
begin;

-- 1. trip_access: leitura continua por política; escrita só pelas RPCs security definer
--    (convites, vínculos, revogação, administradores), que já fazem as checagens de papel.
drop policy if exists access_managed_by_organizer on public.trip_access;
revoke insert, update, delete on public.trip_access from authenticated, anon;

-- 2. payment_submissions: o envio fica preso ao próprio participante e à viagem.
--    A versão anterior comparava tp.trip_id com ele mesmo dentro da subconsulta.
drop policy if exists submissions_create_own on public.payment_submissions;
create policy submissions_create_own on public.payment_submissions for insert to authenticated with check (
  submitted_by=auth.uid() and public.can_access_trip(payment_submissions.trip_id) and exists(
    select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id
    where tp.id=payment_submissions.participant_id and tp.trip_id=payment_submissions.trip_id
      and tp.removed_at is null and mpl.profile_id=auth.uid() and mpl.status='active'
  )
);

drop policy if exists submissions_update_own_draft on public.payment_submissions;
create policy submissions_update_own_draft on public.payment_submissions for update to authenticated
using (submitted_by=auth.uid() and status in ('draft','changes_requested'))
with check (
  submitted_by=auth.uid() and status in ('draft','submitted') and confirmed_payment_id is null and reviewed_by is null and reviewed_at is null
  and public.can_access_trip(payment_submissions.trip_id) and exists(
    select 1 from public.trip_participants tp join public.member_profile_links mpl on mpl.member_id=tp.member_id
    where tp.id=payment_submissions.participant_id and tp.trip_id=payment_submissions.trip_id
      and tp.removed_at is null and mpl.profile_id=auth.uid() and mpl.status='active'
  )
);

-- 3. Conferência do organizador: só campos de revisão, assinados pela própria conta.
drop policy if exists submissions_organizer_review on public.payment_submissions;
create policy submissions_organizer_review on public.payment_submissions for update to authenticated
using (public.is_trip_organizer(trip_id))
with check (public.is_trip_organizer(trip_id) and (reviewed_by is null or reviewed_by=auth.uid()));

-- Viagem, participante e autoria nunca mudam depois do envio.
revoke update on public.payment_submissions from authenticated, anon;
grant update(amount_cents, paid_on, reference_month, note, status, confirmed_payment_id, reviewed_by, reviewed_at, review_note, updated_at)
  on public.payment_submissions to authenticated;

-- Valor, data e observação só podem ser alterados por quem enviou.
create or replace function public.guard_payment_submission_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated','anon') and old.submitted_by is distinct from auth.uid()
     and (new.amount_cents, new.paid_on, new.reference_month, new.note)
         is distinct from (old.amount_cents, old.paid_on, old.reference_month, old.note) then
    raise exception 'only the submitter can change payment details' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists guard_payment_submission_update on public.payment_submissions;
create trigger guard_payment_submission_update before update on public.payment_submissions
for each row execute function public.guard_payment_submission_update();

-- 4. Visitante anônimo: nenhum acesso direto a tabelas; só as quatro prévias públicas.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges revoke execute on functions from public;

do $$
declare f record;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  loop
    if f.signature in (
      'get_junto_plans()', 'preview_participant_access_link(text)',
      'preview_event_invitation(text,uuid)', 'get_invite_social_preview(text,text)'
    ) then continue; end if;
    -- Preserva exatamente o acesso atual de authenticated e service_role antes de tirar PUBLIC.
    if has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      execute format('grant execute on function public.%s to authenticated', f.signature);
    end if;
    if has_function_privilege('service_role', f.oid, 'EXECUTE') then
      execute format('grant execute on function public.%s to service_role', f.signature);
    end if;
    execute format('revoke execute on function public.%s from public, anon', f.signature);
  end loop;
end $$;

commit;
