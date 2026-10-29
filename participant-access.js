'use strict';

/* Access to an existing record, separate from joining a new event. */
participantInviteModal=function(selectedPersonId=''){
 const options=people().map(person=>`<option value="${esc(person.id)}" ${person.id===selectedPersonId?'selected':''}>${esc(person.name)}</option>`).join('');
 if(!options)return toast('Cadastre participantes antes de vincular o acesso.','error');
 modal('Vincular acesso','Escolha quem já está cadastrado. Não é necessário informar e-mail nem telefone.',`<form id="existing-access-link"><label class="field"><span>Participante cadastrado</span><select name="participantId" id="inviteParticipant" required><option value="">Selecione</option>${options}</select></label><p class="help">A pessoa entra ou cria a própria conta pelo link. Você confere a solicitação em Pessoas → Gerenciar acessos antes de liberar o acesso.</p><div class="actions"><button class="button primary" type="submit">Gerar link para essa pessoa</button><button class="button secondary" type="button" data-link-self-selected>Sou eu</button></div><p class="help">“Sou eu” usa sua conta atual e mantém seu acesso de administrador.</p></form>`);
};

const peopleBeforeAccessLinks=simplePeople;
simplePeople=function(){
 const html=peopleBeforeAccessLinks();
 if(typeof juntoOnline==='undefined'||!juntoOnline.user||juntoOnline.user.is_anonymous||!activeOnlineLink())return html;
 const template=document.createElement('template');template.innerHTML=html;
 template.content.querySelectorAll('[data-link-existing-person]').forEach(button=>button.insertAdjacentHTML('afterend',`<button type="button" class="button ghost small" data-link-self-person="${esc(button.dataset.linkExistingPerson)}">Sou eu</button>`));
 return template.innerHTML;
};

async function createExistingAccessLink(personId,button){
 const link=activeOnlineLink(),person=people().find(item=>item.id===personId);if(!link||!person)return toast('Selecione uma pessoa cadastrada.','error');
 if(button)button.disabled=true;
 try{
  if(!await syncTripSnapshotById(db.active))return;
  const {data,error}=await juntoOnline.client.rpc('create_participant_access_link',{target_trip:link.tripId,local_participant_id:personId});if(error)throw error;
  if(typeof data!=='string'||!/^[a-f0-9]{64}$/.test(data))throw Error('O servidor não confirmou um link individual válido.');
  const preview=await juntoOnline.client.rpc('preview_participant_access_link',{raw_token:data});
  if(preview.error)throw preview.error;
  if(preview.data?.status!=='open')throw Error('O vínculo individual não foi encontrado após a criação. Gere novamente.');
  if(activeOnlineLink()?.tripId!==link.tripId)return;
  const url=new URL(location.pathname,location.origin);url.searchParams.set('invite',`access:${data}`);
  const text=`${person.name}, acesse seu cadastro em “${trip().name}” no Juntô. Entre ou crie sua conta e solicite o vínculo: ${url}`;
  modal('Vínculo individual confirmado',`Envie este link somente para ${person.name}.`, `<div class="stack"><label class="field"><span>Link individual</span><input id="participantInviteUrl" value="${esc(url.toString())}" readonly></label><p class="help">Válido por 7 dias. Gerar outro link cancela o anterior. O cadastro e os pagamentos existentes serão preservados.</p><div class="actions"><button class="button primary" data-copy-participant-invite>Copiar link</button><a class="button secondary" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Compartilhar no WhatsApp</a></div></div>`);
 }catch(error){accessLinkFailure(error)}finally{if(button?.isConnected)button.disabled=false}
}
function accessLinkFailure(error){
 const message=error?.message||'';
 if(message.includes('participant already linked'))return toast('Este cadastro já está vinculado a uma conta. Confira em Gerenciar acessos.','error');
 if(message.includes('account already linked'))return toast('Sua conta já está vinculada a outra pessoa nesta viagem. Confira antes de alterar o vínculo.','error');
 if(message.includes('confirmed account required'))return toast('Entre com uma conta e confirme seu e-mail antes de solicitar o vínculo.','error');
 showOnlineFailure('Não foi possível concluir o vínculo',error,'Confira o acesso, a validade do link e tente novamente.');
}
function confirmMyParticipant(personId){
 const person=people().find(item=>item.id===personId);if(!person)return toast('Selecione seu nome na lista.','error');
 modal('Este cadastro é seu?',`Associar ${person.name} à sua conta atual?`, `<div class="stack"><p>Conta: <strong>${esc(juntoOnline.user?.email||juntoOnline.profile?.display_name||'Sua conta atual')}</strong></p><p class="help">Seu histórico permanece nesse cadastro. Você continua administrador e nenhum pagamento será alterado.</p><div class="actions"><button class="button primary" data-confirm-self-link="${esc(personId)}">Sim, sou eu</button><button class="button secondary" data-close>Cancelar</button></div></div>`);
}
const accessBeforeAcceptInvite=acceptPendingInvite;
acceptPendingInvite=async function(){
 const token=pendingInvite();if(!token.startsWith('access:'))return accessBeforeAcceptInvite();
 if(!juntoOnline.user||juntoOnline.user.is_anonymous){authModal('signup');return true}
 modal('Acessar meu cadastro','Use sua própria conta para solicitar acesso ao cadastro indicado pelo organizador.',`<div class="stack"><p>Conta conectada: <strong>${esc(juntoOnline.user.email||'Sua conta')}</strong></p><p class="help">O organizador vai conferir a associação. Nenhuma informação financeira será liberada antes da aprovação.</p><div class="actions"><button class="button primary" data-request-existing-access>Solicitar meu acesso</button><button class="button secondary" data-existing-access-other-account>Usar outra conta</button></div></div>`);return true;
};

