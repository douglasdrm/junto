# Juntô — planejamento em grupo

Abra `index.html` no navegador. Não é necessário instalar nada.

## O que funciona
- Escolher entre organizar uma viagem ou um evento, com fluxos e textos próprios
- Criar, selecionar e editar planejamentos isolados entre si
- Criar um planejamento rapidamente com apenas nome, local ou destino opcional e participantes
- Misturar pessoas novas, pessoas permanentes e Turmas no cadastro inicial
- Criar grupos permanentes reutilizáveis em várias viagens
- Cadastrar pessoas uma única vez e selecioná-las em novas viagens
- Manter vínculos familiares e preferências de hospedagem opcionais
- Remover alguém de uma viagem sem excluir seu cadastro permanente
- Definir destino, datas, hóspedes, orçamento, prazo e regra de divisão
- Organizar núcleos familiares e responsáveis financeiros
- Cadastrar adultos e crianças com cotas integrais, fracionárias ou isentas
- Calcular a idade na data da viagem somente quando o nascimento é informado
- Visualizar e confirmar o rateio antes de atualizar as metas individuais
- Preservar metas personalizadas durante a redistribuição do orçamento
- Escolher entre caixinha mensal, rateio por orçamento e metas personalizadas
- Acompanhar competências previstas sem confundi-las com dinheiro recebido
- Classificar um pagamento em uma ou várias competências mensais
- Consultar saldo real, pendências, contribuições futuras e projeção da caixinha
- Registrar contribuições parciais para uma ou várias pessoas
- Cadastrar despesas previstas e pagas, inclusive parcelas do imóvel
- Acompanhar o resumo sem confundir orçamento, caixa e gastos
- Distribuir pagamentos de forma igualitária ou personalizada entre beneficiários
- Consultar contribuições por participante, mês e evolução financeira
- Consultar quanto cada núcleo deve, pagou e ainda precisa contribuir
- Salvar links e preços de casas, hospedagens, espaços ou outras locações
- Abrir pesquisa do Google configurada para viagem ou evento
- Exportar/importar backup JSON
- Persistir os dados no armazenamento local do navegador
- Escolher entre juntar dinheiro primeiro ou dividir um custo conhecido
- Acompanhar contribuições em uma grade mensal simples
- Registrar rendimentos manuais e decidir o destino das sobras
- Manter listas de compras anuais, custos e itens que sobraram

## Contas online — Etapa 5

O modo local continua disponível. Depois da configuração do Supabase, uma viagem ou evento pode ser levado para a conta do organizador, sincronizado e compartilhado com outro administrador por convite.

1. Crie um projeto no Supabase.
2. Execute, na ordem, os arquivos de `supabase/migrations/` pelo fluxo de migrations do projeto.
3. Copie a URL e a chave **publicável** para `supabase/config.js`.
4. Configure em Authentication as URLs de redirecionamento locais e de produção.
5. Crie a primeira conta pela opção “Entrar” e promova-a a proprietária diretamente no SQL Editor:

```sql
update public.profiles
set platform_owner = true
where id = (select id from auth.users where email = 'EMAIL_DO_PRIMEIRO_ORGANIZADOR');
```

Depois de entrar, abra “Minha conta” e leve o planejamento para sua conta. A partir daí, as alterações são sincronizadas. O botão “Convidar administrador” cria um link de uso único, válido por sete dias, que pode ser enviado pelo WhatsApp.

O acesso aceita e-mail e senha, recuperação de senha e Google. Para o Google, habilite o provedor em **Authentication → Providers → Google**, informe as credenciais OAuth do Google e cadastre no Google a URL de callback exibida pelo Supabase. Mantenha também a URL pública do aplicativo na lista de URLs de redirecionamento permitidas. O convite é preservado durante o login e aceito automaticamente depois que a conta é autenticada.

Nunca coloque a `secret key` ou a chave `service_role` em arquivos servidos pelo site.

O `vercel.json` aplica uma Content-Security-Policy a todo o site. Ela só libera scripts do próprio domínio (o `supabase-js` fica em `vendor/`) e só libera conexões com o projeto Supabase de `supabase/config.js`. **Ao trocar de projeto Supabase, atualize também o `connect-src` do `vercel.json`**; o teste `tests/security-headers.cjs` acusa a divergência. Somente a viagem escolhida é enviada; as demais continuam locais até serem conectadas individualmente.

## Limitações importantes
- A sincronização usa revisões para impedir que dois administradores sobrescrevam silenciosamente as alterações um do outro. Se houver conflito, reabra a viagem online antes de editar.
- O painel administrativo da plataforma ainda não gerencia usuários, convites ou permissões em uma tela própria.
- Não há leitura automática de anúncios, preços, disponibilidade ou pagamentos. Pagamentos registrados não são transferências nem Pix confirmados.
- Planos e preços já existem no banco (`junto_plan_catalog`: Grátis, Essencial e Completo, provedor Asaas), mas `checkout_enabled` e `enforcement_enabled` estão desligados: ninguém consegue pagar e os limites ainda não são aplicados.
- A viagem inicial está identificada como demonstração e seus valores são ilustrativos.

## Recursos já disponíveis além da Etapa 5
Convites individuais de participantes, convites gerais para eventos, administradores por evento, envio e conferência de comprovantes de compra, lista "quem leva o quê", acompanhantes e resumo financeiro compartilhado. Os detalhes estão em `docs/`.

## Grupos da conta

Grupos, pessoas, Turmas, vínculos familiares, mapa e preferências de quarto pertencem à conta (`account-people.js`). Eles ficam disponíveis no menu "Pessoas", aba "Grupos e família", mesmo sem um planejamento aberto. São salvos com revisão pelas funções `get_account_people_workspace` e `save_account_people_workspace` (migration `20261126120000_account_people_workspace.sql`).

Na primeira entrada depois da migration, a conta é inicializada com os grupos dos planejamentos dos quais a pessoa é dona. Grupos que só existem em planejamentos de outras pessoas não entram na conta: um coadministrador continua vendo esses grupos apenas com o planejamento aberto. Enquanto a migration não for aplicada, o app funciona como antes.

## Testes

Os testes rodam automaticamente em cada pull request (`.github/workflows/tests.yml`). Para rodar localmente:

```bash
cd tests && npm ci && npm test
```

O `package.json` fica em `tests/` para não mudar o deploy estático da Vercel. `npm test -- potluck` roda só os testes cujo nome contém "potluck".

Banco: `supabase/ci/run-tests.sh` aplica todas as migrations num PostgreSQL vazio, com uma simulação mínima do Supabase, e roda `supabase/tests/*.sql`. A conexão usa as variáveis `PGHOST`, `PGUSER` e `PGPASSWORD`. Os testes SQL também podem ser executados no SQL Editor de um projeto de staging: cada um desfaz tudo no final.

## Documentação técnica
- `docs/auditoria-rls.md` — revisão das políticas de segurança do Supabase.
- `docs/plano-refatoracao-front.md` — plano para sair dos arquivos `stage*` e adotar um build com módulos.
