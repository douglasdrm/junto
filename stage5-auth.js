'use strict';

const initialAuthUrl=new URL(location.href),initialAuthHash=new URLSearchParams(location.hash.replace(/^#/,''));
const juntoOnline={client:null,user:null,profile:null,configured:false,invitesReady:false,syncTimer:null,syncing:false,syncQueued:false,restoring:false,restoredFor:null,participantTripId:null,recoveryPending:initialAuthUrl.searchParams.get('auth_action')==='recovery'||initialAuthUrl.searchParams.get('type')==='recovery'||initialAuthHash.get('type')==='recovery',guestUpgradePending:initialAuthUrl.searchParams.get('auth_action')==='guest-upgrade'};
const saveLocal=save;
const welcomeEl=document.querySelector('#welcome');
const tripScopedKeys=['people','payments','houses','expenses','families','fundYields','fundSnapshots','shoppingItems','consumptionGroups','roomPlans'];
const groupScopedKeys=['members','groupFamilies','relationships','peopleMapLayouts','roomPreferences'];

function onlineConfig(){return window.JUNTO_SUPABASE_CONFIG||{}}
function onlineReady(){const config=onlineConfig();return Boolean(config.url&&config.publishableKey&&window.supabase?.createClient)}
function pendingInvite(){return localStorage.getItem('junto_pending_invite')||''}
function pendingJoin(){return localStorage.getItem('junto_pending_join')||''}
function authReturnUrl(action=''){const url=new URL(location.pathname,location.origin),token=pendingInvite(),join=pendingJoin();if(token)url.searchParams.set('invite',token);if(join)url.searchParams.set('join',join);if(action)url.searchParams.set('auth_action',action);return url.toString()}
function authMessage(error,fallback='Não foi possível continuar.'){
  const message=String(error?.message||'').toLowerCase();
  if(message.includes('invalid login credentials'))return 'E-mail ou senha incorretos.';
  if(message.includes('email not confirmed'))return 'Confirme seu e-mail antes de entrar.';
  if(message.includes('user already registered'))return 'Este e-mail já possui uma conta. Entre com sua senha.';
  if(message.includes('password should be'))return 'A senha precisa ter pelo menos 6 caracteres.';
  if(message.includes('rate limit'))return 'Muitas tentativas seguidas. Aguarde um pouco e tente novamente.';
  return fallback;
}
function onlineLinks(){if(!db.onlineTrips||typeof db.onlineTrips!=='object')db.onlineTrips={};return db.onlineTrips}
function activeOnlineLink(){return onlineLinks()[db.active]||null}
function cloneOnline(value){return JSON.parse(JSON.stringify(value))}
function onlineError(error,fallback){console.error(error);return error?.message?.includes('sync conflict')?'Este planejamento foi alterado em outro aparelho. Abra novamente a versão online antes de continuar.':fallback}
function showOnlineFailure(title,error,fallback){
  console.error(error);const message=error?.message||fallback,details=error?.details||error?.hint||'',code=error?.code||'';
  modal(title,'O Supabase devolveu os detalhes abaixo.',`<div class="stack"><div class="notice warn"><strong>${esc(message)}</strong>${details?`<p>${esc(details)}</p>`:''}${code?`<p>Código: <code>${esc(code)}</code></p>`:''}</div><p class="help">Essas informações ajudam a corrigir o problema. Você pode tirar um print desta janela e enviar.</p><div class="actions"><button type="button" class="button primary" data-close>Fechar</button></div></div>`);
}
function updateOnlineNote(){const note=document.querySelector('.side-note');if(!note)return;const linked=Boolean(juntoOnline.user&&activeOnlineLink()),terms=onlinePlanTerms();note.innerHTML=`<i></i> ${linked?'Planejamento sincronizado online':juntoOnline.user?`Conta conectada · ${terms.kind} ainda local`:'Dados salvos somente neste navegador'}`}
function updateAccountButton(){
  const user=juntoOnline.user,connected=Boolean(user&&!user.is_anonymous),name=juntoOnline.profile?.display_name||user?.email||'Minha conta';
  document.querySelectorAll('[data-account]').forEach(button=>{
    button.classList.toggle('is-online',connected);
    const label=button.querySelector('span');if(label)label.textContent=connected?`${name} · Conectado`:user?.is_anonymous?'Convidado':'Entrar';
    button.title=connected?`Conectado: ${user.email||name}`:user?.is_anonymous?'Acesso como convidado':'Entrar na sua conta';
    button.setAttribute('aria-label',button.title);
  });updateOnlineNote();
}
function onlinePlanTerms(item=trip()){const eventPlan=item?.eventType==='event';return {kind:eventPlan?'evento':'viagem',title:eventPlan?'Evento':'Viagem',article:eventPlan?'o':'a'}}
function showWelcome(){if(!welcomeEl||juntoOnline.user||sessionStorage.getItem('junto_welcome_skipped'))return;welcomeEl.hidden=false;document.body.classList.add('welcome-open');requestAnimationFrame(()=>welcomeEl.classList.add('is-visible'))}
function hideWelcome(remember=false){if(!welcomeEl)return;if(remember)sessionStorage.setItem('junto_welcome_skipped','1');welcomeEl.classList.remove('is-visible');document.body.classList.remove('welcome-open');setTimeout(()=>{welcomeEl.hidden=true},420)}
function openDemoWorkspace(kind='trip'){let demoState=migrate(clone(kind==='event'?DEMO_EVENT:DEMO));for(const migration of [globalThis.migrateV3,globalThis.migrateV4,globalThis.migrateV5,globalThis.migrateV7,globalThis.migrateV8])if(typeof migration==='function')demoState=migration(demoState);db=demoState;saveLocal();render();hideWelcome(true);document.querySelector('#app')?.focus({preventScroll:true})}
function tripBundleFor(localTripId,state=db){
  const current=(state.trips||[]).find(item=>item.id===localTripId);if(!current)return null;const groupId=current.groupId||state.activeGroupId,group=(state.groups||[]).find(item=>item.id===groupId)||{id:groupId,name:'Grupo do planejamento',description:''},payload={schemaVersion:1,exportedAt:new Date().toISOString(),trip:cloneOnline(current),group:cloneOnline(group)};
  tripScopedKeys.forEach(key=>payload[key]=cloneOnline((state[key]||[]).filter(item=>item.trip===current.id)));
  groupScopedKeys.forEach(key=>payload[key]=cloneOnline((state[key]||[]).filter(item=>item.groupId===groupId)));
  payload.shoppingYear=state.shoppingYear||null;return payload;
}
function tripBundle(){return tripBundleFor(db.active)}
let creatingOnlinePlanning=false;
async function publishNewPlanning(state,localTripId){
  if(creatingOnlinePlanning)return false;
  if(!juntoOnline.user||juntoOnline.user.is_anonymous){toast('Entre na sua conta para criar um planejamento online.','error');accountModal();return false}
  if(!juntoOnline.client||navigator.onLine===false){toast('Conecte-se à internet para criar o planejamento.','error');return false}
  creatingOnlinePlanning=true;
  try{
    const payload=tripBundleFor(localTripId,state),hash=await contentHash(payload);
    const {data,error}=await juntoOnline.client.rpc('import_local_trip',{payload,content_hash:hash});
    if(error)throw error;
    if(!data?.trip_id)throw new Error('O servidor não confirmou a criação.');
    state.onlineTrips={...state.onlineTrips,[localTripId]:{tripId:data.trip_id,revision:Number(data.revision)||1}};
    return true;
  }catch(error){showOnlineFailure('Não foi possível criar o planejamento online',error,'Tente novamente. Os dados preenchidos foram preservados.');return false}
  finally{creatingOnlinePlanning=false}
}
function rememberParticipantTrip(remoteTripId){
  const userId=juntoOnline.user?.id;if(!userId)return;
  const key=`junto_participant_trip:${userId}`;
  if(remoteTripId){localStorage.setItem(key,remoteTripId);localStorage.setItem(`junto_selected_event:${userId}`,remoteTripId)}else localStorage.removeItem(key);
}
async function contentHash(payload){const bytes=new TextEncoder().encode(JSON.stringify(payload)),digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')}
function persistOnlineLink(localTripId,link){onlineLinks()[localTripId]=link;saveLocal();updateAccountButton()}
function tripOnlinePanel(){
  const current=trip(),link=activeOnlineLink(),terms=onlinePlanTerms(current);
  if(!current)return '<div class="notice info">Crie ou selecione uma viagem ou evento para conectar à conta.</div>';
  if(!link)return `<section class="online-trip-panel"><div><strong>${esc(current.name)}</strong><p>Est${terms.article==='o'?'e':'a'} ${terms.kind} ainda está somente neste navegador.</p></div><div class="record-actions"><button type="button" class="button primary" data-online-import>Levar ${terms.kind} para minha conta</button><button type="button" class="button ghost" data-online-trips>Meus planejamentos online</button></div></section>`;
  const inviteActions=juntoOnline.invitesReady?'<button type="button" class="button secondary" data-general-invite>Compartilhar convite</button><button type="button" class="button ghost" data-manage-participant-access>Gerenciar acessos</button><button type="button" class="button secondary" data-admin-invite>Convidar administrador</button>':'<span class="help">Convites aguardando atualização segura do banco.</span>';
  return `<section class="online-trip-panel connected"><div><strong>${esc(current.name)}</strong><p>Sincronizad${terms.article==='o'?'o':'a'} online · revisão ${Number(link.revision)||1}</p></div><div class="record-actions">${inviteActions}<button type="button" class="button ghost" data-online-trips>Meus planejamentos online</button></div></section>`;
}
function accountModal(){
  if(!juntoOnline.configured){modal('Conta Juntô','A estrutura online está pronta para ser conectada.',`<div class="account-state"><div class="account-state-icon">☁</div><strong>Supabase ainda não configurado</strong><p>O modo local continua ativo e seus dados permanecem neste navegador. Para ativar contas, informe a URL e a chave publicável do projeto em <code>supabase/config.js</code>.</p></div><div class="actions"><button class="button primary" data-close>Continuar no modo local</button></div>`);return}
  if(!juntoOnline.user){authModal('login');return}
  if(juntoOnline.user.is_anonymous){modal('Sua participação','Você entrou como convidado. Sua presença já pode ser confirmada sem cadastro.',`<div class="stack"><div class="notice info">Vincule um e-mail somente se quiser acessar em outros aparelhos e organizar seus próprios eventos.</div><form id="guest-upgrade"><div class="stack">${field('guestUpgradeName','Seu nome','text',juntoOnline.profile?.display_name||'','required minlength="2" maxlength="100" autocomplete="name"')}${field('guestUpgradeEmail','Seu e-mail','email','','required autocomplete="email"')}<button class="button primary">Vincular e-mail e criar conta</button></div></form><button type="button" class="button ghost" data-online-signout>Sair</button></div>`);return}
  const name=juntoOnline.profile?.display_name||'',phone=juntoOnline.profile?.phone||'',email=juntoOnline.user.email||'';
  modal('Minha conta','Conta online conectada.',`${tripOnlinePanel()}<form id="online-profile"><div class="stack">${field('onlineName','Nome de exibição','text',name,'required maxlength="100"')}${field('onlinePhone','Telefone (opcional)','tel',phone,'autocomplete="tel" maxlength="30" placeholder="(00) 00000-0000"')}${field('onlineAccountEmail','E-mail','email',email,'disabled')}<div class="account-connected"><i></i><span>Conta online ativa</span></div><button class="button primary">Salvar perfil</button><button type="button" class="button ghost" data-online-signout>Sair da conta</button></div></form>`)
}
function authModal(mode='login'){
  const hasInvite=Boolean(pendingInvite()),inviteNotice=hasInvite?'<div class="notice info">Seu convite está guardado. Após entrar, o planejamento compartilhado será aberto automaticamente.</div>':'';
  if(mode==='signup'){
    modal('Criar conta','Use seu e-mail e escolha uma senha para entrar no Juntô.',`<form id="online-signup"><div class="stack">${field('onlineSignupName','Seu nome','text','','required maxlength="100" autocomplete="name"')}${field('onlineSignupEmail','Seu e-mail','email','','required autocomplete="email" placeholder="voce@exemplo.com"')}${field('onlineSignupPassword','Crie uma senha','password','','required minlength="6" autocomplete="new-password" placeholder="Mínimo de 6 caracteres"')}${inviteNotice}<button class="button primary">Criar minha conta</button><button type="button" class="button ghost" data-auth-mode="login">Já tenho conta</button></div></form>`);return;
  }
  if(mode==='forgot'){
    modal('Recuperar senha','Enviaremos um link para você escolher uma nova senha.',`<form id="online-forgot"><div class="stack">${field('onlineForgotEmail','Seu e-mail','email','','required autocomplete="email" placeholder="voce@exemplo.com"')}<button class="button primary">Enviar link de recuperação</button><button type="button" class="button ghost" data-auth-mode="login">Voltar para entrar</button></div></form>`);return;
  }
  modal('Entrar no Juntô','Acesse suas viagens e eventos próprios ou compartilhados.',`<form id="online-login"><div class="stack">${field('onlineEmail','Seu e-mail','email','','required autocomplete="email" placeholder="voce@exemplo.com"')}${field('onlinePassword','Sua senha','password','','required minlength="6" autocomplete="current-password"')}${inviteNotice}<button class="button primary">Entrar</button><button type="button" class="button secondary auth-google" data-google-login><span class="google-mark">G</span> Entrar com Google</button><div class="auth-links"><button type="button" data-auth-mode="signup">Criar uma conta</button><button type="button" data-auth-mode="forgot">Esqueci minha senha</button></div></div></form>`);
}
function passwordUpdateModal(){
  juntoOnline.recoveryPending=false;const url=new URL(location.href);url.searchParams.delete('auth_action');history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
  modal('Criar nova senha','Escolha a senha que será usada nos próximos acessos.',`<form id="online-password-update"><div class="stack">${field('onlineNewPassword','Nova senha','password','','required minlength="6" autocomplete="new-password"')}${field('onlineNewPasswordConfirm','Confirmar nova senha','password','','required minlength="6" autocomplete="new-password"')}<button class="button primary">Salvar nova senha</button></div></form>`);
}
function guestPasswordModal(){
  juntoOnline.guestUpgradePending=false;const url=new URL(location.href);url.searchParams.delete('auth_action');history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
  modal('Concluir sua conta','E-mail confirmado. Agora crie uma senha para acessar em outros aparelhos.',`<form id="guest-password"><div class="stack">${field('guestPassword','Crie uma senha','password','','required minlength="6" autocomplete="new-password"')}${field('guestPasswordConfirm','Confirmar senha','password','','required minlength="6" autocomplete="new-password"')}<button class="button primary">Concluir cadastro</button></div></form>`);
}
async function loadOnlineProfile(){if(!juntoOnline.user)return;const accountId=juntoOnline.user.id;const {data,error}=await juntoOnline.client.from('profiles').select('id,display_name,phone,avatar_path,platform_owner').eq('id',juntoOnline.user.id).single();if(!error&&juntoOnline.user?.id===accountId)juntoOnline.profile=data;updateAccountButton()}
async function importActiveTrip(askConfirmation=true){
  if(!juntoOnline.user)return accountModal();if(!trip())return toast('Crie ou selecione uma viagem ou evento primeiro.','error');const terms=onlinePlanTerms();
  if(askConfirmation&&!confirm(`Levar “${trip().name}” para sua conta online? Depois disso, as alterações dest${terms.article==='o'?'e':'a'} ${terms.kind} serão sincronizadas.`))return false;
  const payload=tripBundle(),hash=await contentHash(payload),button=document.querySelector('[data-online-import]');if(button)button.disabled=true;
  const {data,error}=await juntoOnline.client.rpc('import_local_trip',{payload,content_hash:hash});
  if(error){if(button)button.disabled=false;showOnlineFailure('Não foi possível levar o planejamento para a conta',error,'Falha desconhecida ao salvar o planejamento.');return false}
  persistOnlineLink(db.active,{tripId:data.trip_id,revision:Number(data.revision)||1});if(askConfirmation)accountModal();toast(`${terms.title} salv${terms.article==='o'?'o':'a'} na sua conta e sincronização ativada.`);
  return true;
}
function scheduleOnlineSync(){clearTimeout(juntoOnline.syncTimer);const link=activeOnlineLink();if(!juntoOnline.user||!link||link.conflict)return;if(juntoOnline.syncing){juntoOnline.syncQueued=true;return}juntoOnline.syncTimer=setTimeout(syncActiveTrip,900)}
function mergeRemoteJoinedParticipants(localTripId,payload){
  const remotePeople=(payload?.people||[]).filter(person=>person.joinedByLink===true&&person.removedFromTrip!==true),localIds=new Set((db.people||[]).filter(person=>person.trip===localTripId).map(person=>person.id)),additions=remotePeople.filter(person=>!localIds.has(person.id));if(!additions.length)return 0;
  const memberIds=new Set(additions.map(person=>person.memberId).filter(Boolean)),localMemberIds=new Set((db.members||[]).map(member=>member.id));(payload.members||[]).filter(member=>memberIds.has(member.id)&&!localMemberIds.has(member.id)).forEach(member=>db.members.push(cloneOnline(member)));
  additions.forEach(person=>db.people.push(cloneOnline(person)));if(db.active===localTripId&&typeof syncSimplePeoplePlan==='function')syncSimplePeoplePlan();return additions.length;
}
async function resolveJoinedParticipantConflict(localTripId,link){
  const {data,error}=await juntoOnline.client.from('trip_snapshots').select('payload,revision').eq('trip_id',link.tripId).single();if(error)return false;const localIds=new Set((db.people||[]).filter(person=>person.trip===localTripId).map(person=>person.id)),joinedCount=(data.payload?.people||[]).filter(person=>person.joinedByLink===true&&person.removedFromTrip!==true&&!localIds.has(person.id)).length,revisionDelta=Number(data.revision)-Number(link.revision);if(!joinedCount||revisionDelta!==joinedCount)return false;const added=mergeRemoteJoinedParticipants(localTripId,data.payload);link.revision=Number(data.revision);link.conflict=false;saveLocal();toast(`${added} nova${added===1?' confirmação incorporada':'s confirmações incorporadas'} antes de salvar.`);return true;
}
async function syncActiveTrip(){
  clearTimeout(juntoOnline.syncTimer);juntoOnline.syncTimer=null;const link=activeOnlineLink();if(!juntoOnline.user||!link||link.conflict||juntoOnline.syncing)return;juntoOnline.syncing=true;juntoOnline.syncQueued=false;
  const {data,error}=await juntoOnline.client.rpc('sync_trip_snapshot',{target_trip:link.tripId,new_payload:tripBundle(),expected_revision:link.revision});juntoOnline.syncing=false;
  if(error){if(error.message?.includes('sync conflict')){if(await resolveJoinedParticipantConflict(db.active,link)){await syncActiveTrip();return}link.conflict=true;saveLocal();toast(onlineError(error),'error')}else toast('Alteração salva neste navegador; a sincronização online será tentada novamente.','error');return}
  link.revision=Number(data);link.conflict=false;saveLocal();updateOnlineNote();if(juntoOnline.syncQueued)scheduleOnlineSync();
}
async function syncTripSnapshotById(localTripId){
  const link=onlineLinks()[localTripId],payload=tripBundleFor(localTripId);if(!juntoOnline.user||!link||!payload||link.conflict)return false;const {data,error}=await juntoOnline.client.rpc('sync_trip_snapshot',{target_trip:link.tripId,new_payload:payload,expected_revision:link.revision});if(error){if(error.message?.includes('sync conflict')&&await resolveJoinedParticipantConflict(localTripId,link))return syncTripSnapshotById(localTripId);if(error.message?.includes('sync conflict'))link.conflict=true;saveLocal();toast(onlineError(error,'Não foi possível sincronizar este planejamento.'),'error');return false}link.revision=Number(data);link.conflict=false;saveLocal();updateOnlineNote();return true;
}
save=function(){saveLocal();scheduleOnlineSync()};
function mergeOnlineBundle(payload,remoteTripId,revision,openOverview=false){
  if(typeof removeLegacySharedShopping==='function')removeLegacySharedShopping(payload);
  const localTripId=payload.trip?.id,groupId=payload.group?.id||payload.trip?.groupId;if(!localTripId||!groupId)throw new Error('invalid snapshot');
  db.groups=(db.groups||[]).filter(item=>item.id!==groupId);db.groups.push(payload.group);db.trips=(db.trips||[]).filter(item=>item.id!==localTripId);db.trips.push(payload.trip);
  tripScopedKeys.forEach(key=>{const records=[...new Map((payload[key]||[]).map(item=>[item.id,item])).values()];db[key]=(db[key]||[]).filter(item=>item.trip!==localTripId);db[key].push(...records)});
  groupScopedKeys.forEach(key=>{const records=[...new Map((payload[key]||[]).map(item=>[item.id,item])).values()];db[key]=(db[key]||[]).filter(item=>item.groupId!==groupId);db[key].push(...records)});
  if(openOverview){db.simplePage='inicio';db.legacyPage='';db.page='inicio'}
  if(payload.shoppingYear)db.shoppingYear=payload.shoppingYear;db.active=localTripId;db.activeGroupId=groupId;onlineLinks()[localTripId]={tripId:remoteTripId,revision:Number(revision)||1};saveLocal();render();updateAccountButton();
}
async function loadOnlineTrip(remoteTripId){
  const loadingAccount=juntoOnline.user?.id;
  rememberParticipantTrip(null);juntoOnline.participantTripId=null;document.body.classList.remove('participant-online-view');
  const {data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,revision').eq('trip_id',remoteTripId).single();if(juntoOnline.user?.id!==loadingAccount)return;if(error)return toast('Não foi possível abrir o planejamento online.','error');const terms=onlinePlanTerms(data.payload?.trip);
  try{mergeOnlineBundle(data.payload,data.trip_id,data.revision,true);localStorage.setItem(`junto_selected_event:${juntoOnline.user.id}`,remoteTripId);closeModal();toast(`${terms.title} online abert${terms.article==='o'?'o':'a'} neste navegador.`)}catch(loadError){console.error(loadError);toast('A versão online deste planejamento é incompatível.','error')}
}
async function refreshActiveOnlineTrip(){
  const link=activeOnlineLink();if(!link)return toast('Este planejamento ainda não está sincronizado.','error');
  if(juntoOnline.syncing||juntoOnline.syncTimer)return toast('Aguarde as alterações locais terminarem de salvar.','error');
  const {data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,revision').eq('trip_id',link.tripId).single();
  if(error)return showOnlineFailure('Não foi possível atualizar o planejamento',error,'Tente novamente.');
  if(Number(data.revision)<=Number(link.revision||0))return toast('As confirmações já estão atualizadas.');
  try{mergeOnlineBundle(data.payload,data.trip_id,data.revision);toast('Confirmações e dados online atualizados.')}catch(loadError){console.error(loadError);toast('A versão online deste planejamento é incompatível.','error')}
}
const planningDirectory={userId:null,items:[],loaded:false,loading:false,error:''};
function planningAccessRole(item){return item.role==='organizer'?'organizer':'participant'}
function eventMapQuery(item){return String(item.address||'').trim()||String(item.region||'').trim()}
async function refreshPlanningDirectory(){
  const userId=juntoOnline.user?.id;if(!userId)return;
  if(planningDirectory.userId!==userId)Object.assign(planningDirectory,{userId,items:[],loaded:false,loading:false,error:''});
  if(planningDirectory.loading)return;
  planningDirectory.loading=true;planningDirectory.error='';
  try{
    const [views,snapshots]=await Promise.all([
      juntoOnline.client.rpc('list_my_trip_views'),
      juntoOnline.client.from('trip_snapshots').select('trip_id,payload,updated_at').order('updated_at',{ascending:false})
    ]);
    if(juntoOnline.user?.id!==userId)return;
    if(views.error)throw views.error;
    if(snapshots.error)throw snapshots.error;
    const merged=new Map((Array.isArray(views.data)?views.data:[]).map(item=>[item.trip_id,item]));
    for(const snapshot of snapshots.data||[]){const item=snapshot.payload?.trip||{};merged.set(snapshot.trip_id,{...merged.get(snapshot.trip_id),trip_id:snapshot.trip_id,role:'organizer',name:item.name,event_type:item.eventType==='event'?'celebration':'trip',updated_at:snapshot.updated_at,details:item,participantCount:(snapshot.payload?.people||[]).filter(person=>!person.removedFromTrip).length})}
    planningDirectory.items=[...merged.values()].sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||''));planningDirectory.loaded=true;
  }catch(error){if(juntoOnline.user?.id===userId)planningDirectory.error='Não foi possível atualizar seus planejamentos. Tente novamente.'}
  finally{if(planningDirectory.userId===userId){planningDirectory.loading=false;if(db.simplePage==='viagens'&&!juntoOnline.participantTripId)render()}}
}
function planningDirectorySection(role,title,description){
  const items=planningDirectory.items.filter(item=>planningAccessRole(item)===role);
  const rows=items.map(item=>{
    const eventPlan=['event','celebration'].includes(item.event_type),details=item.details||{},cover=String(details.coverImage||''),safeCover=/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(cover)?cover:'',admin=role==='organizer';
    const info=[eventPlan?'Evento':'Viagem',admin?'Administrador':'Convidado',details.region,details.eventDate||details.start,details.eventStartTime,item.participantCount!=null?`${item.participantCount} participantes`:''].filter(Boolean);
    return `<article class="directory-event-card ${(localStorage.getItem(`junto_selected_event:${juntoOnline.user?.id}`)||activeOnlineLink()?.tripId)===item.trip_id?'selected-event':''} ${safeCover?'has-photo':''}" tabindex="0" data-event-open="${esc(item.trip_id)}" data-event-role="${role}" ${admin?`data-directory-card="${esc(item.trip_id)}"`:''}>${safeCover?`<img class="directory-event-photo" src="${esc(safeCover)}" alt="" loading="lazy">`:''}<div class="directory-event-content">${admin?`<div class="directory-cover-tools"><button type="button" data-directory-paste="${esc(item.trip_id)}">Colar foto</button><label>Subir foto<input type="file" accept="image/jpeg,image/png,image/webp" data-directory-upload="${esc(item.trip_id)}"></label></div>`:''}<h3>${esc(item.name||'Planejamento')}</h3><div class="directory-event-tags">${info.map(value=>`<span>${esc(value)}</span>`).join('')}</div><div class="directory-event-footer">${admin?`<button type="button" class="button small" data-directory-delete="${esc(item.trip_id)}">Excluir</button>`:''}<button type="button" class="button secondary small" data-open-online-trip="${esc(item.trip_id)}" data-online-role="${role}">${admin?'Abrir como adm':'Visualizar evento'} <span aria-hidden="true">↗</span></button></div></div></article>`;
  }).join('');
  return `<section class="card"><div class="section-head"><div><h2>${title}</h2><p>${description}</p></div><strong>${items.length}</strong></div><div class="trip-manager-grid">${rows||`<p class="help">${role==='organizer'?'Você ainda não organiza nenhum planejamento.':'Seus convites aceitos aparecerão aqui.'}</p>`}</div></section>`;
}
function onlinePlanningPage(){
  const userId=juntoOnline.user?.id;
  if(planningDirectory.userId!==userId)Object.assign(planningDirectory,{userId,items:[],loaded:false,loading:false,error:''});
  if(!planningDirectory.loaded&&!planningDirectory.loading&&!planningDirectory.error)queueMicrotask(()=>refreshPlanningDirectory());
  const status=planningDirectory.loading||!planningDirectory.loaded&&!planningDirectory.error?'<p class="help" role="status">Carregando seus planejamentos…</p>':'';
  const error=planningDirectory.error?`<div class="notice warn" role="alert">${esc(planningDirectory.error)} <button type="button" class="button secondary small" data-refresh-planning-directory>Tentar novamente</button></div>`:'';
  const sections=planningDirectory.loaded?planningDirectorySection('organizer','Organizando','Planejamentos que você pode administrar e editar.')+planningDirectorySection('participant','Participando como convidado','Convites aceitos, com acesso às informações compartilhadas pelo organizador.'):'';
  return simpleShell('Viagens e eventos','Seus planejamentos organizados e os eventos em que você participa.','<button type="button" class="button secondary" data-refresh-planning-directory>Atualizar lista</button><button type="button" class="button secondary" data-new-historical-trip>+ Viagem anterior</button><button type="button" class="button primary" data-new-trip>+ Novo planejamento</button>',`<div class="simple-stack">${status}${error}${sections}</div>`);
}
async function updateDirectoryCover(remoteTripId,file){
  if(!file)return toast('Copie uma imagem ou escolha um arquivo.','error');
  try{
    const image=await tripCoverData(file),{data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,revision').eq('trip_id',remoteTripId).single();
    if(error)throw error;
    mergeOnlineBundle(data.payload,data.trip_id,data.revision);trip().coverImage=image;saveLocal();
    if(await syncTripSnapshotById(db.active)){closeModal();await refreshPlanningDirectory();if(!juntoOnline.participantTripId&&db.simplePage!=='viagens')render();toast('Foto do evento atualizada.')}
  }catch(error){toast(error.message==='image too large'?'Escolha uma imagem de até 10 MB.':'Não foi possível atualizar a foto. Tente novamente.','error')}
}
window.addEventListener('change',event=>{const input=event.target.closest('[data-directory-upload]');if(input){event.stopImmediatePropagation();void updateDirectoryCover(input.dataset.directoryUpload,input.files?.[0])}},true);
window.addEventListener('paste',event=>{const zone=event.target.closest?.('[data-directory-card],[data-directory-paste-zone]');if(!zone)return;const file=[...(event.clipboardData?.items||[])].find(item=>item.type.startsWith('image/'))?.getAsFile();if(!file)return;event.preventDefault();event.stopImmediatePropagation();void updateDirectoryCover(zone.dataset.directoryCard||zone.dataset.directoryPasteZone,file)},true);

function openPlanningDirectory(){rememberParticipantTrip(null);juntoOnline.participantTripId=null;document.body.classList.remove('participant-online-view');db.simplePage='viagens';db.legacyPage='';closeModal();saveLocal();render();void refreshPlanningDirectory()}

async function onlineTripsModal(){
  modal('Meus planejamentos online','Viagens e eventos próprios ou compartilhados com você.','<div class="account-state"><div class="account-state-icon">↻</div><strong>Carregando planejamentos…</strong></div>');
  if(!juntoOnline.invitesReady){const {data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,updated_at').order('updated_at',{ascending:false});if(error)return modal('Meus planejamentos online','Não foi possível consultar agora.',`<div class="notice warn">${esc(error.message)}</div>`);const rows=(data||[]).map(item=>{const current=item.payload?.trip,terms=onlinePlanTerms(current);return `<button type="button" class="online-trip-row" data-open-online-trip="${item.trip_id}"><span><strong>${esc(current?.name||terms.title)}</strong><small>${terms.title} · atualizado em ${new Date(item.updated_at).toLocaleString('pt-BR')}</small></span><b>Abrir</b></button>`}).join('')||'<div class="notice info">Nenhum planejamento online encontrado.</div>';modal('Meus planejamentos online','A atualização de convites ainda não foi aplicada ao banco.',`<div class="online-trip-list">${rows}</div>`);return}
  const {data,error}=await juntoOnline.client.rpc('list_my_trip_views');if(error)return modal('Meus planejamentos online','Não foi possível consultar agora.',`<div class="notice warn">${esc(error.message)}</div>`);
  const rows=(data||[]).map(item=>`<button type="button" class="online-trip-row" data-open-online-trip="${item.trip_id}" data-online-role="${item.role}"><span><strong>${esc(item.name||'Planejamento')}</strong><small>${item.event_type==='celebration'?'Evento':'Viagem'} · ${item.role==='organizer'?'administração':'visualização privada'} · atualizado em ${new Date(item.updated_at).toLocaleString('pt-BR')}</small></span><b>Abrir</b></button>`).join('')||'<div class="notice info">Nenhum planejamento online encontrado.</div>';modal('Meus planejamentos online','Viagens e eventos próprios ou compartilhados com você.',`<div class="online-trip-list">${rows}</div>`);
}
function participantInviteModal(selectedPersonId=''){
  const options=people().map(person=>{const member=memberForParticipant(person);return `<option value="${esc(person.id)}" ${person.id===selectedPersonId?'selected':''} data-email="${esc(member?.email||'')}">${esc(person.name)}</option>`}).join('');
  if(!options)return toast('Cadastre participantes antes de criar um convite.','error');
  modal('Vincular acesso ao participante','Vincule uma conta ao cadastro existente, preservando seu histórico. O e-mail precisa estar confirmado.',`<form id="participant-invite"><div class="stack"><div class="field"><label for="inviteParticipant">Integrante</label><select id="inviteParticipant" name="participantId" required><option value="">Selecione</option>${options}</select></div>${field('inviteEmail','E-mail autorizado','email',memberForParticipant(people().find(person=>person.id===selectedPersonId)||{})?.email||'','required autocomplete="email" maxlength="254"')}<div class="notice info">Este vínculo não adiciona outra pessoa nem altera pagamentos. O acesso atual é somente leitura das informações compartilhadas; o link expira em 7 dias.</div><button class="button primary">Gerar convite</button></div></form>`);
}
async function createGeneralInvite(){
  const link=activeOnlineLink(),terms=onlinePlanTerms();if(!link)return toast(`Leve ${terms.article} ${terms.kind} para sua conta antes de convidar.`,'error');if(!await syncTripSnapshotById(db.active))return;
  const {data,error}=await juntoOnline.client.rpc('create_trip_join_link',{target_trip:link.tripId});if(error)return showOnlineFailure('Não foi possível criar o convite',error,'Tente novamente.');
  if(typeof data!=='string'||!/^[a-f0-9]{64}$/.test(data))return toast('O servidor não confirmou um convite válido. Tente novamente.','error');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)),hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const confirmation=await juntoOnline.client.from('trip_join_links').select('id').eq('trip_id',link.tripId).eq('token_hash',hash).eq('active',true).maybeSingle();
  if(confirmation.error||!confirmation.data)return showOnlineFailure('O convite não foi confirmado no servidor',confirmation.error||{message:'Convite não encontrado após a criação.'},'Nenhum link será compartilhado. Tente gerar novamente.');
  if(activeOnlineLink()?.tripId!==link.tripId)return;
  const inviteUrl=`${location.origin}${location.pathname}?join=${encodeURIComponent(data)}`,message=encodeURIComponent(`Você foi convidado para participar d${terms.article} ${terms.kind} “${trip().name}” no Juntô: ${inviteUrl}`);
  modal('Convite geral',`Este link pode ser usado por várias pessoas para entrar n${terms.article} ${terms.kind}.`,`<div class="stack"><div class="notice info">Cada pessoa informa o próprio nome; telefone é opcional.</div><label class="field"><span>Link do convite</span><input id="participantInviteUrl" value="${esc(inviteUrl)}" readonly></label><div class="actions"><button type="button" class="button primary" data-copy-participant-invite>Copiar link</button><a class="button secondary" href="https://wa.me/?text=${message}" target="_blank" rel="noopener">Enviar no WhatsApp</a></div></div>`);
}
function joinTripModal(){modal('Entrar no planejamento','Informe como você aparecerá na lista de participantes.',`<form id="join-trip"><div class="stack">${field('joinName','Seu nome','text',juntoOnline.profile?.display_name||'','required minlength="2" maxlength="100" autocomplete="name"')}${field('joinPhone','Telefone (opcional)','tel',juntoOnline.profile?.phone||'','maxlength="30" autocomplete="tel"')}<button type="button" class="button primary" data-confirm-join>Confirmar participação</button></div></form>`)}
async function acceptPendingJoin(name,phone){const token=pendingJoin();if(!token)return false;if(name.length<2)return toast('Informe seu nome.','error');const button=document.querySelector('[data-confirm-join]');if(button){button.disabled=true;button.textContent='Confirmando…'}try{const {data,error}=await juntoOnline.client.rpc('accept_trip_join_link',{raw_token:token,display_name:name,phone:phone||null});if(error){if(error.message?.includes('invalid join link')){localStorage.removeItem('junto_pending_join');return showOnlineFailure('Este convite não está disponível',{message:'O link não foi encontrado, foi desativado ou venceu.'},'Peça ao organizador um novo convite para este evento.')}return showOnlineFailure('Não foi possível entrar',error,'Confira os dados e tente novamente.')}await juntoOnline.client.from('profiles').update({display_name:name,phone:phone||null,updated_at:new Date().toISOString()}).eq('id',juntoOnline.user.id);localStorage.removeItem('junto_pending_join');history.replaceState({},'',location.pathname);await loadOnlineProfile();await showParticipantTrip(data.trip_id);toast('Participação confirmada. Seu nome já aparece para o administrador.');return true}catch(error){showOnlineFailure('Não foi possível entrar',error,'Confira sua conexão e tente novamente.');return false}finally{if(button?.isConnected){button.disabled=false;button.textContent='Confirmar participação'}}}
async function createParticipantInvite(participantId,invitedEmail){
  const link=activeOnlineLink(),person=people().find(item=>item.id===participantId),terms=onlinePlanTerms();if(!link||!person)return toast('Participante ou planejamento não encontrado.','error');
  if(!await syncTripSnapshotById(db.active))return;
  const email=String(invitedEmail||'').trim().toLowerCase(),{data,error}=await juntoOnline.client.rpc('create_participant_invite',{target_trip:link.tripId,local_participant_id:participantId,invited_email:email});if(error)return showOnlineFailure('Não foi possível criar o convite',error,'Confira o e-mail e tente novamente.');
  const inviteUrl=`${location.origin}${location.pathname}?invite=${encodeURIComponent(data)}`,message=encodeURIComponent(`${person.name}, você foi convidado para acompanhar ${terms.article} ${terms.kind} “${trip().name}” no Juntô: ${inviteUrl}`);
  modal('Convite pronto',`${person.name} deverá entrar com ${email}.`,`<div class="stack"><label class="field"><span>Link do convite</span><input id="participantInviteUrl" value="${esc(inviteUrl)}" readonly></label><div class="actions"><button type="button" class="button primary" data-copy-participant-invite>Copiar link</button><a class="button secondary" href="https://wa.me/?text=${message}" target="_blank" rel="noopener">Enviar no WhatsApp</a></div></div>`);
}
function renderGuestAccessUnavailable(message='Seu acesso a este planejamento não está mais ativo.'){
  juntoOnline.participantTripId=null;document.body.classList.add('participant-online-view');closeModal();
  document.querySelector('#app').innerHTML=`<div class="participant-portal"><section class="card account-state"><div class="account-state-icon">🔒</div><h1>Acesso indisponível</h1><p>${esc(message)}</p><div class="actions"><button type="button" class="button primary" data-account>Minha participação</button><button type="button" class="button ghost" data-online-signout>Sair</button></div></section></div>`;
  document.querySelector('#app')?.focus({preventScroll:true});updateAccountButton();
}
function participantNavigation(){
  const nav=document.querySelector('#nav');if(!nav)return;
  nav.innerHTML='<button type="button" class="nav active" data-guest-section="app"><span>⌂</span>Visão geral</button><button type="button" class="nav" data-guest-section="guest-event-info"><span>◇</span>Informações do evento</button><button type="button" class="nav" data-guest-section="guest-finance-summary"><span>$</span>Resumo financeiro</button><button type="button" class="nav" data-leave-participant-view><span>☷</span>Viagens e eventos</button>';
}
async function showParticipantTrip(remoteTripId){
  const loadingAccount=juntoOnline.user?.id;
  const {data,error}=await juntoOnline.client.rpc('get_participant_trip_view',{target_trip:remoteTripId});if(juntoOnline.user?.id!==loadingAccount)return false;if(error){if(!['42501','P0001'].includes(error.code)){toast('Não foi possível atualizar o evento. Tente novamente.','error');return false}rememberParticipantTrip(null);if(juntoOnline.user?.is_anonymous)renderGuestAccessUnavailable();else{juntoOnline.participantTripId=null;document.body.classList.remove('participant-online-view');render();toast('Este acesso não está mais disponível.','error')}return false}
  const item=data.trip||{},summary=data.summary||{},kind=item.eventType==='event'?'Evento':'Viagem',mapQuery=eventMapQuery(item),mapLink=mapQuery?`<a class="button secondary small" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}">Abrir no mapa ↗</a>`:'';
  rememberParticipantTrip(remoteTripId);juntoOnline.participantTripId=remoteTripId;document.body.classList.add('participant-online-view');closeModal();participantNavigation();
  const accountAction=juntoOnline.user?.is_anonymous?'<button type="button" class="button primary" data-account>Criar conta para acessar em outro aparelho</button>':'<button type="button" class="button secondary" data-leave-participant-view>Meus planejamentos</button>';
  document.querySelector('#app').innerHTML=`<div class="participant-portal"><header class="participant-portal-head"><div><p class="eyebrow">${kind.toUpperCase()} COMPARTILHAD${kind==='Evento'?'O':'A'}</p><h1>${esc(item.name||kind)}</h1><p>Acesso privado às informações gerais e aos totais do planejamento.</p></div><div class="record-actions"><button type="button" class="button ghost" data-refresh-participant-trip>Atualizar</button>${accountAction}</div></header><div class="notice info">Sua privacidade está protegida: pagamentos individuais, nomes de pagadores, comprovantes e dados particulares não aparecem aqui.</div><div class="simple-metrics participant-summary">${metric('Valor previsto',cash(summary.budget_cents))}${metric('Total arrecadado',cash(summary.collected_cents))}${metric('Falta arrecadar',cash(summary.remaining_cents))}${metric('Saldo disponível',cash((summary.collected_cents||0)-(summary.spent_cents||0)))}</div><div class="participant-portal-grid"><section class="card" id="guest-event-info"><div class="section-head"><div><h2>Informações d${kind==='Evento'?'o evento':'a viagem'}</h2><p>Dados informados pelo administrador.</p></div></div><div class="record"><span>Local</span><strong>${esc(item.region||'A definir')}</strong></div>${item.address?`<div class="record"><span>Endereço</span><strong>${esc(item.address)}${item.addressComplement?` · ${esc(item.addressComplement)}`:''}</strong>${mapLink}</div>`:''}<div class="record"><span>Data e horário</span><strong>${item.eventDate?date(item.eventDate):item.start?date(item.start):'A definir'}${item.eventStartTime?' · '+esc(item.eventStartTime):''}${item.eventEndTime?' às '+esc(item.eventEndTime):''}</strong></div><div class="record"><span>Participantes confirmados</span><strong>${Number(data.participant_count)||0}</strong></div></section><section class="card" id="guest-finance-summary"><div class="section-head"><div><h2>Resumo financeiro</h2><p>Somente valores coletivos.</p></div></div><div class="record"><span>Despesas previstas</span><strong>${cash(summary.planned_cents)}</strong></div><div class="record"><span>Despesas pagas</span><strong>${cash(summary.spent_cents)}</strong></div><div class="record"><span>Valor ainda planejado</span><strong>${cash(Math.max(0,(summary.planned_cents||0)-(summary.spent_cents||0)))}</strong></div></section></div></div>`;
  if(typeof renderGuestSharedSections==='function')renderGuestSharedSections(data);document.querySelector('#app')?.focus({preventScroll:true});updateAccountButton();return true;
}
async function manageParticipantAccess(){
  const link=activeOnlineLink();if(!link)return;
  modal('Acessos dos participantes','Convites pendentes e acessos ativos.','<div class="account-state"><strong>Carregando…</strong></div>');
  const {data,error}=await juntoOnline.client.rpc('list_trip_participant_access',{target_trip:link.tripId});if(error)return showOnlineFailure('Não foi possível consultar os acessos',error,'Tente novamente.');
  const rows=(data||[]).map(item=>`<div class="record"><div><strong>${esc(item.name)}</strong><div class="record-meta">${esc(item.email||'Sem e-mail')} · ${item.access_active?'Acesso ativo':item.access_revoked?'Acesso revogado':item.invite_status==='pending'?'Convite pendente':'Sem acesso'}</div></div>${item.access_revoked?`<button type="button" class="button secondary small" data-restore-participant="${esc(item.participant_id)}">Restaurar</button>`:item.access_active||item.invite_status==='pending'?`<button type="button" class="button danger small" data-revoke-participant="${esc(item.participant_id)}">Revogar</button>`:''}</div>`).join('')||'<div class="notice info">Nenhum participante ativo.</div>';
  modal('Acessos dos participantes','Revogar bloqueia a consulta imediatamente e cancela convites pendentes.',`<div class="stack">${rows}<div class="actions"><button type="button" class="button primary" data-close>Fechar</button></div></div>`);
}
function adminInviteModal(){modal('Convidar administrador','O convite só poderá ser aceito pela conta correspondente ao e-mail informado.',`<form id="admin-invite"><div class="stack">${field('adminInviteEmail','E-mail autorizado','email','','required autocomplete="email" maxlength="254"')}<div class="notice warn">Administradores podem ver e alterar todos os dados do planejamento.</div><button class="button primary">Gerar convite</button></div></form>`)}
async function createAdminInvite(invitedEmail){
  const link=activeOnlineLink(),terms=onlinePlanTerms();if(!link)return toast(`Leve ${terms.article} ${terms.kind} para sua conta antes de convidar.`,'error');const email=String(invitedEmail||'').trim().toLowerCase(),{data,error}=await juntoOnline.client.rpc('create_admin_invite',{target_trip:link.tripId,invited_email:email});if(error)return toast(onlineError(error,'Não foi possível criar o convite.'),'error');
  const inviteUrl=`${location.origin}${location.pathname}?invite=${encodeURIComponent(data)}`,message=encodeURIComponent(`Você foi convidado para administrar ${terms.article} ${terms.kind} “${trip().name}” no Juntô: ${inviteUrl}`);
  modal('Convidar administrador',`Este acesso permite ver e alterar tod${terms.article} ${terms.kind}.`,`<div class="stack"><div class="notice warn">Envie somente para uma pessoa de confiança. O link expira em 7 dias e funciona uma única vez.</div><label class="field"><span>Link do convite</span><input id="adminInviteUrl" value="${esc(inviteUrl)}" readonly></label><div class="actions"><button type="button" class="button primary" data-copy-admin-invite>Copiar link</button><a class="button secondary" href="https://wa.me/?text=${message}" target="_blank" rel="noopener">Enviar no WhatsApp</a></div></div>`);
}
function captureInvite(){const url=new URL(location.href),token=url.searchParams.get('invite'),join=url.searchParams.get('join');if(token){localStorage.removeItem('junto_pending_join');localStorage.setItem('junto_pending_invite',token)}else if(join){localStorage.removeItem('junto_pending_invite');localStorage.setItem('junto_pending_join',join)}if(token||join){url.searchParams.delete('invite');url.searchParams.delete('join');history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`)}}
async function acceptPendingInvite(){
  const token=localStorage.getItem('junto_pending_invite');if(!token||!juntoOnline.user)return false;const {data,error}=await juntoOnline.client.rpc('accept_trip_invite',{raw_token:token});
  if(error){if(error.message?.includes('invite email mismatch')){toast('Este convite pertence a outro e-mail. Entre com a conta indicada pelo administrador.','error');return false}localStorage.removeItem('junto_pending_invite');history.replaceState({},'',location.pathname);toast('Este convite é inválido, expirou ou já foi usado.','error');return false}
  localStorage.removeItem('junto_pending_invite');history.replaceState({},'',location.pathname);if(data.role==='organizer'){await loadOnlineTrip(data.trip_id);toast('Convite aceito. Você agora administra este planejamento.')}else{await showParticipantTrip(data.trip_id);toast('Convite aceito. Acesso somente leitura liberado.')}return true;
}
async function restoreOnlineTrips(){
  const userId=juntoOnline.user?.id;if(!userId||juntoOnline.restoring||juntoOnline.restoredFor===userId)return;
  juntoOnline.restoring=true;const {data:views,error:viewsError}=await juntoOnline.client.rpc('list_my_trip_views');if(juntoOnline.user?.id!==userId)return;if(!viewsError){const remembered=localStorage.getItem(`junto_participant_trip:${userId}`),selected=views?.find(item=>item.trip_id===remembered);if(selected?.role==='participant'){juntoOnline.restoring=false;juntoOnline.restoredFor=userId;await showParticipantTrip(selected.trip_id);return}if(remembered&&!selected)rememberParticipantTrip(null)}if(!viewsError&&views?.length===1&&views[0].role==='participant'){juntoOnline.restoring=false;juntoOnline.restoredFor=userId;await showParticipantTrip(views[0].trip_id);return}if(!viewsError&&views?.length>1&&views.every(item=>item.role==='participant')){juntoOnline.restoring=false;juntoOnline.restoredFor=userId;onlineTripsModal();return}if(!viewsError&&!views?.length&&juntoOnline.user?.is_anonymous){juntoOnline.restoring=false;juntoOnline.restoredFor=userId;renderGuestAccessUnavailable();return}const {data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,revision,updated_at').order('updated_at',{ascending:false});if(juntoOnline.user?.id!==userId)return;juntoOnline.restoring=false;juntoOnline.restoredFor=userId;
  if(error){console.error(error);toast('Você entrou, mas não foi possível carregar seus planejamentos online.','error');return}
  const currentLink=activeOnlineLink(),currentOnline=currentLink&&(data||[]).find(item=>item.trip_id===currentLink.tripId);if(currentOnline){if(Number(currentOnline.revision)>Number(currentLink.revision||0)){try{mergeOnlineBundle(currentOnline.payload,currentOnline.trip_id,currentOnline.revision);toast('O planejamento foi atualizado com as alterações compartilhadas.')}catch(loadError){console.error(loadError);toast('A atualização online deste planejamento é incompatível.','error')}}return}
  if(data?.length===1){const item=data[0];try{mergeOnlineBundle(item.payload,item.trip_id,item.revision);toast('Seu planejamento online foi carregado.')}catch(loadError){console.error(loadError);toast('O planejamento online encontrado é incompatível.','error')}return}
  if(data?.length>1)onlineTripsModal();
  if(!data?.length)toast('Conta conectada, mas nenhum planejamento online foi encontrado.','error');
}
async function resumeAuthenticatedAccount(){
  await loadOnlineProfile();if(juntoOnline.recoveryPending){passwordUpdateModal();return}if(juntoOnline.guestUpgradePending){guestPasswordModal();return}if(juntoOnline.invitesReady&&pendingJoin()){joinTripModal();return}if(juntoOnline.invitesReady&&await acceptPendingInvite())return;if((pendingInvite()||pendingJoin())&&!juntoOnline.invitesReady)toast('O convite será liberado após a atualização segura do banco.','error');await restoreOnlineTrips();
}
async function checkInviteBackend(){const {data,error}=await juntoOnline.client.rpc('participant_invites_schema_version');juntoOnline.invitesReady=!error&&Number(data)>=5}
async function initializeOnlineAccount(){
  captureInvite();juntoOnline.configured=onlineReady();if(!juntoOnline.configured){updateAccountButton();return}
  const config=onlineConfig();juntoOnline.client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});const {data}=await juntoOnline.client.auth.getSession();juntoOnline.user=data.session?.user||null;if(typeof isolateAccountWorkspace==='function')isolateAccountWorkspace(juntoOnline.user?.id);
  if(juntoOnline.user){await checkInviteBackend();hideWelcome();await resumeAuthenticatedAccount()}else{updateAccountButton();if(pendingJoin()){const {error}=await juntoOnline.client.auth.signInAnonymously();if(error){console.error(error);toast('A entrada de convidados precisa ser habilitada no Supabase.','error');setTimeout(()=>authModal('signup'),350)}}else if(pendingInvite())setTimeout(accountModal,350);else showWelcome()}
  juntoOnline.client.auth.onAuthStateChange((authEvent,session)=>{juntoOnline.user=session?.user||null;if(typeof isolateAccountWorkspace==='function')isolateAccountWorkspace(juntoOnline.user?.id);juntoOnline.profile=null;if(authEvent==='PASSWORD_RECOVERY')juntoOnline.recoveryPending=true;if(juntoOnline.user){hideWelcome();setTimeout(async()=>{await checkInviteBackend();await resumeAuthenticatedAccount()},0)}else{juntoOnline.invitesReady=false;juntoOnline.restoredFor=null;juntoOnline.participantTripId=null;document.body.classList.remove('participant-online-view');render();updateAccountButton()}});
}

document.addEventListener('click',async event=>{
  const welcomeAuth=event.target.closest('[data-welcome-auth]');if(welcomeAuth){if(!juntoOnline.configured)return accountModal();authModal(welcomeAuth.dataset.welcomeAuth);return}
  const welcomeDemo=event.target.closest('[data-welcome-demo]');if(welcomeDemo){openDemoWorkspace(welcomeDemo.dataset.welcomeDemo);return}
  if(event.target.closest('[data-account]')){accountModal();return}if(event.target.closest('[data-online-signout]')){await juntoOnline.client?.auth.signOut();closeModal();toast('Você saiu da conta. Seus dados continuam salvos online.');return}
  const authMode=event.target.closest('[data-auth-mode]');if(authMode){authModal(authMode.dataset.authMode);return}
  if(event.target.closest('[data-google-login]')){const {error}=await juntoOnline.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:authReturnUrl()}});if(error)toast(authMessage(error,'Não foi possível entrar com o Google.'),'error');return}
  if(event.target.closest('[data-online-import]')){await importActiveTrip();return}if(event.target.closest('[data-admin-invite]')){adminInviteModal();return}if(event.target.closest('[data-online-trips]')){openPlanningDirectory();return}
  const open=event.target.closest('[data-open-online-trip]');if(open){open.dataset.onlineRole==='participant'?await showParticipantTrip(open.dataset.openOnlineTrip):await loadOnlineTrip(open.dataset.openOnlineTrip);return}
  if(event.target.closest('[data-general-invite]')){await createGeneralInvite();return}
  if(event.target.closest('[data-refresh-participant-trip]')){if(await showParticipantTrip(juntoOnline.participantTripId))toast('Informações atualizadas.');return}
  if(event.target.closest('[data-leave-participant-view]')){openPlanningDirectory();return}
  if(event.target.closest('[data-refresh-online-trip]')){await refreshActiveOnlineTrip();return}
  if(event.target.closest('[data-confirm-join]')){const form=document.querySelector('#join-trip');if(!form?.reportValidity())return;const joinForm=new FormData(form);await acceptPendingJoin(String(joinForm.get('joinName')||'').trim(),String(joinForm.get('joinPhone')||'').trim());return}
  if(event.target.closest('[data-share-created-event]')){if(!juntoOnline.user)return accountModal();if(!juntoOnline.invitesReady)return toast('Atualize o Supabase antes de liberar os convites.','error');if(!activeOnlineLink())await importActiveTrip();if(activeOnlineLink())await createGeneralInvite();return}
  if(event.target.closest('[data-manage-participant-access]')){await manageParticipantAccess();return}
  const revokeParticipant=event.target.closest('[data-revoke-participant]');if(revokeParticipant){if(!confirm('Revogar este convite e o acesso atual?'))return;const link=activeOnlineLink(),{error}=await juntoOnline.client.rpc('revoke_trip_participant_access',{target_trip:link.tripId,local_participant_id:revokeParticipant.dataset.revokeParticipant});if(error)return showOnlineFailure('Não foi possível revogar o acesso',error,'Tente novamente.');toast('Acesso revogado.');await manageParticipantAccess();return}
  const restoreParticipant=event.target.closest('[data-restore-participant]');if(restoreParticipant){if(!confirm('Restaurar o acesso deste participante?'))return;const link=activeOnlineLink(),{error}=await juntoOnline.client.rpc('restore_trip_participant_access',{target_trip:link.tripId,local_participant_id:restoreParticipant.dataset.restoreParticipant});if(error)return showOnlineFailure('Não foi possível restaurar o acesso',error,'Tente novamente.');toast('Acesso restaurado.');await manageParticipantAccess();return}
  if(event.target.closest('[data-copy-admin-invite]')){const input=document.querySelector('#adminInviteUrl'),value=input?.value;try{await navigator.clipboard.writeText(value);toast('Link copiado.')}catch{input?.select();toast('Selecione e copie o link.')}return}
  if(event.target.closest('[data-copy-participant-invite]')){const input=document.querySelector('#participantInviteUrl'),value=input?.value;try{await navigator.clipboard.writeText(value);toast('Link copiado.')}catch{input?.select();toast('Selecione e copie o link.')}return}
},true);
document.addEventListener('change',event=>{if(event.target.id!=='inviteParticipant')return;const selected=event.target.selectedOptions[0],email=document.querySelector('#inviteEmail');if(email)email.value=selected?.dataset.email||''});
document.addEventListener('submit',async event=>{
  if(event.target.id==='participant-invite'){event.preventDefault();event.stopImmediatePropagation();const inviteForm=new FormData(event.target);await createParticipantInvite(inviteForm.get('participantId'),inviteForm.get('inviteEmail'));return}
  if(event.target.id==='join-trip'){event.preventDefault();event.stopImmediatePropagation();const joinForm=new FormData(event.target);await acceptPendingJoin(String(joinForm.get('joinName')||'').trim(),String(joinForm.get('joinPhone')||'').trim());return}
  if(event.target.id==='admin-invite'){event.preventDefault();event.stopImmediatePropagation();await createAdminInvite(new FormData(event.target).get('adminInviteEmail'));return}
  if(!['online-login','online-signup','online-forgot','online-password-update','online-profile','guest-upgrade','guest-password'].includes(event.target.id))return;event.preventDefault();event.stopImmediatePropagation();const form=new FormData(event.target);
  if(event.target.id==='guest-upgrade'){const name=String(form.get('guestUpgradeName')||'').trim(),email=String(form.get('guestUpgradeEmail')||'').trim().toLowerCase();const {error}=await juntoOnline.client.auth.updateUser({email,data:{display_name:name}},{emailRedirectTo:authReturnUrl('guest-upgrade')});if(error)return toast(authMessage(error,'Não foi possível vincular seu e-mail.'),'error');await juntoOnline.client.from('profiles').update({display_name:name,updated_at:new Date().toISOString()}).eq('id',juntoOnline.user.id);closeModal();toast('Enviamos a confirmação para seu e-mail.');return}
  if(event.target.id==='guest-password'){const password=String(form.get('guestPassword')||''),confirmation=String(form.get('guestPasswordConfirm')||'');if(password!==confirmation)return toast('As senhas não são iguais.','error');const {error}=await juntoOnline.client.auth.updateUser({password});if(error)return toast(authMessage(error,'Não foi possível concluir sua conta.'),'error');closeModal();toast('Conta concluída. Agora você pode acessar em outros aparelhos.');return}
  if(event.target.id==='online-login'){const email=String(form.get('onlineEmail')||'').trim().toLowerCase(),password=String(form.get('onlinePassword')||'');const {error}=await juntoOnline.client.auth.signInWithPassword({email,password});if(error)return toast(authMessage(error,'Não foi possível entrar agora.'),'error');closeModal();toast('Você entrou na sua conta.');return}
  if(event.target.id==='online-signup'){const name=String(form.get('onlineSignupName')||'').trim(),email=String(form.get('onlineSignupEmail')||'').trim().toLowerCase(),password=String(form.get('onlineSignupPassword')||'');const {data,error}=await juntoOnline.client.auth.signUp({email,password,options:{emailRedirectTo:authReturnUrl(),data:{display_name:name}}});if(error)return toast(authMessage(error,'Não foi possível criar a conta.'),'error');closeModal();hideWelcome(true);if(data.session)toast('Conta criada. Você já está conectado.');else toast('Conta criada. Confirme o e-mail para entrar.');return}
  if(event.target.id==='online-forgot'){const email=String(form.get('onlineForgotEmail')||'').trim().toLowerCase();const {error}=await juntoOnline.client.auth.resetPasswordForEmail(email,{redirectTo:authReturnUrl('recovery')});if(error)return toast(authMessage(error,'Não foi possível enviar a recuperação.'),'error');closeModal();toast('Enviamos o link de recuperação para seu e-mail.');return}
  if(event.target.id==='online-password-update'){const password=String(form.get('onlineNewPassword')||''),confirmation=String(form.get('onlineNewPasswordConfirm')||'');if(password!==confirmation)return toast('As senhas não são iguais.','error');const {error}=await juntoOnline.client.auth.updateUser({password});if(error)return toast(authMessage(error,'Não foi possível atualizar a senha.'),'error');closeModal();toast('Senha atualizada com sucesso.');return}
  const displayName=String(form.get('onlineName')||'').trim(),phone=String(form.get('onlinePhone')||'').trim()||null;const {data,error}=await juntoOnline.client.from('profiles').update({display_name:displayName,phone,updated_at:new Date().toISOString()}).eq('id',juntoOnline.user.id).select().single();if(error)return toast('Não foi possível atualizar o perfil.','error');juntoOnline.profile=data;closeModal();updateAccountButton();toast('Perfil atualizado.');
},true);

function refreshVisiblePlanningDirectory(){
  if(document.visibilityState==='hidden'||!juntoOnline.user||db.simplePage!=='viagens'||juntoOnline.participantTripId)return;
  void refreshPlanningDirectory();
}
window.addEventListener('focus',refreshVisiblePlanningDirectory);
window.addEventListener('online',refreshVisiblePlanningDirectory);
document.addEventListener('visibilitychange',refreshVisiblePlanningDirectory);

window.addEventListener('click',async event=>{
  const pastePhoto=event.target.closest('[data-directory-paste]');if(pastePhoto){event.preventDefault();event.stopImmediatePropagation();modal('Colar foto','Copie uma imagem e pressione Ctrl+V na área abaixo.',`<div tabindex="0" class="card" data-directory-paste-zone="${esc(pastePhoto.dataset.directoryPaste)}">Clique aqui e pressione Ctrl+V</div>`);document.querySelector('[data-directory-paste-zone]')?.focus();return}
  if(event.target.closest('[data-include-organizer]')){event.preventDefault();event.stopImmediatePropagation();if(!juntoOnline.user||juntoOnline.participantTripId||!activeOnlineLink())return;const next=cloneOnline(db);if(!includeOrganizerParticipant(next,db.active))return;db=next;syncSimplePeoplePlan();saveLocal();render();if(await syncTripSnapshotById(db.active))toast('Você está na lista de participantes e da caixinha.');return}
  const guestSection=event.target.closest('[data-guest-section]');if(guestSection){event.preventDefault();event.stopImmediatePropagation();document.querySelectorAll('[data-guest-section]').forEach(button=>button.classList.toggle('active',button===guestSection));closeMenu();document.getElementById(guestSection.dataset.guestSection)?.scrollIntoView({behavior:'smooth',block:'start'});return}
  if(event.target.closest('[data-refresh-planning-directory]')){event.preventDefault();event.stopImmediatePropagation();void refreshPlanningDirectory();return}
  if(event.target.closest('[data-simple-page="viagens"]')){event.preventDefault();event.stopImmediatePropagation();openPlanningDirectory()}
},true);

window.addEventListener('submit',event=>{
  if(['trip-create','trip-v4-create','trip-v5-create'].includes(event.target.id)){event.preventDefault();event.stopImmediatePropagation();toast('Use Novo planejamento para criar e salvar online.','error');return}
},true);

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>initializeOnlineAccount(),{once:true});else initializeOnlineAccount();
if(!onlineReady())showWelcome();
