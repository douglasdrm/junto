# Resumo coletivo e extrato pessoal

Administrador e participante consultam o mesmo cálculo sobre o snapshot online do planejamento.

- Previsão final: no modo de caixinha, saldo inicial mais as contribuições configuradas; no rateio, os custos considerados no plano.
- Arrecadado: contribuições recebidas, sem somar saldo anterior nem rendimento como se fossem pagamentos de participantes.
- Falta para a previsão: máximo entre zero e previsão menos saldo inicial, arrecadado e rendimento líquido.
- Disponível: saldo inicial mais contribuições recebidas e rendimento líquido, menos despesas efetivamente pagas.
- Compras discriminadas não são contadas novamente quando já existe um lançamento geral de mercado. Rendimento usa a última conferência líquida, ou os lançamentos de rendimento se não houver conferência.

O valor para alcançar a meta global não substitui as parcelas individuais configuradas. Rendimentos não são automaticamente lançados como contribuições pessoais ou perdão de parcelas.

## Meu financeiro

A conta vinculada consulta apenas seu próprio relatório: total previsto, total pago atribuído ao cadastro, saldo a pagar, crédito, parcelas atuais/futuras e histórico. Pagamentos coletivos mostram somente a parcela atribuída à pessoa, sem valores, pagadores, observações ou alocações dos demais.

A identidade é resolvida no servidor pelo vínculo ativo do perfil ao participante daquela viagem/evento. Não existe parâmetro para escolher outra pessoa. Uma conta sem vínculo recebe uma indicação de indisponibilidade, e não um extrato aproximado. Ser administrador global não permite consultar o extrato de terceiros por esse endpoint.

Os cálculos preservam o plano do administrador, incluindo grupos de consumo, ordem da divisão dos centavos e desconto de saldo inicial no rateio. O resumo público não inclui o mapa de metas individuais. As funções internas não são executáveis pelos clientes.

Validação: supabase/tests/shared_finance.sql cobre paridade entre visões, saldo/rendimento, parcelas, privacidade de pagamentos coletivos, grupos e isolamento. tests/shared-finance.cjs cobre exibição, navegação, paridade com o administrador e falhas explícitas de consulta.
