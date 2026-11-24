# Plano de refatoração do front-end

## Situação atual

- O `index.html` carrega **11 scripts em sequência** (`app.js`, `stage2.js` … `stage44.js`), o `supabase-js` da CDN e **mais de 25 scripts `defer`**. Todos compartilham o escopo global.
- O app funciona por **sobrescrita**: **22 funções** são definidas mais de uma vez, e a última carregada vence. Exemplos:
  - `finance()` existe em `app.js`, `stage2.js`, `stage3.js` e `stage42.js`;
  - `participants()` existe em `app.js`, `stage2.js`, `stage3.js` e `stage4.js`;
  - `home()`, `travel()` e `admin()` seguem o mesmo padrão.

  Outros módulos embrulham funções existentes (`const originalQuickCreate = quickCreatePage`) ou corrigem o DOM depois de renderizado (`MutationObserver` em `stage43.js`, `ui-icons.js` e `section-icons.js`).
- O código foi escrito em linhas longas: `stage43.js` tem 159 KB em 381 linhas, e há 39 linhas com mais de 2.000 caracteres no projeto. Diffs e revisão ficam quase ilegíveis.
- O cache é controlado à mão com query strings como `?v=visible-quantities-compact-top-quantity-status-2-companions-form-id-fix-20261029-1`.
- São **12 arquivos CSS** em camadas que se sobrescrevem (`styles` → `theme` → `brand-theme` → `design-system` → `visual-layout` …).
- Os 23 testes em `tests/*.cjs` usam `jsdom`, mas não há `package.json`, então não existe um `npm test` que qualquer pessoa ou CI consiga rodar.

**Consequência:** cada correção pode ser desfeita por um arquivo carregado depois. Os commits recentes do tipo "fix navigation when snapshots omit preferences" são o sintoma típico disso.

## Objetivo

Chegar a um código em módulos ES com um único dono para cada tela e cada regra, e com build que gera arquivos com hash. Tudo isso **sem reescrever o app de uma vez** e sem mudar o comportamento que o usuário vê.

## Fases

### Fase 0: rede de segurança (1 dia)
1. Criar `package.json` com `jsdom` como devDependency e o script `"test": "for f in tests/*.cjs; do node $f || exit 1; done"`.
   - Na Vercel, definir *Build Command* vazio ou `npm run build` só a partir da Fase 1, e *Output Directory* como `.` até lá. Assim a presença do `package.json` não muda o deploy.
2. Rodar os testes num GitHub Action a cada PR.
3. Formatar todos os `.js` e `.css` com Prettier num **commit isolado**, só de formatação, para que os diffs seguintes fiquem legíveis. Registrar esse commit em `.git-blame-ignore-revs`.

### Fase 1: build sem mudar o código (1 a 2 dias)
1. Adotar o **Vite** com `index.html` como entrada.
2. Criar um `src/legacy.js` que importa os scripts atuais na mesma ordem do `index.html`, como scripts clássicos concatenados (ou com `import './app.js'` e `globalThis` onde for preciso).
3. Remover todas as query strings `?v=`, porque o Vite passa a gerar arquivos com hash.
4. Instalar `@supabase/supabase-js` via npm e eliminar a CDN. Isso também resolve a falta de SRI.
5. Verificar o deploy de preview na Vercel e só então fazer o merge.

### Fase 2: consolidar por tela (incremental, uma tela por PR)
Para cada função sobrescrita, a versão que vale é a **última carregada**. Para cada tela:
1. Identificar a versão final (por exemplo, `finance()` em `stage42.js`) e todas as funções embrulhadas que ela usa.
2. Mover essa versão para `src/screens/finance.js` como `export function finance()`.
3. Apagar as versões antigas de `app.js` e dos `stage*.js`.
4. Rodar os testes, conferir no preview e fazer o merge.

Ordem sugerida, da mais sobrescrita para a menos: `finance`, `participants`, `travel`, `home`, `admin`, `summary` e as demais 16.

### Fase 3: estado e serviços
- Separar em `src/services/` o acesso ao Supabase, que hoje está em `stage5-auth.js` e espalhado por vários módulos (`supabase.js`, `sync.js`, `invites.js`, `shopping.js`).
- Concentrar o estado do planejamento num único módulo (`src/state.js`), com uma função `render()` chamada após cada mudança. O objetivo é eliminar os `MutationObserver` que corrigem o DOM depois de renderizado.

### Fase 4: CSS
- Manter apenas os tokens de `design-system.css` e `brand-theme.css`.
- Mover o CSS de cada tela para junto do módulo dela (`src/screens/finance.css`).
- Excluir regras mortas com ajuda do relatório de cobertura do Chrome DevTools.

## O que não fazer
- Não trocar de framework (React, Vue) agora. O ganho vem de modularizar, e a troca dobraria o risco.
- Não misturar refatoração e funcionalidade nova no mesmo PR.

## Pendências relacionadas
- **SRI no `supabase-js`:** é resolvida na Fase 1. Até lá, dá para adicionar `integrity="sha384-…" crossorigin="anonymous"` com o hash gerado em <https://www.srihash.org/> para a URL fixada (`@2.117.3`).
- **Texto padrão da barra lateral:** o `index.html` traz "Dados salvos somente neste navegador", que é corrigido por `updateOnlineNote()` depois do login. Visitantes logados podem ver esse texto por um instante antes da atualização. Vale trocar o padrão do HTML por um texto neutro quando a tela for consolidada.
