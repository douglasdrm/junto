'use strict';
/* Menu "Pessoas": um único item para os participantes do planejamento aberto e para os grupos da conta
   (árvore familiar, Turmas e quartos). Sem planejamento aberto, mostra só os grupos, que são da conta e
   ficam sempre acessíveis. */

function peopleHubTabs(){
  if(juntoOnline.participantTripId||!['pessoas','grupos'].includes(db.simplePage)||db.legacyPage)return '';
  const current=db.simplePage,item=trip();
  const tab=(page,label,hint)=>`<button type="button" role="tab" class="people-hub-tab ${current===page?'active':''}" aria-selected="${current===page}" data-simple-page="${page}"><b>${esc(label)}</b><span>${esc(hint)}</span></button>`;
  return `<nav class="people-hub-tabs" role="tablist" aria-label="Pessoas">${item?tab('pessoas','Participantes',`de “${item.name}”`):''}${tab('grupos','Grupos e família','Sempre disponível na sua conta')}</nav>`;
}

const renderBeforePeopleHub=render;
render=function(...args){
  const result=renderBeforePeopleHub(...args);
  document.querySelector('#nav [data-simple-page="pessoas"]')?.classList.toggle('active',['pessoas','grupos'].includes(db.simplePage)&&!db.legacyPage);
  const app=document.querySelector('#app'),tabs=peopleHubTabs();
  if(app&&tabs&&!app.querySelector('.people-hub-tabs')){
    const head=app.querySelector(':scope > .page-head, :scope > header, :scope > .simple-head');
    if(head)head.insertAdjacentHTML('afterend',tabs);else app.insertAdjacentHTML('afterbegin',tabs);
  }
  return result;
};
render();
