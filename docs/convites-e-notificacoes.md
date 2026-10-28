# Entrada por convite e notificações do organizador

- O link individual de vínculo abre uma saudação antes do login, com primeiro nome e nome do planejamento. Explica que a conta será associada ao cadastro existente e que o organizador precisa aprovar.
- O contexto continua presente no login, cadastro e solicitação depois da autenticação. Entrar com Google ou e-mail preserva o convite.
- O preview público aceita somente o token individual aleatório. Retorna status, primeiro nome, nome e tipo do planejamento. Não retorna dados financeiros, contatos, endereço nem identidade da conta solicitante. Links inválidos ou expirados não revelam esses dados.
- A solicitação só é considerada enviada após confirmação do servidor. Ela é armazenada em participant_access_links com status requested, requested_by e requested_at.
- O sino e o menu Notificações mostram solicitações de vínculo e compras aguardando conferência em todos os planejamentos que a conta administra. Administração global não ignora a autorização por planejamento.
- Pessoas mostra um card com os pedidos do planejamento selecionado. É possível aprovar ou recusar ali ou na central; conferir primeiro o nome e o e-mail da conta solicitante.
- A consulta ocorre ao voltar para a aba, recuperar conexão, atualizar manualmente e a cada 45 segundos com a página visível. São notificações dentro do site, sem envio de e-mail ou push.
- Falha de consulta é exibida como indisponibilidade, não como lista vazia. Pedidos expirados e já analisados saem do contador.
- Testes de banco usam transação com rollback; testes de interface cobrem saudação, login contextual, envio, notificações, aprovação/recusa, falha, expiração e troca de conta. Nenhuma solicitação real é aprovada automaticamente durante a verificação.