const manageAccessBeforeLinks=manageParticipantAccess;
manageParticipantAccess=async function(){
 await manageAccessBeforeLinks();const link=activeOnlineLink();if(!link||!document.querySelector('[data-close]'))return;
 const {data,error}=await juntoOnline.client.rpc('list_participant_access_links',{target_trip:link.tripId});
 const body=document.querySelector('#modal-root .modal');if(!body)return;
 if(error){body.insertAdjacentHTML('beforeend','<p class="notice warn">Não foi possível consultar as solicitações de vínculo. Feche e tente novamente.</p>');return}
 const entries=data||[];
 body.insertAdjacentHTML('beforeend',`<section class="access-link-requests"><h3>Links e solicitações de vínculo</h3>${entries.length?entries.map(item=>`<article class="record"><div><strong>${esc(item.participant_name)}</strong><div class="record-meta">${item.expired?'Link expirado':item.status==='requested'?`Solicitado por ${esc(item.requester_name||'Usuário')} · ${esc(item.requester_email||'')}`:'Aguardando a pessoa abrir e solicitar'}</div></div><div class="record-actions">${!item.expired&&item.status==='requested'?`<button class="button primary small" data-review-access="${esc(item.id)}" data-approve-access="true">Aprovar vínculo</button>`:''}<button class="button danger small" data-review-access="${esc(item.id)}" data-approve-access="false">${item.status==='requested'?'Recusar':'Cancelar link'}</button></div></article>`).join(''):'<p class="help">Nenhuma solicitação pendente.</p>'}</section>`);
};

window.addEventListener('submit',async event=>{
 if(event.target.id!=='existing-access-link')return;event.preventDefault();event.stopImmediatePropagation();
 await createExistingAccessLink(new FormData(event.target).get('participantId'),event.submitter);
},true);
window.addEventListener('click',async event=>{
 const target=event.target.closest('[data-link-self-person],[data-link-self-selected],[data-confirm-self-link],[data-request-existing-access],[data-review-access],[data-existing-access-other-account]');if(!target)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(target.matches('[data-link-self-person]'))return confirmMyParticipant(target.dataset.linkSelfPerson);
 if(target.matches('[data-link-self-selected]'))return confirmMyParticipant(document.querySelector('#inviteParticipant')?.value);
 if(target.matches('[data-existing-access-other-account]')){await juntoOnline.client.auth.signOut();authModal('login');return}
 target.disabled=true;
 try{
  if(target.matches('[data-confirm-self-link]')){
   const personId=target.dataset.confirmSelfLink,link=activeOnlineLink();if(!link||!await syncTripSnapshotById(db.active))return;
   const {error}=await juntoOnline.client.rpc('link_my_participant',{target_trip:link.tripId,local_participant_id:personId});if(error)throw error;
   const person=people().find(item=>item.id===personId);if(person){person.profileId=juntoOnline.user.id;const member=memberForParticipant(person);if(member)member.profileId=juntoOnline.user.id;saveLocal();await syncTripSnapshotById(db.active)}
   closeModal();toast('Seu cadastro está vinculado à sua conta. Você continua administrador.');render();return;
  }
  if(target.matches('[data-request-existing-access]')){
   const token=pendingInvite();if(!token.startsWith('access:'))return;
   const {error}=await juntoOnline.client.rpc('request_participant_access',{raw_token:token.slice(7)});if(error)throw error;
   localStorage.removeItem('junto_pending_invite');
   modal('Solicitação enviada','Agora o organizador precisa aprovar seu vínculo.', '<p class="help">Seu cadastro e pagamentos foram preservados. Depois da aprovação, a viagem aparecerá em Viagens e eventos na sua conta.</p><div class="actions"><button class="button primary" data-close>Entendi</button></div>');return;
  }
  if(target.matches('[data-review-access]')){
   const {error}=await juntoOnline.client.rpc('review_participant_access_link',{link_id:target.dataset.reviewAccess,approve:target.dataset.approveAccess==='true'});if(error)throw error;
   toast(target.dataset.approveAccess==='true'?'Vínculo aprovado.':'Link ou solicitação encerrado.');await manageParticipantAccess();return;
  }
 }catch(error){accessLinkFailure(error)}finally{if(target.isConnected)target.disabled=false}
},true);
