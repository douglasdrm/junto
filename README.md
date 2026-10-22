# Juntô — MVP local de viagens em grupo

Abra `index.html` no navegador. Não é necessário instalar nada.

## O que funciona
- Criar, selecionar e editar viagens isoladas entre si
- Definir destino, datas, hóspedes, orçamento, prazo e regra de divisão
- Organizar núcleos familiares e responsáveis financeiros
- Cadastrar adultos e crianças com cotas integrais, fracionárias ou isentas
- Calcular a idade na data da viagem somente quando o nascimento é informado
- Visualizar e confirmar o rateio antes de atualizar as metas individuais
- Preservar metas personalizadas durante a redistribuição do orçamento
- Registrar contribuições parciais para uma ou várias pessoas
- Cadastrar despesas previstas e pagas, inclusive parcelas do imóvel
- Acompanhar o resumo sem confundir orçamento, caixa e gastos
- Distribuir pagamentos de forma igualitária ou personalizada entre beneficiários
- Consultar contribuições por participante, mês e evolução financeira
- Consultar quanto cada núcleo deve, pagou e ainda precisa contribuir
- Salvar links de casas e preços cotados manualmente
- Abrir pesquisa do Google configurada para a viagem
- Exportar/importar backup JSON
- Persistir os dados no armazenamento local do navegador

## Limitações importantes
- Protótipo sem servidor, autenticação ou segurança multiusuário.
- O painel admin mostra apenas os dados deste navegador.
- Ninguém mais vê os dados que você preencher.
- Não há leitura automática de anúncios, preços, disponibilidade ou pagamentos.
- A viagem inicial está identificada como demonstração e seus valores são ilustrativos.
- Não use informações financeiras sensíveis ou de outras pessoas neste protótipo.

## Próxima etapa para produção
Next.js + Supabase Auth/Postgres, isolamento por grupo via RLS, permissões organizador/participante/admin da plataforma, consentimento de recebimento de propostas, auditoria e implantação HTTPS.
