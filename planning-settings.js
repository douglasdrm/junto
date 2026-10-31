'use strict';
// Central entry point; retain each existing editor and its validation/permissions.
const destinationEditorBeforeSettingsHub=openDestinationEditor;
function canOpenPlanningSettings(){return Boolean(juntoOnline.user&&!juntoOnline.user.is_anonymous&&!juntoOnline.participantTripId&&trip()&&activeOnlineLink())}
openDestinationEditor=function(){
 if(!canOpenPlanningSettings())return;
 const event=isEventPlan();
 modal(event?'Configurações do evento':'Configurações da viagem','Você pode revisar estas opções mesmo depois da criação.',`<div class="stack planning-settings-hub"><button type="button" class="button secondary" data-planning-setting="details">Informações, datas, horários, local e fotos</button>${event?'<button type="button" class="button secondary" data-planning-setting="potluck">Cada um leva · ativar, desativar ou usar modo misto</button><button type="button" class="button secondary" data-planning-setting="companions">Acompanhantes · permitir e definir limite</button>':''}<button type="button" class="button secondary" data-planning-setting="finance">Caixinha, rateio, saldo anterior, parcelas e vencimentos</button><button type="button" class="button secondary" data-planning-setting="people">Participantes, pagantes e isentos</button><button type="button" class="button secondary" data-planning-setting="access">Acessos e administradores</button><p class="help">Cada seção tem seu próprio salvamento. Alterações financeiras continuam sujeitas às validações e à proteção dos pagamentos existentes.</p>${!event?'<p class="help">Cada um leva e acompanhantes estão disponíveis atualmente para eventos. Viagens mantêm suas configurações e regras existentes.</p>':''}</div>`);
};
window.addEventListener('click',async e=>{
 const button=e.target.closest('[data-planning-setting]');if(!button)return;e.preventDefault();e.stopImmediatePropagation();if(!canOpenPlanningSettings())return;
 const type=button.dataset.planningSetting,account=juntoOnline.user.id,remote=activeOnlineLink().tripId,current=()=>canOpenPlanningSettings()&&juntoOnline.user.id===account&&activeOnlineLink().tripId===remote;
 if(type==='details')return destinationEditorBeforeSettingsHub();
 if(type==='finance'||type==='people'){closeModal();db.simplePage=type==='finance'?'contribuicoes':'pessoas';render();return}
 if(type==='access'){closeModal();return manageParticipantAccess()}
 button.disabled=true;
 try{
  if(!isEventPlan())return;
  if(type==='potluck'){const data=await loadPotluck(true);if(!current()||!button.isConnected)return;if(!data?.organizer)throw Error('Seu acesso não permite configurar esta lista.');return potluckForm('Configurar o que cada um leva',potluckPolicyFields(data.mode,data.allow_extras)+'<p class="help">Desativar preserva os itens e responsabilidades já cadastrados. Você pode reativar depois.</p>','settings')}
  if(type==='companions'){const {data,error}=await juntoOnline.client.rpc('get_event_companions',{target_trip:remote});if(error)throw error;if(!current()||!button.isConnected)return;if(!data?.organizer)throw Error('Seu acesso não permite configurar acompanhantes.');eventCompanionState=data;eventCompanionKey=companionContext();companionForm(null,true)}
 }catch(error){if(current())toast(error.message||'Não foi possível consultar as configurações. Tente novamente.','error')}finally{if(button.isConnected)button.disabled=false}
},true);
