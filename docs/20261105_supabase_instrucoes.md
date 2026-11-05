# Atualização manual do Supabase — reentrada e respostas

O código da interface foi enviado ao GitHub. Daqui em diante, as alterações no Supabase serão executadas por você.

## O que já aconteceu

A migração `20261105173844_reinvitation_after_removal_and_preview_card.sql` já foi aplicada antes dessa orientação. Não precisa executá-la novamente.

Durante o teste de reentrada, foi identificado que retirar alguém pode manter uma linha antiga em `trip_access`, embora o acesso esteja bloqueado. O ajuste complementar abaixo trata essa linha corretamente: “Ainda não sei” continua pendente e a confirmação restaura o mesmo participante.

## Executar agora

1. Abra o projeto do Juntô no Supabase.
2. Entre em **SQL Editor → New query**.
3. Copie TODO o conteúdo de `supabase/manual/20261105_reentrada_e_respostas.sql`.
4. Execute com **Run**. Não use o arquivo antigo mencionado acima. Ao final, as três colunas de verificação devem retornar `true`.
5. Atualize o Juntô e, em **Pessoas → Respostas ao convite**, clique em **Atualizar**.

Esse arquivo reúne duas migrações: o complemento da reentrada e a leitura das respostas para administradores/notificações. Não altera pagamentos, valores ou despesas. A restauração da remoção só acontece quando a própria pessoa confirma usando um convite gerado depois da retirada. “Revogar acesso” continua exigindo restauração pelo organizador.

## O que conferir

- Sem selecionar evento: Visão geral mostra quantos você organiza, quantos participa e atalhos para abrir.
- No card do evento: clique nas fotos/iniciais para abrir Pessoas. Para convidados, abre a lista compartilhada de confirmados.
- Em Pessoas: controles agrupados, indicadores compactos e editar/retirar por ícones.
- Responda “Ainda não sei” com uma conta de teste: deve aparecer em **Pessoas → Respostas ao convite** e **Notificações** do administrador. Não entra no rateio nem confirma presença.
- Retire a pessoa de teste, gere NOVO convite e aceite com a MESMA conta. Deve voltar uma única vez, com histórico preservado.
- Um acesso explicitamente revogado não deve ser liberado por convite geral.

## Limites da validação

Os testes locais verificam navegação, contagens da conta, controles acessíveis e apresentação das respostas. O SQL complementar não foi executado por mim, conforme sua orientação. O teste de reentrada no banco deve ser repetido após você aplicar o arquivo.
