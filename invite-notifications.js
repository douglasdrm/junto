'use strict';
let accessGreetingCache=null,accessGreetingToken='',accessGreetingPromise=null;
function individualAccessToken(){const token=pendingInvite();return token.startsWith('access:')?token.slice(7):''}
async function loadAccessGreeting(){
 const token=individualAccessToken();if(!token||!juntoOnline.client)return null;
 if(token===accessGreetingToken&&accessGreetingCache)return accessGreetingCache;
 if(accessGreetingPromise?.token===token)return accessGreetingPromise.promise;
 const promise=(async()=>{const {data,error}=await juntoOnline.client.rpc('preview_participant_access_link',{raw_token:token});if(error)throw error;if(token===individualAccessToken()){accessGreetingToken=token;accessGreetingCache=data}return data})();
 accessGreetingPromise={token,promise};try{return await promise}finally{if(accessGreetingPromise?.promise===promise)accessGreetingPromise=null}
}
function greetingCopy(data){return `<p class="invite-context-label">CONVITE PARA ACOMPANHAR ${data.kind==='viagem'?'UMA VIAGEM':'UM EVENTO'}</p><h3>Olá${data.first_name?', '+esc(data.first_name):''}!</h3><p>Você recebeu um convite para acompanhar <strong>${esc(data.trip_name||'este planejamento')}</strong>.</p><p class="help">Este link conecta sua conta ao seu cadastro já existente. O organizador aprova o vínculo; sua participação e seus pagamentos são preservados.</p>`}
async function showIndividualInviteWelcome(){
 const token=individualAccessToken();if(!token)return;
 modal('Seu convite no Juntô','Consultando as informações do convite…','<div class="invite-welcome" role="status">Carregando convite…</div>');const root=document.querySelector('#modal-root .modal');
 try{
  const data=await loadAccessGreeting();if(!root?.isConnected||token!==individualAccessToken())return;
  if(!data||['invalid','expired'].includes(data.status)){modal(data?.status==='expired'?'Convite expirado':'Convite indisponível','Peça ao organizador um novo link para vincular seu cadastro.','<button class="button secondary" data-close>Fechar</button>');return}
  if(data.status==='approved'){modal('Este convite já foi utilizado','Entre com a conta que recebeu o acesso.',`<div class="actions"><button class="button primary" data-invite-auth="login">Entrar na minha conta</button></div>`);return}
  modal('Você recebeu um convite',data.trip_name||'Acompanhe seu planejamento no Juntô.',`<section class="invite-welcome">${greetingCopy(data)}<div class="actions"><button class="button primary" data-invite-auth="login">Já tenho conta · entrar</button><button class="button secondary" data-invite-auth="signup">Criar minha conta</button></div><p class="help">Você pode continuar com Google ou usar seu e-mail na próxima tela.</p></section>`);
 }catch(error){if(root?.isConnected)modal('Não foi possível consultar o convite','Seu link continua guardado. Tente novamente.',`<div class="actions"><button class="button primary" data-invite-retry>Tentar novamente</button><button class="button secondary" data-invite-auth="login">Entrar na minha conta</button></div>`)}
}
const accountBeforeInviteWelcome=accountModal;
accountModal=function(...args){if(individualAccessToken()&&!juntoOnline.user)return void showIndividualInviteWelcome();return accountBeforeInviteWelcome(...args)};
const authBeforeInviteContext=authModal;
authModal=function(mode='login'){
 authBeforeInviteContext(mode);if(!individualAccessToken()||!['login','signup'].includes(mode))return;
 const root=document.querySelector('#modal-root .modal'),form=root?.querySelector('form'),token=individualAccessToken();if(!form)return;
 const notice=form.querySelector('.notice.info');if(notice)notice.textContent='Depois de entrar, solicite o vínculo com seu cadastro. O organizador precisa aprovar seu acesso.';
 const context=document.createElement('section');context.className='invite-auth-context';context.innerHTML='<p class="help">Seu convite está guardado enquanto você entra ou cria a conta.</p>';form.before(context);
 void loadAccessGreeting().then(data=>{if(!context.isConnected||token!==individualAccessToken()||!data)return;if(['open','requested'].includes(data.status)){context.innerHTML=greetingCopy(data);root.querySelector('.modal-head p').textContent=`Para acompanhar ${data.trip_name}`}}).catch(()=>{});
};
const acceptBeforeInviteContext=acceptPendingInvite;
acceptPendingInvite=async function(){
 const token=individualAccessToken();const result=await acceptBeforeInviteContext();if(!token||!result||!juntoOnline.user||juntoOnline.user.is_anonymous)return result;
 const root=document.querySelector('#modal-root .modal');if(!root?.querySelector('[data-request-existing-access]'))return result;
 try{const data=await loadAccessGreeting();if(root.isConnected&&token===individualAccessToken()&&data&&['invalid','expired','approved'].includes(data.status)){localStorage.removeItem('junto_pending_invite');modal(data.status==='approved'?'Convite já utilizado':'Convite indisponível',data.status==='approved'?'Acesse seus planejamentos com a conta que recebeu o vínculo.':'Peça ao organizador um novo link.', '<button class="button primary" data-online-trips>Meus planejamentos</button>');return result}if(root.isConnected&&token===individualAccessToken()&&data&&['open','requested'].includes(data.status)){const intro=document.createElement('section');intro.className='invite-auth-context';intro.innerHTML=greetingCopy(data);root.querySelector('.modal-head')?.after(intro)}}catch{}
 return result;
};

