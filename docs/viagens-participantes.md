# Viagens: acesso do participante e compras colaborativas

Status: escopo aprovado em 28/10/2026; implementação funcional pendente.
Ajuste inicial publicado separadamente: Pessoas responsivo e ação Vincular acesso por pessoa.

## Regras
- Vincular uma conta ao participante existente, sem criar outra pessoa nem reescrever histórico.
- Aceite de acesso e presença são estados independentes. Pagamentos já atribuídos confirmam a presença; gerar, expirar ou revogar vínculo não exclui a pessoa da divisão.
- Cada perfil pode organizar novos planejamentos e participar de outros.
- Papéis de organizador e participante são distintos; acesso de um não altera o outro.
- Dados financeiros pessoais somente para o próprio participante ou responsável explicitamente autorizado. Não liberar família ou Turma automaticamente.

## Vínculo por WhatsApp proposto
1. Administrador escolhe cadastro existente e informa telefone com país/DDD.
2. Sistema gera token individual, aleatório, com validade, uso único e revogação; guardar somente hash.
3. Administrador envia link pelo WhatsApp (sem envio automático).
4. Destinatário cria ou acessa conta com e-mail confirmado.
5. Solicita vínculo; administrador confere conta e aprova antes de expor histórico financeiro.
6. Aprovação associa profile_id ao member_id e concede acesso apenas à viagem escolhida, com auditoria.
Telefone é contato, não chave permanente nem prova de posse. Não vincular por nome ou telefone digitado. Normalizar formato, sinalizar ambiguidades. Se houver verificação real de telefone por código no futuro, reavaliar necessidade de aprovação.
Convite existente por e-mail confirmado continua funcionando durante transição.

## Área do participante
- Geral: foto, datas (início e fim), endereço, orientações e estado da viagem.
- Minha participação: cadastro associado, pagante/não pagante.
- Minhas contribuições: cotas/parcelas, pagamentos que lhe foram atribuídos, crédito e pendências. Valores coletivos não devem revelar pagamentos individuais alheios.
- Meus custos: compras gerais, consumo específico, outras despesas, desconto de saldo anterior quando aplicável; explicar previsão versus despesa confirmada versus pagamento recebido.
- Compras: lista completa, quantidade, unidade, valor previsto/real e situação. Mostrar apenas dados compartilháveis.
- Participantes: nomes, fotos autorizadas e estado de acesso sem confundir com presença.
- Hospedagem: sua acomodação e orientações, quando cadastradas; sem preferências privadas de terceiros.

## Compras colaborativas
- Participante vinculado informa compra de item pendente: quantidade efetiva, valor, data, observação e comprovante opcional.
- Identidade do comprador vem da sessão no servidor, nunca do formulário.
- Estado enviado para conferência; exibir quem informou e evitar duas compras simultâneas do mesmo item sem aviso.
- Administrador aprova, solicita ajuste ou rejeita. Só aprovação atualiza a compra e os custos oficiais.
- Registrar separadamente quem comprou, quem pagou e origem do dinheiro (pessoal ou caixinha).
- Compra com dinheiro pessoal aprovada gera valor a acertar; administrador escolhe reembolso ou abatimento autorizado da cota.
- Não transformar automaticamente em contribuição paga nem descontar duas vezes. Rejeição/cancelamento deve preservar trilha e reverter apenas efeitos correspondentes.
- Submissão pertence à viagem e ao participante vinculado; remoção/revogação bloqueia novas submissões.

## Rateio dos centavos
Problema identificado: divisão por item envia sempre os restos às primeiras pessoas.
Proposta: totalizar por conjunto de pagantes e tipo de custo; dividir cada total mantendo soma exata, diferença de no máximo um centavo em partes iguais. Se houver detalhamento por item, equilibrar os resíduos. Nunca alterar preços nem pagamentos históricos.
Garantir grupos sobrepostos, não pagantes, pessoas removidas, custo sem pagantes e saldo anterior.

## Sequência
1. Validar regra monetária e corrigir centavos com testes de soma e grupos.
2. Separar estados de presença e vínculo no servidor.
3. Implementar solicitação/aprovação de vínculo por telefone, mantendo convite por e-mail.
4. API privada do extrato pessoal e telas de viagem.
5. Submissões de compras, conferência administrativa e acertos.
6. Conferir hospedagem, mobile e fluxo completo antes de enviar vínculos reais.

## Validação de liberação
Testar duas contas e um administrador: vínculo correto, conta incorreta, token expirado/reutilizado, cadastro já vinculado, troca de aparelho, atualização da página, revogação, tentativa de ler extrato alheio, preservação de pagamentos e presença durante convite, compras concorrentes, aprovação repetida e acerto sem duplicidade. Nenhum convite real deve ser enviado durante os testes.
