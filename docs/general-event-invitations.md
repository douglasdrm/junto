# Convite geral com conta permanente

O convite geral (`?join=`) é diferente do vínculo individual (`?invite=access:`). O segundo mantém o fluxo de aprovação e os registros existentes.

## Comportamento

- Um visitante abre a saudação e a prévia sem autenticação. A prévia é uma lista explícita de campos: nome, tipo, capa, datas, horário e região. Contatos, participantes, pagamentos e endereço completo não são públicos.
- Para responder, precisa entrar/criar uma conta permanente. O retorno do login preserva o token e a intenção de resposta.
- Ao abrir com uma conta, o convite fica salvo como pendente. “Ainda não sei” mantém a presença não confirmada. Nenhum desses estados cria participante, acesso privado ou contribuição financeira.
- “Quero participar” confirma nome/telefone opcional e usa a mesma lógica existente de entrada, com bloqueio de conta anônima e idempotência.
- Convites pendentes aparecem em **Viagens e eventos → Convites recebidos**. É possível responder depois sem guardar o token bruto no banco.
- Links inativos, vencidos e revogações são conferidos no servidor novamente ao responder.
- Contas anônimas antigas podem vincular e confirmar e-mail pelo fluxo existente, preservando sua identidade. Não há conversão ou exclusão automática de participantes antigos.

## Implementação

`event-invitations.js` reutiliza modais, autenticação e diretório. `trip_invitation_responses` é privada, com RLS e sem acesso direto pelo cliente. RPCs validam a conta e a propriedade do convite. O helper de participação não tem permissão de execução para clientes.

## Verificação

`NODE_PATH=/tmp/junto-dom-test/node_modules node tests/event-invitations.cjs` (requer jsdom).

Testados também os fluxos existentes de vínculo individual, navegação e isolamento de contas. No banco, uma transação revertida verificou: prévia sem dados privados, pendente/maybe sem participante ou acesso, isolamento do convite salvo, aceitação repetida sem duplicação, pagamentos preservados e rejeição de links desativados/visitantes.

Layout de pessoas conferido em 360, 390, 768 e 1280 px e texto ampliado. Ainda requer teste real com Google/e-mail e com o smartphone que apresentou o problema.

## Ativação

Publicação autorizada novamente em 05/11/2026. A migração de compatibilidade preservou o cliente anterior durante a preparação. Após publicar o cliente permanente, aplicar `activate_registered_join_after_client_release` para rejeitar contas anônimas também no endpoint legado. Nenhum participante ou pagamento é alterado por essa ativação.