const adminNotifications={userId:null,items:[],loaded:false,error:false,checkedAt:0,promise:null,sequence:0};
const notificationBell='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
function notificationItemMarkup(item){
 const access=item.type==='access_request';return `<article class="record notification-record"><div><strong>${esc(access?`Vincular ${item.participant_name}`:'Compra aguardando conferência')}</strong><div class="record-meta">${esc(item.trip_name)} · ${esc(item.requester_name||'Participante')}</div>${access?`<div class="record-meta">Conta solicitante: ${esc(item.requester_email||'')}</div><p class="help">Confira se esta conta pertence à pessoa cadastrada antes de aprovar.</p>`:`<div class="record-meta">${cash(item.amount_cents)}${item.participant_name?' · '+esc(item.participant_name):''}</div>`}</div><div class="record-actions">${access?`<button class="button primary small" data-notification-review="${esc(item.id)}" data-notification-approve="true">Aprovar vínculo</button><button class="button danger small" data-notification-review="${esc(item.id)}" data-notification-approve="false">Recusar</button>`:`<button class="button secondary small" data-notification-purchase="${esc(item.id)}" data-notification-trip="${esc(item.trip_id)}">Conferir compra</button>`}</div></article>`;
}
function notificationPanelMarkup(){if(adminNotifications.userId!==juntoOnline.user?.id)return '<p role="status">Consultando solicitações…</p>';return `<div class="section-head"><p class="help">Vínculos e compras aguardando sua conferência nos planejamentos que você administra.</p><button class="button secondary small" data-notifications-refresh>Atualizar</button></div>${adminNotifications.error?'<p class="notice warn">Não foi possível consultar as notificações. Tente atualizar.</p>':!adminNotifications.loaded?'<p role="status">Consultando solicitações…</p>':adminNotifications.items.length?adminNotifications.items.map(notificationItemMarkup).join(''):'<p class="help">Nenhuma solicitação aguardando sua análise.</p>'}`}
function decorateAdminNotifications(){
 const user=juntoOnline.user;if(!user||user.is_anonymous){document.querySelectorAll('[data-admin-notifications],.pending-access-card').forEach(el=>el.remove());return}
 const current=adminNotifications.userId===user.id,items=current?adminNotifications.items:[],count=items.length,label=current&&adminNotifications.error?'!':!current||!adminNotifications.loaded?'…':count>99?'99+':String(count);
 const header=document.querySelector('.visual-topbar');if(header&&!header.querySelector('[data-admin-notifications]'))header.querySelector('[data-account]')?.insertAdjacentHTML('beforebegin',`<button type="button" class="notification-bell" data-admin-notifications>${notificationBell}<span data-notification-count></span></button>`);
 const mobile=document.querySelector('.mobile-head');if(mobile&&!mobile.querySelector('[data-admin-notifications]'))mobile.querySelector('.mobile-account')?.insertAdjacentHTML('beforebegin',`<button type="button" class="notification-bell" data-admin-notifications>${notificationBell}<span data-notification-count></span></button>`);
 const nav=document.querySelector('#nav');if(nav&&!nav.querySelector('[data-admin-notifications]'))nav.insertAdjacentHTML('beforeend',`<button class="nav" type="button" data-admin-notifications>${notificationBell}Notificações <span data-notification-count></span></button>`);
 document.querySelectorAll('[data-admin-notifications]').forEach(button=>{button.setAttribute('aria-label',`Notificações${current&&adminNotifications.loaded?`: ${count} pendente${count===1?'':'s'}`:''}`);const badge=button.querySelector('[data-notification-count]');if(badge){badge.textContent=label;badge.classList.toggle('has-pending',Boolean(count));badge.hidden=label==='0'}});
 const isPeople=db.simplePage==='pessoas'&&!juntoOnline.participantTripId,app=document.querySelector('#app');let card=app?.querySelector('.pending-access-card');
 if(isPeople&&app){const pending=items.filter(item=>item.type==='access_request'&&item.trip_id===activeOnlineLink()?.tripId);if(pending.length||current&&adminNotifications.error){if(!card){const head=app.querySelector('.page-head');const markup='<section class="card pending-access-card"></section>';if(head)head.insertAdjacentHTML('afterend',markup);else app.insertAdjacentHTML('afterbegin',markup);card=app.querySelector('.pending-access-card')}card.innerHTML=adminNotifications.error?'<p class="notice warn">Não foi possível consultar os pedidos de vínculo.</p><button class="button secondary small" data-notifications-refresh>Tentar novamente</button>':`<h2>${pending.length} solicitaç${pending.length===1?'ão':'ões'} de vínculo aguardando aprovação</h2>${pending.map(notificationItemMarkup).join('')}`}else card?.remove()}else card?.remove();
 const panel=document.querySelector('#admin-notification-panel');if(panel&&current)panel.innerHTML=notificationPanelMarkup();
}
async function refreshAdminNotifications(force=false){
 const userId=juntoOnline.user?.id;if(!userId||juntoOnline.user.is_anonymous){decorateAdminNotifications();return}
 if(adminNotifications.userId!==userId)Object.assign(adminNotifications,{userId,items:[],loaded:false,error:false,checkedAt:0,promise:null});
 if(!force&&adminNotifications.promise)return adminNotifications.promise;if(!force&&adminNotifications.loaded&&Date.now()-adminNotifications.checkedAt<45000){decorateAdminNotifications();return}
 const sequence=++adminNotifications.sequence;
 const promise=(async()=>{try{const {data,error}=await juntoOnline.client.rpc('list_my_admin_notifications');if(error)throw error;if(juntoOnline.user?.id!==userId||adminNotifications.sequence!==sequence)return;Object.assign(adminNotifications,{items:data||[],loaded:true,error:false,checkedAt:Date.now()})}catch(error){if(juntoOnline.user?.id===userId&&adminNotifications.sequence===sequence)Object.assign(adminNotifications,{error:true,loaded:true,checkedAt:Date.now()})}finally{if(juntoOnline.user?.id===userId&&adminNotifications.sequence===sequence){adminNotifications.promise=null;decorateAdminNotifications()}}})();adminNotifications.promise=promise;return promise;
}
async function openAdminNotifications(){modal('Notificações','Solicitações que precisam da sua atenção.',`<section id="admin-notification-panel">${notificationPanelMarkup()}</section>`);await refreshAdminNotifications(true)}
const renderBeforeNotifications=render;
render=function(...args){renderBeforeNotifications(...args);decorateAdminNotifications();if(juntoOnline.client&&juntoOnline.user&&!juntoOnline.user.is_anonymous)void refreshAdminNotifications()};
const accessManagerBeforeNotifications=manageParticipantAccess;
manageParticipantAccess=async function(...args){await accessManagerBeforeNotifications(...args);await refreshAdminNotifications(true)};
window.addEventListener('focus',()=>{if(document.visibilityState!=='hidden')void refreshAdminNotifications(true)});
window.addEventListener('online',()=>void refreshAdminNotifications(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshAdminNotifications(true)});
setInterval(()=>{if(document.visibilityState!=='hidden'&&juntoOnline.user)void refreshAdminNotifications()},45000);
window.addEventListener('click',async event=>{
 const button=event.target.closest('[data-invite-auth],[data-invite-retry],[data-admin-notifications],[data-notifications-refresh],[data-notification-review],[data-notification-purchase]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();
 if(button.matches('[data-invite-auth]'))return authModal(button.dataset.inviteAuth);
 if(button.matches('[data-invite-retry]'))return showIndividualInviteWelcome();
 if(button.matches('[data-admin-notifications]'))return openAdminNotifications();
 if(button.matches('[data-notifications-refresh]'))return refreshAdminNotifications(true);
 button.disabled=true;const accountId=juntoOnline.user?.id;
 try{
  if(button.matches('[data-notification-review]')){const {error}=await juntoOnline.client.rpc('review_participant_access_link',{link_id:button.dataset.notificationReview,approve:button.dataset.notificationApprove==='true'});if(error)throw error;if(juntoOnline.user?.id!==accountId)return;toast(button.dataset.notificationApprove==='true'?'Vínculo aprovado. A pessoa já pode acessar o planejamento.':'Solicitação recusada.');await refreshAdminNotifications(true);return}
  const tripId=button.dataset.notificationTrip,sourceId=button.dataset.notificationPurchase;await loadOnlineTrip(tripId);if(juntoOnline.user?.id!==accountId||activeOnlineLink()?.tripId!==tripId)return;closeModal();db.simplePage='financeiro';db.simpleFinanceTab='mercado';render();await decoratePurchaseWorkspace(true);const target=document.querySelector(`[data-batch-review="${sourceId}"],[data-review-purchase="${sourceId}"]`);target?.closest('article')?.scrollIntoView({behavior:'smooth',block:'center'});
 }catch(error){showOnlineFailure('Não foi possível concluir a ação',error,'Atualize as notificações e confira se a solicitação continua pendente.')}finally{if(button.isConnected)button.disabled=false}
},true);
