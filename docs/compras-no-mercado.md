# Lista durante a compra e uma nota fiscal por compra

1. Em Compras de mercado, iniciar uma compra.
2. Tocar em cada item para informar quantidade e preço unitário e marcar que está no carrinho. Salvar envia o item ao servidor, com controle de versão para evitar sobrescrita entre aparelhos.
3. É possível sair e voltar: a compra em andamento é retomada pela conta que a iniciou.
4. Conferir e finalizar reúne somente os itens marcados, calcula o total e permite anexar uma única foto ou PDF. O total informado na nota precisa conferir com a soma dos itens.
5. O administrador confirma diretamente; o participante envia a compra inteira para conferência. Aprovação ou recusa é aplicada ao conjunto na mesma transação.
6. Em Compras realizadas, a nota pode ser consultada ou anexada depois. Todos os itens da compra apontam para o mesmo arquivo privado.

Itens não marcados continuam pendentes. O preço no carrinho é um rascunho até finalizar/aprovar. Compras já realizadas ficam identificadas; para comprar uma quantidade adicional, usar Adicionar outro item. O fluxo não gera contribuições, reembolsos ou abatimentos automáticos.

Registros individuais anteriores continuam acessíveis e seus arquivos não são alterados. Rascunhos são privados da conta; administradores veem compras de participantes depois do envio para conferência. Fotos e PDFs continuam limitados a 10 MB e disponíveis apenas ao autor e aos administradores autorizados.

Validação: supabase/tests/market_purchase_batches.sql executa testes com rollback. tests/market-batches.cjs usa jsdom para simular salvamento, retomada, finalização, foto única, PDF posterior e aprovação. Testes de câmera física e captura em celular continuam dependentes do aparelho.
