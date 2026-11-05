# Login normal no convite — 05/11/2026

O convite usa o mesmo login do Juntô: Google, e-mail/senha e cadastro normal. A tela separada “Vincular e-mail e criar conta” não é mais usada pelo convite geral.

Uma sessão temporária antiga é encerrada somente neste aparelho antes do login normal. O token do convite e a resposta escolhida são preservados. Nenhum participante, pagamento ou histórico é apagado ou transferido automaticamente entre contas. Para associar uma conta nova a um participante já cadastrado, continua existindo o vínculo individual aprovado pelo organizador.

Erros de login, cadastro e Google aparecem na janela. Mensagens de confirmação de cadastro também permanecem visíveis, e os avisos gerais ficam acima do modal.

As cinco melhorias de interface já estavam no GitHub no commit 7a16e7a. Na verificação inicial, o domínio ainda servia o commit 9500472; a publicação do 7a16e7a estava INITIALIZING na Vercel. Enviar ao GitHub não significa que a versão já foi promovida ao domínio.

## Validação

- Sintaxe dos JavaScripts conferida.
- Testes com SDK simulado: visitante; sessão temporária; falha ao sair; preservação de convite/resposta; erro visível dentro do formulário.
- Teste reproduzível: `node tests/invitation-normal-auth.cjs`.
- Não foi possível executar o navegador ou a suíte completa: o ambiente de execução estava indisponível. Login real Google/e-mail ainda exige validação manual.
- Nenhuma alteração no Supabase é necessária para esta correção do login. O SQL anterior continua necessário para respostas ao administrador e complemento da reentrada.

## Conferir após a publicação

1. Abra o convite no aparelho usado anteriormente.
2. Escolha Quero participar ou Ainda não sei: deve abrir Entrar no Juntô com Google, e-mail/senha e Criar uma conta.
3. Tente uma senha incorreta: a mensagem deve aparecer dentro da janela.
4. Entre com uma conta válida e confira o retorno ao convite.
5. Confira Pessoas e Visão geral na nova publicação. Se o domínio ainda exibir a versão antiga, aguarde o deployment da branch main ficar READY; não republique um deployment antigo esperando obter arquivos novos.
