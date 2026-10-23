# Juntô — MVP local de viagens em grupo

Abra `index.html` no navegador. Não é necessário instalar nada.

## O que funciona
- Criar, selecionar e editar viagens isoladas entre si
- Criar uma viagem rapidamente com apenas nome, destino opcional e participantes
- Misturar pessoas novas, pessoas permanentes e Turmas no cadastro inicial
- Criar grupos permanentes reutilizáveis em várias viagens
- Cadastrar pessoas uma única vez e selecioná-las em novas viagens
- Manter vínculos familiares e preferências de hospedagem opcionais
- Remover alguém de uma viagem sem excluir seu cadastro permanente
- Definir destino, datas, hóspedes, orçamento, prazo e regra de divisão
- Organizar núcleos familiares e responsáveis financeiros
- Cadastrar adultos e crianças com cotas integrais, fracionárias ou isentas
- Calcular a idade na data da viagem somente quando o nascimento é informado
- Visualizar e confirmar o rateio antes de atualizar as metas individuais
- Preservar metas personalizadas durante a redistribuição do orçamento
- Escolher entre caixinha mensal, rateio por orçamento e metas personalizadas
- Acompanhar competências previstas sem confundi-las com dinheiro recebido
- Classificar um pagamento em uma ou várias competências mensais
- Consultar saldo real, pendências, contribuições futuras e projeção da caixinha
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
- Escolher entre juntar dinheiro primeiro ou dividir um custo conhecido
- Acompanhar contribuições em uma grade mensal simples
- Registrar rendimentos manuais e decidir o destino das sobras
- Manter listas de compras anuais, custos e itens que sobraram

## Contas online — fundação da Etapa 5

O modo local continua sendo o padrão. A base para login por link de e-mail e perfis online está preparada, mas só é ativada depois da configuração do Supabase.

1. Crie um projeto no Supabase.
2. Execute, na ordem, os arquivos de `supabase/migrations/` pelo fluxo de migrations do projeto.
3. Copie a URL e a chave **publicável** para `supabase/config.js`.
4. Configure em Authentication as URLs de redirecionamento locais e de produção.
5. Crie a primeira conta pela opção “Entrar” e promova-a a proprietária diretamente no SQL Editor:

```sql
update public.profiles
set platform_owner = true
where id = (select id from auth.users where email = 'EMAIL_DO_PRIMEIRO_ORGANIZADOR');
```

Nunca coloque a `secret key` ou a chave `service_role` em arquivos servidos pelo site. A conta online ainda não migra nem sincroniza automaticamente os dados do `localStorage`.

## Limitações importantes
- O modo multiusuário está em implantação; nesta primeira fundação apenas login e perfil estão preparados.
- O painel admin mostra apenas os dados deste navegador.
- Ninguém mais vê os dados que você preencher.
- Não há leitura automática de anúncios, preços, disponibilidade ou pagamentos.
- A viagem inicial está identificada como demonstração e seus valores são ilustrativos.
- Não use informações financeiras sensíveis ou de outras pessoas neste protótipo.

## Próxima etapa para produção
Next.js + Supabase Auth/Postgres, isolamento por grupo via RLS, permissões organizador/participante/admin da plataforma, consentimento de recebimento de propostas, auditoria e implantação HTTPS.
