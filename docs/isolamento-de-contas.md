# Isolamento das contas

- Administração da plataforma, funcionalidades disponíveis e administração de um planejamento são conceitos independentes.
- Não há cobrança ou limites premium implantados atualmente; usuários registrados podem criar e organizar seus próprios planejamentos.
- A propriedade dos grupos é filtrada pelo usuário. Snapshots administrativos exigem ser criador ou organizador autorizado do planejamento. O indicador platform_owner não ignora essas verificações.
- Um convite aceito permite acesso apenas ao planejamento correspondente, no papel autorizado.
- Ao iniciar o app, trocar de conta ou sair, o estado de tela é limpo antes de consultar os planejamentos autorizados no servidor.
- Cópias locais de recuperação não são carregadas automaticamente em outra conta. Nenhum registro online é apagado nessa limpeza.
- Consultas de perfil, planejamento e área do participante descartam respostas se a conta tiver mudado durante a requisição.
- Teste: NODE_PATH apontando para uma instalação de jsdom, executar node tests/account-isolation.cjs.
