'use strict';
/* Presentation only. Reuse shared SVGs and never decorate event names or item titles. */
if(!juntoIconPaths.settings)juntoIconPaths.settings='<path d="m9 3-.5 2-2 1-2-.5-2 3.5L4 11v2l-1.5 2 2 3.5 2-.5 2 1 .5 2h6l.5-2 2-1 2 .5 2-3.5-1.5-2v-2l1.5-2-2-3.5-2 .5-2-1-.5-2Z"/><circle cx="12" cy="12" r="3"/>';
function sectionIconForTitle(title){
 const text=String(title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const groups=[['settings',/configur|ajuste|regras/],['image',/foto|galeria|imagem/],['person',/cadastrar pessoa|cadastro pessoal|perfil|minha conta/],['users',/pessoa|participante|viajante|grupo|acompanhante|administrador|quem vai/],['share',/convite|acesso|compartilh|notific/],['bag',/compr|mercado|prato|levar|lista|carrinho/],['receipt',/relatorio|extrato|historico|comprovante|nota fiscal/],['wallet',/financ|caixinha|saldo|rateio|custo|despes|contribui|pagamento|parcela|rendimento|arrecad|orcamento|reembolso/],['pin',/local|endereco|destino|hosped|quarto|mapa|partida/],['calendar',/viage|evento|planejamento|encontro|data|horario|agenda|proxim/],['home',/visao geral|comecar|inicio/],['check',/resposta|confirm|situacao|conclu/]];
 return groups.find(([,pattern])=>pattern.test(text))?.[0]||'calendar';
}
function decorateContentSectionIcons(){
 const app=document.querySelector('#app');if(!app)return;
 app.querySelectorAll('h2,.section-head h3,section.card > h3').forEach(heading=>{
  if(heading.closest('.visual-event-card,.planning-hero,.directory-event-card,.invitation-event-card,.potluck-item-card,.compact-payment-person')||heading.querySelector('svg,.ds-icon,.section-title-icon,.content-section-icon'))return;
  if(!heading.textContent.trim())return;
  const icon=document.createElement('span');icon.className='content-section-icon';icon.setAttribute('aria-hidden','true');icon.dataset.sectionIcon=sectionIconForTitle(heading.textContent);icon.innerHTML=juntoIcon(icon.dataset.sectionIcon);heading.classList.add('section-heading-with-icon');heading.prepend(icon);
 });
}
const renderBeforeContentSectionIcons=render;
render=function(...args){renderBeforeContentSectionIcons(...args);decorateContentSectionIcons()};
// Shared participant sections and response panels also arrive asynchronously.
let sectionIconUpdateQueued=false;
const sectionIconObserver=new MutationObserver(records=>{
 if(sectionIconUpdateQueued||!records.some(record=>Array.from(record.addedNodes).some(node=>node.nodeType===1&&(node.matches?.('h2,h3')||node.querySelector?.('h2,h3')))))return;
 sectionIconUpdateQueued=true;queueMicrotask(()=>{sectionIconUpdateQueued=false;decorateContentSectionIcons()});
});
const sectionIconRoot=document.querySelector('#app');if(sectionIconRoot)sectionIconObserver.observe(sectionIconRoot,{childList:true,subtree:true});
decorateContentSectionIcons();
