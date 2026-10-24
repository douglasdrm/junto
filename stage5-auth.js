'use strict';

const juntoOnline={client:null,user:null,profile:null,configured:false,syncTimer:null,syncing:false,syncQueued:false};
const saveLocal=save;
const tripScopedKeys=['people','payments','houses','expenses','families','fundYields','fundSnapshots','shoppingItems','consumptionGroups'];
const groupScopedKeys=['members','groupFamilies','relationships','peopleMapLayouts','roomPreferences'];

function onlineConfig(){return window.JUNTO_SUPABASE_CONFIG||{}}
function onlineReady(){const config=onlineConfig();return Boolean(config.url&&config.publishableKey&&window.supabase?.createClient)}
function onlineLinks(){if(!db.onlineTrips||typeof db.onlineTrips!=='object')db.onlineTrips={};return db.onlineTrips}
function activeOnlineLink(){return onlineLinks()[db.active]||null}
function cloneOnline(value){return JSON.parse(JSON.stringify(value))}
function onlineError(error,fallback){console.error(error);return error?.message?.includes('sync conflict')?'Esta viagem foi alterada em outro aparelho. Abra novamente a versão online antes de continuar.':fallback}
function updateOnlineNote(){const note=document.querySelector('.side-note');if(!note)return;const linked=Boolean(juntoOnline.user&&activeOnlineLink());note.innerHTML=`<i></i> ${linked?'Viagem sincronizada online':juntoOnline.user?'Conta conectada · viagem ainda local':'Dados salvos somente neste navegador'}`}
function updateAccountButton(){document.querySelectorAll('[data-account]').forEach(button=>{button.classList.toggle('is-online',Boolean(juntoOnline.user));const label=button.querySelector('span');if(label)label.textContent=juntoOnline.user?(juntoOnline.profile?.display_name||juntoOnline.user.email||'Minha conta'):'Entrar'});updateOnlineNote()}
function tripBundle(){
  const current=trip(),groupId=current.groupId||db.activeGroupId,group=(db.groups||[]).find(item=>item.id===groupId)||{id:groupId,name:'Grupo da viagem',description:''},payload={schemaVersion:1,exportedAt:new Date().toISOString(),trip:cloneOnline(current),group:cloneOnline(group)};
  tripScopedKeys.forEach(key=>payload[key]=cloneOnline((db[key]||[]).filter(item=>item.trip===current.id)));
  groupScopedKeys.forEach(key=>payload[key]=cloneOnline((db[key]||[]).filter(item=>item.groupId===groupId)));
  payload.shoppingYear=db.shoppingYear||null;return payload;
}
async function contentHash(payload){const bytes=new TextEncoder().encode(JSON.stringify(payload)),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')}
function persistOnlineLink(localTripId,link){onlineLinks()[localTripId]=link;saveLocal();updateAccountButton()}
function tripOnlinePanel(){
  const current=trip(),link=activeOnlineLink();
  if(!current)return '<div class="notice info">Crie ou selecione uma viagem para conectá-la à conta.</div>';
  if(!link)return `<section class="online-trip-panel"><div><strong>${esc(current.name)}</strong><p>Esta viagem ainda está somente neste navegador.</p></div><div class="record-actions"><button type="button" class="button primary" data-online-import>Levar viagem para minha conta</button><button type="button" class="button ghost" data-online-trips>Minhas viagens online</button></div></section>`;
  return `<section class="online-trip-panel connected"><div><strong>${esc(current.name)}</strong><p>Sincronizada online · revisão ${Number(link.revision)||1}</p></div><div class="record-actions"><button type="button" class="button secondary" data-admin-invite>Convidar administrador</button><button type="button" class="button ghost" data-online-trips>Minhas viagens online</button></div></section>`;
}
function accountModal(){
  if(!juntoOnline.configured){modal('Conta Juntô','A estrutura online está pronta para ser conectada.',`<div class="account-state"><div class="account-state-icon">☁</div><strong>Supabase ainda não configurado</strong><p>O modo local continua ativo e seus dados permanecem neste navegador. Para ativar contas, informe a URL e a chave publicável do projeto em <code>supabase/config.js</code>.</p></div><div class="actions"><button class="button primary" data-close>Continuar no modo local</button></div>`);return}
  if(!juntoOnline.user){modal('Entrar no Juntô','Receba um link seguro no seu e-mail. Não é necessário criar senha.',`<form id="online-login"><div class="stack">${field('onlineEmail','Seu e-mail','email','','required autocomplete="email" placeholder="voce@exemplo.com"')}<div class="notice info">Enviaremos um link de acesso. Se você abriu um convite, ele será aceito depois do login.</div><button class="button primary">Enviar link para entrar</button></div></form>`);return}
  const name=juntoOnline.profile?.display_name||'',phone=juntoOnline.profile?.phone||'',email=juntoOnline.user.email||'';
  modal('Minha conta','Conta online conectada.',`${tripOnlinePanel()}<form id="online-profile"><div class="stack">${field('onlineName','Nome de exibição','text',name,'required maxlength="100"')}${field('onlinePhone','Telefone (opcional)','tel',phone,'autocomplete="tel" maxlength="30" placeholder="(00) 00000-0000"')}${field('onlineAccountEmail','E-mail','email',email,'disabled')}<div class="account-connected"><i></i><span>Conta online ativa</span></div><button class="button primary">Salvar perfil</button><button type="button" class="button ghost" data-online-signout>Sair da conta</button></div></form>`)
}
async function loadOnlineProfile(){if(!juntoOnline.user)return;const {data,error}=await juntoOnline.client.from('profiles').select('id,display_name,phone,avatar_path,platform_owner').eq('id',juntoOnline.user.id).single();if(!error)juntoOnline.profile=data;updateAccountButton()}
async function importActiveTrip(){
  if(!juntoOnline.user)return accountModal();if(!trip())return toast('Crie ou selecione uma viagem primeiro.','error');
  if(!confirm(`Levar “${trip().name}” para sua conta online? Depois disso, as alterações desta viagem serão sincronizadas.`))return;
  const payload=tripBundle(),hash=await contentHash(payload),button=document.querySelector('[data-online-import]');if(button)button.disabled=true;
  const {data,error}=await juntoOnline.client.rpc('import_local_trip',{payload,content_hash:hash});
  if(error){if(button)button.disabled=false;return toast(onlineError(error,'Não foi possível levar a viagem para a conta.'),'error')}
  persistOnlineLink(db.active,{tripId:data.trip_id,revision:Number(data.revision)||1});accountModal();toast('Viagem salva na sua conta e sincronização ativada.');
}
function scheduleOnlineSync(){clearTimeout(juntoOnline.syncTimer);const link=activeOnlineLink();if(!juntoOnline.user||!link||link.conflict)return;if(juntoOnline.syncing){juntoOnline.syncQueued=true;return}juntoOnline.syncTimer=setTimeout(syncActiveTrip,900)}
async function syncActiveTrip(){
  const link=activeOnlineLink();if(!juntoOnline.user||!link||link.conflict||juntoOnline.syncing)return;juntoOnline.syncing=true;juntoOnline.syncQueued=false;
  const {data,error}=await juntoOnline.client.rpc('sync_trip_snapshot',{target_trip:link.tripId,new_payload:tripBundle(),expected_revision:link.revision});juntoOnline.syncing=false;
  if(error){if(error.message?.includes('sync conflict')){link.conflict=true;saveLocal();toast(onlineError(error),'error')}else toast('Alteração salva neste navegador; a sincronização online será tentada novamente.','error');return}
  link.revision=Number(data);link.conflict=false;saveLocal();updateOnlineNote();if(juntoOnline.syncQueued)scheduleOnlineSync();
}
save=function(){saveLocal();scheduleOnlineSync()};
function mergeOnlineBundle(payload,remoteTripId,revision){
  const localTripId=payload.trip?.id,groupId=payload.group?.id||payload.trip?.groupId;if(!localTripId||!groupId)throw new Error('invalid snapshot');
  db.groups=(db.groups||[]).filter(item=>item.id!==groupId);db.groups.push(payload.group);db.trips=(db.trips||[]).filter(item=>item.id!==localTripId);db.trips.push(payload.trip);
  tripScopedKeys.forEach(key=>{db[key]=(db[key]||[]).filter(item=>item.trip!==localTripId);db[key].push(...(payload[key]||[]))});
  groupScopedKeys.forEach(key=>{db[key]=(db[key]||[]).filter(item=>item.groupId!==groupId);db[key].push(...(payload[key]||[]))});
  if(payload.shoppingYear)db.shoppingYear=payload.shoppingYear;db.active=localTripId;db.activeGroupId=groupId;onlineLinks()[localTripId]={tripId:remoteTripId,revision:Number(revision)||1};saveLocal();render();updateAccountButton();
}
async function loadOnlineTrip(remoteTripId){
  const {data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,revision').eq('trip_id',remoteTripId).single();if(error)return toast('Não foi possível abrir a viagem online.','error');
  try{mergeOnlineBundle(data.payload,data.trip_id,data.revision);closeModal();toast('Viagem online aberta neste navegador.')}catch(loadError){console.error(loadError);toast('A versão online desta viagem é incompatível.','error')}
}
async function onlineTripsModal(){
  modal('Minhas viagens online','Viagens que você organiza ou administra.','<div class="account-state"><div class="account-state-icon">↻</div><strong>Carregando viagens…</strong></div>');
  const {data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,updated_at').order('updated_at',{ascending:false});if(error)return modal('Minhas viagens online','Não foi possível consultar agora.',`<div class="notice warn">${esc(error.message)}</div>`);
  const rows=(data||[]).map(item=>`<button type="button" class="online-trip-row" data-open-online-trip="${item.trip_id}"><span><strong>${esc(item.payload?.trip?.name||'Viagem')}</strong><small>Atualizada em ${new Date(item.updated_at).toLocaleString('pt-BR')}</small></span><b>Abrir</b></button>`).join('')||'<div class="notice info">Nenhuma viagem online encontrada.</div>';modal('Minhas viagens online','Viagens que você organiza ou administra.',`<div class="online-trip-list">${rows}</div>`);
}
async function createAdminInvite(){
  const link=activeOnlineLink();if(!link)return toast('Leve a viagem para sua conta antes de convidar.','error');const {data,error}=await juntoOnline.client.rpc('create_trip_invite',{target_trip:link.tripId,invite_role:'organizer'});if(error)return toast(onlineError(error,'Não foi possível criar o convite.'),'error');
  const inviteUrl=`${location.origin}${location.pathname}?invite=${encodeURIComponent(data)}`,message=encodeURIComponent(`Você foi convidado para administrar a viagem “${trip().name}” no Juntô: ${inviteUrl}`);
  modal('Convidar administrador','Este acesso permite ver e alterar toda a viagem.',`<div class="stack"><div class="notice warn">Envie somente para uma pessoa de confiança. O link expira em 7 dias e funciona uma única vez.</div><label class="field"><span>Link do convite</span><input id="adminInviteUrl" value="${esc(inviteUrl)}" readonly></label><div class="actions"><button type="button" class="button primary" data-copy-admin-invite>Copiar link</button><a class="button secondary" href="https://wa.me/?text=${message}" target="_blank" rel="noopener">Enviar no WhatsApp</a></div></div>`);
}
function captureInvite(){const token=new URLSearchParams(location.search).get('invite');if(token){localStorage.setItem('junto_pending_invite',token);history.replaceState({},'',location.pathname)}}
async function acceptPendingInvite(){
  const token=localStorage.getItem('junto_pending_invite');if(!token||!juntoOnline.user)return;const {data,error}=await juntoOnline.client.rpc('accept_trip_invite',{raw_token:token});
  if(error){localStorage.removeItem('junto_pending_invite');history.replaceState({},'',location.pathname);return toast('Este convite é inválido, expirou ou já foi usado.','error')}
  localStorage.removeItem('junto_pending_invite');history.replaceState({},'',location.pathname);await loadOnlineTrip(data.trip_id);toast('Convite aceito. Você agora administra esta viagem.');
}
async function initializeOnlineAccount(){
  captureInvite();juntoOnline.configured=onlineReady();if(!juntoOnline.configured){updateAccountButton();return}
  const config=onlineConfig();juntoOnline.client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});const {data}=await juntoOnline.client.auth.getSession();juntoOnline.user=data.session?.user||null;
  if(juntoOnline.user){await loadOnlineProfile();await acceptPendingInvite()}else{updateAccountButton();if(localStorage.getItem('junto_pending_invite'))setTimeout(accountModal,350)}
  juntoOnline.client.auth.onAuthStateChange((_event,session)=>{juntoOnline.user=session?.user||null;juntoOnline.profile=null;if(juntoOnline.user)setTimeout(async()=>{await loadOnlineProfile();await acceptPendingInvite()},0);else updateAccountButton()});
}

document.addEventListener('click',async event=>{
  if(event.target.closest('[data-account]')){accountModal();return}if(event.target.closest('[data-online-signout]')){await juntoOnline.client?.auth.signOut();closeModal();toast('Você saiu da conta. O modo local continua disponível.');return}
  if(event.target.closest('[data-online-import]')){await importActiveTrip();return}if(event.target.closest('[data-admin-invite]')){await createAdminInvite();return}if(event.target.closest('[data-online-trips]')){await onlineTripsModal();return}
  const open=event.target.closest('[data-open-online-trip]');if(open){await loadOnlineTrip(open.dataset.openOnlineTrip);return}
  if(event.target.closest('[data-copy-admin-invite]')){const input=document.querySelector('#adminInviteUrl'),value=input?.value;try{await navigator.clipboard.writeText(value);toast('Link copiado.')}catch{input?.select();toast('Selecione e copie o link.')}return}
},true);
document.addEventListener('submit',async event=>{
  if(!['online-login','online-profile'].includes(event.target.id))return;event.preventDefault();event.stopImmediatePropagation();const form=new FormData(event.target);
  if(event.target.id==='online-login'){const email=String(form.get('onlineEmail')||'').trim().toLowerCase(),redirectTo=location.href.split('#')[0].split('?')[0];const {error}=await juntoOnline.client.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo,data:{display_name:email.split('@')[0]}}});if(error)return toast('Não foi possível enviar o link. Confira o e-mail e a configuração.','error');closeModal();toast('Link enviado. Confira seu e-mail.');return}
  const displayName=String(form.get('onlineName')||'').trim(),phone=String(form.get('onlinePhone')||'').trim()||null;const {data,error}=await juntoOnline.client.from('profiles').update({display_name:displayName,phone,updated_at:new Date().toISOString()}).eq('id',juntoOnline.user.id).select().single();if(error)return toast('Não foi possível atualizar o perfil.','error');juntoOnline.profile=data;closeModal();updateAccountButton();toast('Perfil atualizado.');
},true);

initializeOnlineAccount();
