# Auditoria de segurança do Supabase (RLS, grants e funções)

Revisão estática das 51 migrations em `supabase/migrations/` (estado até 2026-11-06). Nada foi executado contra o banco real; vale confirmar os pontos marcados com **verificar** no SQL Editor.

## Resumo

A base está bem protegida. Os pontos fortes:

- **RLS em todas as 30 tabelas.** As tabelas sem política nenhuma (`trip_join_links`, `participant_access_links`, `event_potluck_*`, `event_companions`, `shopping_purchase_*`, `planning_plan_*`, `junto_billing_configuration` etc.) ficam fechadas para acesso direto e só são lidas e escritas por funções RPC `security definer`. É o desenho certo.
- **Funções `security definer` com `search_path` fixo.** Das 48 migrations que as definem, só um trigger usava `search_path = public`. Ele foi corrigido em `20261124180000_harden_event_type_trigger_search_path.sql`.
- **Tokens de convite fortes.** São gerados com 32 bytes aleatórios (256 bits), guardados apenas como hash SHA-256 e validados por regex (`^[a-f0-9]{64}$`) antes de qualquer consulta.
- **Pouco exposto a `anon`.** Só quatro funções de prévia aceitam usuários não logados (`preview_participant_access_link`, `preview_event_invitation`, `get_invite_social_preview`, `get_junto_plans`). Elas devolvem só nome, tipo e capa do planejamento.
- **`profiles` protegida.** O usuário pode editar apenas `display_name`, `phone`, `avatar_path` e `updated_at`, porque o `UPDATE` da tabela inteira foi revogado em `20261028203211`. Então ninguém consegue se promover a `platform_owner` pela API.
- **HTML da prévia escapado.** A prévia social (`server/invite-preview.cjs`) escapa o HTML gerado.

## Achados

### 1. Coadministrador pode gerenciar acessos diretamente (médio)

A política `trip_access.access_managed_by_organizer` (`for all`, `is_trip_organizer`) deixa qualquer pessoa com papel `organizer` na viagem inserir ou apagar linhas de `trip_access` direto pela API REST, sem passar pelo fluxo de convite. Na prática, um coadministrador pode:

- conceder `organizer` a qualquer `profile_id` que ele conheça;
- remover outros coadministradores.

O dono continua protegido porque o acesso dele vem de `trips.organizer_id`.

**Sugestão:** trocar `for all` por políticas só de `select` e fazer inclusões e remoções apenas via RPC. As RPCs `accept_trip_invite`, `revoke_trip_participant_access` e similares já existem. Na revisão, o front não faz nenhuma chamada `from('trip_access')`, então a mudança não deve afetar a interface. Mesmo assim, teste o fluxo de convite de administrador num projeto de staging antes de aplicar.

### 2. `payment_submissions`: rascunho pode trocar de viagem ou participante (baixo, latente)

A política `submissions_update_own_draft` revalida apenas `submitted_by`, `status` e os campos de revisão. Ela não revalida `trip_id`, `participant_id` nem `can_access_trip`. Assim, quem envia um rascunho pode editá-lo e apontá-lo para outra viagem ou para outro participante. A política de `insert` exige vínculo, mas a de `update` não.

Hoje o front não usa essa tabela (o fluxo atual é `shopping_purchase_submissions` via RPC), então o risco é latente. **Sugestão:** antes de ativar, repetir na `with check` do update as mesmas condições da política de insert, ou bloquear a troca de `trip_id`/`participant_id` com um trigger `before update`.

### 3. `submissions_organizer_review` sem restrição de colunas (baixo)

O organizador pode alterar qualquer coluna do envio, inclusive `submitted_by` e `amount_cents`. Se o fluxo de comprovantes for ativado, faça a conferência via RPC, que só muda `status`, `reviewed_by`, `reviewed_at` e `confirmed_payment_id`.

### 4. Privilégios padrão do Supabase em tabelas novas (informativo)

Por padrão, o Supabase concede `ALL` a `anon` e `authenticated` em tabelas novas do schema `public`. Hoje isso está neutralizado porque todas as tabelas têm RLS. Para não depender disso numa tabela futura em que alguém esqueça o `enable row level security`, considere:

```sql
alter default privileges in schema public revoke all on tables from anon;
```

**Verificar** antes de aplicar se nenhuma tabela precisa de leitura anônima direta. Pela revisão, nenhuma precisa.

### 5. Cobrança desligada (informativo)

Os planos Grátis (10 pessoas, 1 planejamento ativo), Essencial (R$ 9,90) e Completo (R$ 19,90) estão cadastrados, mas `checkout_enabled` e `enforcement_enabled` estão em `false`. Quando os limites forem ligados, eles precisam ser verificados nas RPCs que criam participantes e planejamentos, não no front. Hoje `get_planning_plan` só informa os limites.

## Correções aplicadas em 2026-11-25

A migration `20261125120000_harden_access_and_submissions.sql` corrige os achados 1 a 4, e o teste `supabase/tests/access_hardening.sql` cobre cada um deles:

- **Achado 1:** a política `access_managed_by_organizer` foi removida e `insert/update/delete` em `trip_access` foram revogados de `authenticated`. A leitura continua igual. Todas as funções que escrevem nessa tabela são `security definer`, então convites, vínculos, revogação e administradores seguem funcionando.
- **Achados 2 e 3:**
  - Corrigido também um bug na política de envio: `tp.trip_id=trip_id` comparava a coluna com ela mesma, então aceitava participante de outra viagem.
  - O update agora é limitado por coluna: `trip_id`, `participant_id` e `submitted_by` não mudam mais.
  - O organizador só altera os campos de revisão, sempre com `reviewed_by` igual à própria conta.
  - O trigger `guard_payment_submission_update` impede que outra pessoa altere valor, data ou observação.
- **Achado 4:**
  - `anon` perdeu o acesso direto a todas as tabelas e sequências, inclusive nos privilégios padrão de objetos futuros.
  - Nas funções, `anon` ficou só com as quatro prévias públicas.
  - O acesso de `authenticated` e `service_role` às funções foi preservado exatamente como estava.

Validado num PostgreSQL 16 local, com uma simulação mínima do Supabase (papéis, `auth.uid()`, `storage`):
- as 52 migrations aplicam em sequência;
- os 17 testes de `supabase/tests/` passam;
- a comparação de privilégios antes e depois mostra que `authenticated` não perdeu nenhuma função.

## Tabela por tabela (políticas efetivas)

| Tabela | Leitura | Escrita |
|---|---|---|
| profiles | o próprio usuário | o próprio usuário, só 4 colunas |
| travel_groups, group_members, family_relationships | dono do grupo | dono do grupo |
| trips | organizadores | insert: dono do grupo; update: organizador que também é dono do grupo |
| trip_access | o próprio usuário ou organizadores | só RPC (corrigido) |
| trip_participants | organizadores ou participante vinculado com acesso | organizadores |
| trip_invites, trip_join_links | organizadores | organizadores |
| trip_snapshots | organizadores | só RPC (`sync_trip_snapshot`) |
| audit_events | organizadores | só RPC/trigger |
| member_profile_links | o próprio usuário ou dono do grupo | só RPC |
| migration_imports | dono | dono |
| payment_submissions | organizador ou quem enviou | quem enviou, só no próprio cadastro; organizador, só nos campos de revisão (corrigido) |
| payment_receipts | organizador ou quem enviou | quem enviou |
| demais 15 tabelas | só RPC | só RPC |
