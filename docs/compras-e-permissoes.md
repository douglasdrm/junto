# Compras, comprovantes e permissões

## Compras compartilhadas
- O participante com cadastro vinculado registra um item pendente ou uma compra adicional, quantidade, total, data, origem do dinheiro e observação.
- Foto JPG/PNG/WebP ou PDF de até 10 MB é opcional. No celular há seleção de arquivo e captura de foto pelo navegador.
- O envio pelo participante fica pendente. Só a aprovação administrativa altera o item oficial; recusar não altera despesas.
- O administrador registra diretamente suas próprias compras e pode anexar notas a itens já comprados sem duplicar o item.
- Arquivos ficam no bucket privado shopping-receipts. Somente o autor e os organizadores autorizados da viagem podem consultar; URLs de leitura duram cinco minutos.
- Compra aprovada e contribuição paga são coisas separadas. Este fluxo não realiza reembolso, abatimento nem pagamento automático.
- Antes de aprovar, conferir se a compra foi feita com dinheiro pessoal ou da caixinha. O acerto financeiro permanece manual.

## Administração
- platform_owner representa administração da plataforma; usuários não podem editar essa coluna pelo perfil.
- Organizador de evento/viagem é uma permissão local, independente de administração global.
- Pessoas → Gerenciar administradores mostra criador, administradores convidados e convites pendentes.
- É possível gerar até vinte convites individuais por vez, cada um vinculado ao e-mail confirmado de quem aceitar.
- O envio abre um rascunho no aplicativo de e-mail do organizador. Não existe envio transacional automático configurado; gerar o convite não envia mensagem.
- Administradores podem retirar outros administradores do planejamento. O criador não pode ser retirado por esse fluxo. Remover a administração preserva eventual papel de participante e pagamentos.
- Nenhum convite real foi enviado durante os testes e nenhum papel de usuário real foi alterado.

## Validação
Testes de banco com rollback: vínculo e identidade, isolamento antes da aprovação, aprovação/rejeição e repetição, preservação de pagamentos, autorização de recibos, histórico próprio, retirada de administração local e bloqueio de edição do privilégio global.
Testes de interface com serviços simulados: envio de arquivo, parâmetros da compra, geração de links, Sou eu, aprovação e rascunhos individuais por e-mail.
A captura nativa da câmera depende do dispositivo e precisa de validação em celular real.
