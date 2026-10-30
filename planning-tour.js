'use strict';
let planningTour=null,planningTourTimer=null;
function planningTourContext(){
 if(!juntoOnline.user)return null;
 const guest=Boolean(juntoOnline.participantTripId),id=guest?juntoOnline.participantTripId:activeOnlineLink()?.tripId;
 if(!id||(!guest&&(db.simplePage==='viagens'||db.legacyPage==='viagem')))return null;
 const portal=document.querySelector('.participant-portal-head'),name=guest?portal?.querySelector('h1')?.textContent?.trim():trip()?.name;
 if(!name)return null;
 const event=guest?Boolean(portal?.querySelector('.eyebrow')?.textContent.includes('EVENTO')):isEventPlan();
 return {id,name,guest,event,key:`junto_tour_v1:${juntoOnline.user.id}:${id}:${guest?'guest':'admin'}`};
}
function planningTourSteps(context){
 const {guest,event}=context,food=Boolean(document.querySelector('#event-potluck .potluck-grid'));
 const steps=[{title:`Bem-vindo${guest?' ao encontro':''}!`,text:`Este é ${context.name}. ${guest?'Você está na visão de participante, com as informações compartilhadas pelo organizador.':'Aqui você organiza as pessoas, os combinados e os gastos deste planejamento.'}`,target:'.current-planning-mobile:not([hidden]),.visual-breadcrumb'},
 {title:event?'Os combinados do evento':'Informações da viagem',text:event?'Confira data, horário e endereço. O organizador pode atualizar esses dados nas configurações do evento.':'Consulte as datas, o destino e o ponto de partida combinado. O organizador pode ajustar essas informações nas configurações da viagem.',target:'.visual-event-card,#guest-event-info,[data-trip-settings]'}];
 if(event)steps.push({title:food?'O que vamos levar':'Pratos e compras',text:food?'Veja os pratos e quem vai levar cada um. Toque em uma linha para abrir os detalhes e escolher sua contribuição. Você também pode escolher por um acompanhante.':'Quando o evento usar “Cada um leva”, escolha os pratos na lista compartilhada. Se houver compras, consulte os itens e os valores na lista do encontro.',target:'#event-potluck'});
 steps.push({title:'Quem vai participar',text:guest?'Consulte os participantes confirmados. Quando permitido, adicione quem vai com você em “Quem vai com você?”.':'Em Pessoas, organize os participantes e seus acessos. Acompanhantes também contam na presença; a condição de pagante ou isento define quem entra no rateio.',target:'#guest-participants,#event-companions,[data-simple-page="pessoas"]'});
 if(!event)steps.push({title:'Compras compartilhadas',text:'Acompanhe os itens e o que falta comprar. Abra a lista para consultar as quantidades e os valores; as opções disponíveis seguem seu acesso à viagem.',target:'#guest-shopping,.visual-shopping-preview,[data-finance-section="mercado"]'});
 steps.push({title:guest?'Seu financeiro':'Caixinha e rateio',text:guest?'Consulte seu relatório em Meu financeiro e acompanhe os valores gerais compartilhados. Os pagamentos individuais dos demais participantes permanecem privados.':'Acompanhe contribuições, despesas e o rateio nas áreas financeiras. Os valores seguem os pagantes e as regras configuradas neste planejamento.',target:guest?'#guest-personal-finance,#guest-finance-summary':'.admin-split-overview,.simple-metrics,[data-simple-page="financeiro"]'});
 return steps;
}
function clearTourHighlight(){document.querySelectorAll('.planning-tour-highlight').forEach(node=>node.classList.remove('planning-tour-highlight'))}
function closePlanningTour(remember=false,restoreFocus=true){
 if(!planningTour)return;
 if(remember)try{localStorage.setItem(planningTour.context.key,'done')}catch{}
 const previous=planningTour.previous;planningTour=null;clearTourHighlight();document.querySelector('#planning-tour')?.remove();if(restoreFocus&&previous?.isConnected)previous.focus({preventScroll:true});
}
function drawPlanningTour(){
 if(!planningTour)return;
 if(planningTourContext()?.key!==planningTour.context.key){closePlanningTour(false,false);return}
 clearTourHighlight();const step=planningTour.steps[planningTour.index];
 const targets=[...document.querySelectorAll(step.target)],target=targets.find(node=>node.getClientRects().length>0);
 if(target){target.classList.add('planning-tour-highlight');target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'})}
 let panel=document.querySelector('#planning-tour');if(!panel){panel=document.createElement('aside');panel.id='planning-tour';panel.className='planning-tour';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','planning-tour-title');document.body.append(panel)}
 panel.innerHTML=`<div class="planning-tour-head"><span>GUIA RÁPIDO · ${planningTour.index+1}/${planningTour.steps.length}</span><button type="button" data-tour-skip aria-label="Fechar o tour">×</button></div><h2 id="planning-tour-title" tabindex="-1">${esc(step.title)}</h2><p>${esc(step.text)}</p><div class="planning-tour-actions"><button type="button" class="button ghost small" data-tour-skip>Pular tour</button>${planningTour.index?'<button type="button" class="button secondary small" data-tour-back>Voltar</button>':''}<button type="button" class="button primary small" data-tour-next>${planningTour.index===planningTour.steps.length-1?'Concluir':'Próximo'}</button></div>`;
 panel.querySelector('h2').focus({preventScroll:true});
}
function startPlanningTour(){const context=planningTourContext();if(!context||document.querySelector('#modal-root .modal'))return;closePlanningTour(false,false);planningTour={context,steps:planningTourSteps(context),index:0,previous:document.activeElement};drawPlanningTour()}
function decoratePlanningTour(){
 const context=planningTourContext(),nav=document.querySelector('#nav');let button=nav?.querySelector('[data-planning-tour]');
 if(!context){button?.remove();clearTimeout(planningTourTimer);closePlanningTour(false,false);return}
 if(!button){button=document.createElement('button');button.type='button';button.className='nav';button.setAttribute('data-planning-tour','');button.innerHTML='<span aria-hidden="true">?</span>Tour rápido';nav?.append(button)}
 if(planningTour){if(planningTour.context.key!==context.key)closePlanningTour(false,false);else return}
 let seen=false;try{seen=localStorage.getItem(context.key)==='done'}catch{}
 clearTimeout(planningTourTimer);if(!seen)planningTourTimer=setTimeout(()=>{if(planningTourContext()?.key===context.key&&!document.querySelector('#modal-root .modal'))startPlanningTour()},850);
}
const renderBeforePlanningTour=render;render=function(...args){renderBeforePlanningTour(...args);decoratePlanningTour()};
const showBeforePlanningTour=showParticipantTrip;showParticipantTrip=async function(...args){const result=await showBeforePlanningTour(...args);decoratePlanningTour();return result};
window.addEventListener('click',event=>{const button=event.target.closest('[data-planning-tour],[data-tour-next],[data-tour-back],[data-tour-skip]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();if(button.hasAttribute('data-planning-tour')){closeMenu();return startPlanningTour()}if(!planningTour)return;if(button.hasAttribute('data-tour-skip'))return closePlanningTour(true);if(button.hasAttribute('data-tour-back'))planningTour.index=Math.max(0,planningTour.index-1);else if(planningTour.index===planningTour.steps.length-1)return closePlanningTour(true);else planningTour.index++;drawPlanningTour()},true);
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&planningTour){event.preventDefault();closePlanningTour(true)}});
decoratePlanningTour();
