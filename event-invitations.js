'use strict';
/* General invitations are separate from links to an existing participant. */
let generalInvitation=null,generalInvitationLoad=0;
const savedEventInvitations={userId:null,items:[],error:'',loading:false};
function registeredInvitationAccount(){return Boolean(juntoOnline.user&&!juntoOnline.user.is_anonymous)}
function invitationIntent(){try{const item=JSON.parse(localStorage.getItem('junto_join_intent')||'null');return item?.token===pendingJoin()?item.answer:null}catch{return null}}
function invitationArgs(context=generalInvitation){return {raw_token:context?.token||null,saved_id:context?.savedId||null}}
function clearGeneralInvite(){localStorage.removeItem('junto_pending_join');localStorage.removeItem('junto_join_intent');const url=new URL(location.href);url.searchParams.delete('join');history.replaceState({},'',url.pathname+url.search+url.hash)}
function invitationFailure(error){if(error?.message?.includes('access revoked')){modal('Seu acesso precisa ser restaurado','Este cadastro já participou do evento.', '<p>O organizador retirou seu acesso anteriormente. Peça para restaurá-lo em Pessoas → Gerenciar acessos. Seu histórico continua preservado.</p><button type="button" class="button secondary" data-close>Entendi</button>');return}showOnlineFailure('Não foi possível abrir o convite',error,'Peça ao organizador um novo link se o convite tiver sido desativado.')}
function invitationDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return value||'A combinar';return new Date(value+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})}
function invitationDetails(item){const values=[['Data',invitationDate(item.date)+(item.end_date&&item.end_date!==item.date?' a '+invitationDate(item.end_date):'')],['Horário',item.time||'A combinar'],['Local',item.region||'A confirmar']];return `<div class="invitation-preview-info">${values.map(([label,value])=>`<div><small>${label}</small><strong>${esc(value)}</strong></div>`).join('')}</div>`}
function paintGeneralInvitation(preview=false){
 const item=generalInvitation?.details;if(!item)return;
 const cover=String(item.cover_image||''),safeCover=/^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(cover),initials=Array.isArray(item.participant_initials)?item.participant_initials.slice(0,5):[],count=Number(item.participant_count)||0;
 const blocked=(item.response_blocked||(!generalInvitation.savedId&&!item.can_respond))?'Seu acesso anterior foi retirado. Peça ao organizador para restaurá-lo em Pessoas → Gerenciar acessos.':'Este convite venceu ou foi desativado. Peça um novo link ao organizador.';
 modal('Um encontro espera por você','Você está convidado!',`<article class="general-invitation invitation-event-card"><div class="invitation-event-hero ${safeCover?'has-cover':''}">${safeCover?`<img src="${esc(cover)}" alt="Foto de ${esc(item.name)}" width="640" height="260">`:'<span class="invitation-connection" aria-hidden="true">◎</span>'}<div class="invitation-event-title"><span class="invitation-kind">${esc(item.kind||'Evento')}</span><h3>${esc(item.name)}</h3><p>Planeje melhor. Viva junto.</p></div></div><div class="invitation-event-content">${invitationDetails(item)}${count?`<div class="invitation-people"><div class="invitation-initials" aria-hidden="true">${initials.map(initial=>`<span>${esc(initial)}</span>`).join('')}${count>5?`<span>+${count-5}</span>`:''}</div><p><strong>${count} ${count===1?'participante confirmado':'participantes confirmados'}</strong><small>Um encontro que já está tomando forma.</small></p></div>`:'<p class="invitation-welcome-note">Os melhores encontros começam com um convite.</p>'}${preview?`<p class="help">Entre ou crie sua conta para responder e guardar este encontro nos seus planejamentos.</p>${item.can_respond?'<div class="invitation-response-actions"><button type="button" class="button primary" data-event-invitation-answer="accepted">Quero participar</button><button type="button" class="button secondary" data-event-invitation-answer="maybe">Ainda não sei</button></div>':`<div class="notice warn">${blocked}</div>`}`:'<button type="button" class="button primary invitation-view-button" data-preview-general-invitation>Conhecer o evento <span aria-hidden="true">→</span></button>'}<div class="invitation-brand-note"><img src="assets/brand/junto-logo.svg" alt="Juntô" width="76" height="26"><span>Mais encontros. Menos desencontros.</span></div></div></article>`);
 document.querySelector('#modal-root .modal')?.classList.add('event-invitation-modal');
}
async function rememberGeneralInvitation(){if(!registeredInvitationAccount()||!generalInvitation?.details.can_respond)return;const account=juntoOnline.user.id;const {error}=await juntoOnline.client.rpc('respond_event_invitation',{...invitationArgs(),answer:'remember'});if(juntoOnline.user?.id!==account)return;if(error)throw error;savedEventInvitations.userId=null}
async function showGeneralInviteWelcome(savedId=null){
 const token=savedId?null:pendingJoin();if(!token&&!savedId)return;
 generalInvitation=null;const sequence=++generalInvitationLoad,account=juntoOnline.user?.id;
 modal('Abrindo convite','Buscando os detalhes do encontro…','<p role="status">Aguarde um instante.</p>');
 try{const {data,error}=await juntoOnline.client.rpc('preview_event_invitation',{raw_token:token,saved_id:savedId});if(sequence!==generalInvitationLoad||juntoOnline.user?.id!==account)return;if(error)throw error;if(data?.status!=='available'){if(token&&pendingJoin()===token)clearGeneralInvite();throw {message:'O link não foi encontrado, foi desativado ou venceu.'};}generalInvitation={token,savedId,details:data};await rememberGeneralInvitation();if(sequence!==generalInvitationLoad||juntoOnline.user?.id!==account)return;paintGeneralInvitation(Boolean(savedId))}catch(error){if(sequence===generalInvitationLoad)invitationFailure(error)}
}
function confirmGeneralInvitation(){
 if(!registeredInvitationAccount())return authenticateForInvitation('accepted');
 modal(`Participar de ${generalInvitation.details.name}`,'Confirme como seu nome aparecerá para o grupo.',`<form id="join-trip"><div class="stack">${field('joinName','Seu nome','text',juntoOnline.profile?.display_name||'','required minlength="2" maxlength="100" autocomplete="name"')}${field('joinPhone','Telefone (opcional)','tel',juntoOnline.profile?.phone||'','maxlength="40" autocomplete="tel"')}<button type="submit" class="button primary">Confirmar participação</button></div></form>`);
}
function authenticateForInvitation(answer){
 if(generalInvitation?.token)localStorage.setItem('junto_join_intent',JSON.stringify({token:generalInvitation.token,answer}));
 // Preserve an existing anonymous identity, including its old payments, through email upgrade.
 if(juntoOnline.user?.is_anonymous){modal('Guarde seu acesso ao evento','Vincule seu e-mail para responder e continuar acessando em outros aparelhos.',`<form id="guest-upgrade"><div class="stack">${field('guestUpgradeName','Seu nome','text',juntoOnline.profile?.display_name||'','required minlength="2" maxlength="100" autocomplete="name"')}${field('guestUpgradeEmail','Seu e-mail','email','','required autocomplete="email"')}<button class="button primary">Vincular e-mail e criar conta</button></div></form><p class="help">Isso preserva seu cadastro anterior. Confirme o e-mail para concluir.</p>`);return}
 authModal('login');
 const form=document.querySelector('#online-login');if(form)form.insertAdjacentHTML('afterbegin','<div class="notice info">Seu convite está guardado. Entre com Google ou e-mail, ou crie uma conta, para salvar sua resposta e acessar o evento depois.</div>');
}
async function saveGeneralInvitationAnswer(answer){
 if(!registeredInvitationAccount())return authenticateForInvitation(answer);
 if(answer==='accepted')return confirmGeneralInvitation();
 const account=juntoOnline.user.id,context=generalInvitation;
 const buttons=document.querySelectorAll('[data-event-invitation-answer]');buttons.forEach(button=>button.disabled=true);
 try{const {data,error}=await juntoOnline.client.rpc('respond_event_invitation',{...invitationArgs(context),answer:'maybe'});if(juntoOnline.user?.id!==account)return;if(error)throw error;clearGeneralInvite();savedEventInvitations.userId=null;closeModal();openPlanningDirectory();toast(data.response==='accepted'?'Você já participa deste evento.':'Convite salvo em Viagens e eventos → Convites recebidos. Sua presença ainda não foi confirmada.')}catch(error){invitationFailure(error)}finally{buttons.forEach(button=>button.disabled=false)}
}
joinTripModal=async function(){
 const intent=invitationIntent();await showGeneralInviteWelcome();
 if(!generalInvitation||generalInvitation.token!==pendingJoin()||!registeredInvitationAccount())return;
 if(intent==='maybe')await saveGeneralInvitationAnswer('maybe');else if(intent==='accepted')confirmGeneralInvitation();
};
acceptPendingJoin=async function(name,phone){
 if(!registeredInvitationAccount()){authenticateForInvitation('accepted');return false}
 if(!generalInvitation||name.length<2||name.length>100){toast('Informe seu nome (2 a 100 caracteres).','error');return false}
 const account=juntoOnline.user.id,context=generalInvitation,button=document.querySelector('#join-trip button[type="submit"]');if(button){button.disabled=true;button.textContent='Confirmando…'}
 try{const {data,error}=await juntoOnline.client.rpc('respond_event_invitation',{...invitationArgs(context),answer:'accepted',display_name:name,phone:phone||null});if(juntoOnline.user?.id!==account)return false;if(error)throw error;clearGeneralInvite();savedEventInvitations.userId=null;await loadOnlineProfile();if(juntoOnline.user?.id!==account)return false;closeModal();await showParticipantTrip(data.trip_id);toast('Participação confirmada. O evento está salvo na sua conta.');return true}catch(error){invitationFailure(error);return false}finally{if(button?.isConnected){button.disabled=false;button.textContent='Confirmar participação'}}
};
async function refreshSavedEventInvitations(){
 const account=juntoOnline.user?.id;if(!registeredInvitationAccount())return;
 if(savedEventInvitations.loading&&savedEventInvitations.userId===account)return;
 Object.assign(savedEventInvitations,{userId:account,loading:true,error:'',items:[]});
 try{const {data,error}=await juntoOnline.client.rpc('list_my_event_invitations');if(juntoOnline.user?.id!==account||savedEventInvitations.userId!==account)return;if(error)throw error;savedEventInvitations.items=Array.isArray(data)?data:[]}catch(error){if(juntoOnline.user?.id===account)savedEventInvitations.error='Não foi possível consultar seus convites. Atualize a lista para tentar novamente.'}finally{if(juntoOnline.user?.id===account&&savedEventInvitations.userId===account){savedEventInvitations.loading=false;if(db.simplePage==='viagens'&&!juntoOnline.participantTripId)render()}}
}
const planningPageBeforeInvitations=onlinePlanningPage;
onlinePlanningPage=function(){
 const page=planningPageBeforeInvitations();if(!registeredInvitationAccount())return page;
 if(savedEventInvitations.userId!==juntoOnline.user.id)queueMicrotask(refreshSavedEventInvitations);
 const own=savedEventInvitations.userId===juntoOnline.user.id,items=own?savedEventInvitations.items:[];
 const content=own&&savedEventInvitations.error?`<p role="alert">${esc(savedEventInvitations.error)}</p>`:!own||savedEventInvitations.loading?'<p role="status">Carregando convites…</p>':items.map(item=>`<article class="saved-invitation"><div><h3>${esc(item.name||'Convite')}</h3><p class="help">${item.response==='maybe'?'Ainda não sei':'Aguardando sua resposta'}${!item.can_respond?' · Peça um novo link ao organizador':''}</p></div><button type="button" class="button secondary" data-open-saved-invitation="${esc(item.id)}">Ver convite</button></article>`).join('')||'<p class="help">Ao abrir um convite com sua conta, ele ficará guardado aqui até você decidir.</p>';
 return page+`<section class="card"><h2>Convites recebidos</h2>${content}</section>`;
};
const directoryRefreshBeforeInvitations=refreshPlanningDirectory;
refreshPlanningDirectory=async function(){await Promise.all([directoryRefreshBeforeInvitations(),refreshSavedEventInvitations()])};
document.addEventListener('click',event=>{
 if(event.target.closest('[data-preview-general-invitation]')){paintGeneralInvitation(true);return}
 const answer=event.target.closest('[data-event-invitation-answer]');if(answer){void saveGeneralInvitationAnswer(answer.dataset.eventInvitationAnswer);return}
 const saved=event.target.closest('[data-open-saved-invitation]');if(saved)void showGeneralInviteWelcome(saved.dataset.openSavedInvitation);
});
