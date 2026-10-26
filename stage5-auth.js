'use strict';

const initialAuthUrl=new URL(location.href),initialAuthHash=new URLSearchParams(location.hash.replace(/^#/,''));
const juntoOnline={client:null,user:null,profile:null,configured:false,syncTimer:null,syncing:false,syncQueued:false,restoring:false,restoredFor:null,recoveryPending:initialAuthUrl.searchParams.get('auth_action')==='recovery'||initialAuthUrl.searchParams.get('type')==='recovery'||initialAuthHash.get('type')==='recovery'};
const saveLocal=save;
const welcomeEl=document.querySelector('#welcome');
const tripScopedKeys=['people','payments','houses','expenses','families','fundYields','fundSnapshots','shoppingItems','consumptionGroups','roomPlans'];
const groupScopedKeys=['members','groupFamilies','relationships','peopleMapLayouts','roomPreferences'];

function onlineConfig(){return window.JUNTO_SUPABASE_CONFIG||{}}
function onlineReady(){const config=onlineConfig();return Boolean(config.url&&config.publishableKey&&window.supabase?.createClient)}
function pendingInvite(){return localStorage.getItem('junto_pending_invite')||''}
function authReturnUrl(action=''){const url=new URL(location.pathname,location.origin),token=pendingInvite();if(token)url.searchParams.set('invite',token);if(action)url.searchParams.set('auth_action',action);return url.toString()}
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
function onlineError(error,fallback){console.error(error);return error?.message?.includes('sync conflict')?'Esta viagem foi alterada em outro aparelho. Abra novamente a versão online antes de continuar.':fallback}
function showOnlineFailure(title,error,fallback){
  console.error(error);const message=error?.message||fallback,details=error?.details||error?.hint||'',code=error?.code||'';
  modal(title,'O Supabase devolveu os detalhes abaixo.',`<div class="stack"><div class="notice warn"><strong>${esc(message)}</strong>${details?`<p>${esc(details)}</p>`:''}${code?`<p>Código: <code>${esc(code)}</code></p>`:''}</div><p class="help">Essas informações ajudam a corrigir o problema. Você pode tirar um print desta janela e enviar.</p><div class="actions"><button type="button" class="button primary" data-close>Fechar</button></div></div>`);
}
function updateOnlineNote(){const note=document.querySelector('.side-note');if(!note)return;const linked=Boolean(juntoOnline.user&&activeOnlineLink());note.innerHTML=`<i></i> ${linked?'Viagem sincronizada online':juntoOnline.user?'Conta conectada · viagem ainda local':'Dados salvos somente neste navegador'}`}
function updateAccountButton(){document.querySelectorAll('[data-account]').forEach(button=>{button.classList.toggle('is-online',Boolean(juntoOnline.user));const label=button.querySelector('span');if(label)label.textContent=juntoOnline.user?(juntoOnline.profile?.display_name||juntoOnline.user.email||'Minha conta'):'Entrar'});updateOnlineNote()}
function showWelcome(){if(!welcomeEl||juntoOnline.user||sessionStorage.getItem('junto_welcome_skipped'))return;welcomeEl.hidden=false;document.body.classList.add('welcome-open');requestAnimationFrame(()=>welcomeEl.classList.add('is-visible'))}
function hideWelcome(remember=false){if(!welcomeEl)return;if(remember)sessionStorage.setItem('junto_welcome_skipped','1');welcomeEl.classList.remove('is-visible');document.body.classList.remove('welcome-open');setTimeout(()=>{welcomeEl.hidden=true},420)}
function tripBundleFor(localTripId){
  const current=(db.trips||[]).find(item=>item.id===localTripId);if(!current)return null;const groupId=current.groupId||db.activeGroupId,group=(db.groups||[]).find(item=>item.id===groupId)||{id:groupId,name:'Grupo da viagem',description:''},payload={schemaVersion:1,exportedAt:new Date().toISOString(),trip:cloneOnline(current),group:cloneOnline(group)};
  tripScopedKeys.forEach(key=>payload[key]=cloneOnline((db[key]||[]).filter(item=>item.trip===current.id)));
  groupScopedKeys.forEach(key=>payload[key]=cloneOnline((db[key]||[]).filter(item=>item.groupId===groupId)));
  payload.shoppingYear=db.shoppingYear||null;return payload;
}
function tripBundle(){return tripBundleFor(db.active)}
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
  if(!juntoOnline.user){authModal('login');return}
  const name=juntoOnline.profile?.display_name||'',phone=juntoOnline.profile?.phone||'',email=juntoOnline.user.email||'';
  modal('Minha conta','Conta online conectada.',`${tripOnlinePanel()}<form id="online-profile"><div class="stack">${field('onlineName','Nome de exibição','text',name,'required maxlength="100"')}${field('onlinePhone','Telefone (opcional)','tel',phone,'autocomplete="tel" maxlength="30" placeholder="(00) 00000-0000"')}${field('onlineAccountEmail','E-mail','email',email,'disabled')}<div class="account-connected"><i></i><span>Conta online ativa</span></div><button class="button primary">Salvar perfil</button><button type="button" class="button ghost" data-online-signout>Sair da conta</button></div></form>`)
}
function authModal(mode='login'){
  const hasInvite=Boolean(pendingInvite()),inviteNotice=hasInvite?'<div class="notice info">Seu convite está guardado. Após entrar, a viagem compartilhada será aberta automaticamente.</div>':'';
  if(mode==='signup'){
    modal('Criar conta','Use seu e-mail e escolha uma senha para entrar no Juntô.',`<form id="online-signup"><div class="stack">${field('onlineSignupName','Seu nome','text','','required maxlength="100" autocomplete="name"')}${field('onlineSignupEmail','Seu e-mail','email','','required autocomplete="email" placeholder="voce@exemplo.com"')}${field('onlineSignupPassword','Crie uma senha','password','','required minlength="6" autocomplete="new-password" placeholder="Mínimo de 6 caracteres"')}${inviteNotice}<button class="button primary">Criar minha conta</button><button type="button" class="button ghost" data-auth-mode="login">Já tenho conta</button></div></form>`);return;
  }
  if(mode==='forgot'){
    modal('Recuperar senha','Enviaremos um link para você escolher uma nova senha.',`<form id="online-forgot"><div class="stack">${field('onlineForgotEmail','Seu e-mail','email','','required autocomplete="email" placeholder="voce@exemplo.com"')}<button class="button primary">Enviar link de recuperação</button><button type="button" class="button ghost" data-auth-mode="login">Voltar para entrar</button></div></form>`);return;
  }
  modal('Entrar no Juntô','Acesse suas viagens próprias e compartilhadas.',`<form id="online-login"><div class="stack">${field('onlineEmail','Seu e-mail','email','','required autocomplete="email" placeholder="voce@exemplo.com"')}${field('onlinePassword','Sua senha','password','','required minlength="6" autocomplete="current-password"')}${inviteNotice}<button class="button primary">Entrar</button><button type="button" class="button secondary auth-google" data-google-login><span class="google-mark">G</span> Entrar com Google</button><div class="auth-links"><button type="button" data-auth-mode="signup">Criar uma conta</button><button type="button" data-auth-mode="forgot">Esqueci minha senha</button></div></div></form>`);
}
function passwordUpdateModal(){
  juntoOnline.recoveryPending=false;const url=new URL(location.href);url.searchParams.delete('auth_action');history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`);
  modal('Criar nova senha','Escolha a senha que será usada nos próximos acessos.',`<form id="online-password-update"><div class="stack">${field('onlineNewPassword','Nova senha','password','','required minlength="6" autocomplete="new-password"')}${field('onlineNewPasswordConfirm','Confirmar nova senha','password','','required minlength="6" autocomplete="new-password"')}<button class="button primary">Salvar nova senha</button></div></form>`);
}
async function loadOnlineProfile(){if(!juntoOnline.user)return;const {data,error}=await juntoOnline.client.from('profiles').select('id,display_name,phone,avatar_path,platform_owner').eq('id',juntoOnline.user.id).single();if(!error)juntoOnline.profile=data;updateAccountButton()}
async function importActiveTrip(){
  if(!juntoOnline.user)return accountModal();if(!trip())return toast('Crie ou selecione uma viagem primeiro.','error');
  if(!confirm(`Levar “${trip().name}” para sua conta online? Depois disso, as alterações desta viagem serão sincronizadas.`))return;
  const payload=tripBundle(),hash=await contentHash(payload),button=document.querySelector('[data-online-import]');if(button)button.disabled=true;
  const {data,error}=await juntoOnline.client.rpc('import_local_trip',{payload,content_hash:hash});
  if(error){if(button)button.disabled=false;showOnlineFailure('Não foi possível levar a viagem para a conta',error,'Falha desconhecida ao salvar a viagem.');return}
  persistOnlineLink(db.active,{tripId:data.trip_id,revision:Number(data.revision)||1});accountModal();toast('Viagem salva na sua conta e sincronização ativada.');
}
function scheduleOnlineSync(){clearTimeout(juntoOnline.syncTimer);const link=activeOnlineLink();if(!juntoOnline.user||!link||link.conflict)return;if(juntoOnline.syncing){juntoOnline.syncQueued=true;return}juntoOnline.syncTimer=setTimeout(syncActiveTrip,900)}
async function syncActiveTrip(){
  const link=activeOnlineLink();if(!juntoOnline.user||!link||link.conflict||juntoOnline.syncing)return;juntoOnline.syncing=true;juntoOnline.syncQueued=false;
  const {data,error}=await juntoOnline.client.rpc('sync_trip_snapshot',{target_trip:link.tripId,new_payload:tripBundle(),expected_revision:link.revision});juntoOnline.syncing=false;
  if(error){if(error.message?.includes('sync conflict')){link.conflict=true;saveLocal();toast(onlineError(error),'error')}else toast('Alteração salva neste navegador; a sincronização online será tentada novamente.','error');return}
  link.revision=Number(data);link.conflict=false;saveLocal();updateOnlineNote();if(juntoOnline.syncQueued)scheduleOnlineSync();
}
async function syncTripSnapshotById(localTripId){
  const link=onlineLinks()[localTripId],payload=tripBundleFor(localTripId);if(!juntoOnline.user||!link||!payload||link.conflict)return false;const {data,error}=await juntoOnline.client.rpc('sync_trip_snapshot',{target_trip:link.tripId,new_payload:payload,expected_revision:link.revision});if(error){if(error.message?.includes('sync conflict'))link.conflict=true;saveLocal();toast(onlineError(error,'Não foi possível sincronizar esta viagem.'),'error');return false}link.revision=Number(data);link.conflict=false;saveLocal();updateOnlineNote();return true;
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
function captureInvite(){const url=new URL(location.href),token=url.searchParams.get('invite');if(token){localStorage.setItem('junto_pending_invite',token);url.searchParams.delete('invite');history.replaceState({},'',`${url.pathname}${url.search}${url.hash}`)}}
async function acceptPendingInvite(){
  const token=localStorage.getItem('junto_pending_invite');if(!token||!juntoOnline.user)return false;const {data,error}=await juntoOnline.client.rpc('accept_trip_invite',{raw_token:token});
  if(error){localStorage.removeItem('junto_pending_invite');history.replaceState({},'',location.pathname);toast('Este convite é inválido, expirou ou já foi usado.','error');return false}
  localStorage.removeItem('junto_pending_invite');history.replaceState({},'',location.pathname);await loadOnlineTrip(data.trip_id);toast('Convite aceito. Você agora administra esta viagem.');return true;
}
async function restoreOnlineTrips(){
  const userId=juntoOnline.user?.id;if(!userId||juntoOnline.restoring||juntoOnline.restoredFor===userId)return;
  juntoOnline.restoring=true;const {data,error}=await juntoOnline.client.from('trip_snapshots').select('trip_id,payload,revision,updated_at').order('updated_at',{ascending:false});juntoOnline.restoring=false;juntoOnline.restoredFor=userId;
  if(error){console.error(error);toast('Você entrou, mas não foi possível carregar suas viagens online.','error');return}
  const currentLink=activeOnlineLink(),currentOnline=currentLink&&(data||[]).find(item=>item.trip_id===currentLink.tripId);if(currentOnline){if(Number(currentOnline.revision)>Number(currentLink.revision||0)){try{mergeOnlineBundle(currentOnline.payload,currentOnline.trip_id,currentOnline.revision);toast('A viagem foi atualizada com as alterações compartilhadas.')}catch(loadError){console.error(loadError);toast('A atualização online desta viagem é incompatível.','error')}}return}
  if(data?.length===1){const item=data[0];try{mergeOnlineBundle(item.payload,item.trip_id,item.revision);toast('Sua viagem online foi carregada.')}catch(loadError){console.error(loadError);toast('A viagem online encontrada é incompatível.','error')}return}
  if(data?.length>1)onlineTripsModal();
  if(!data?.length)toast('Conta conectada, mas nenhuma viagem online foi encontrada.','error');
}
async function resumeAuthenticatedAccount(){
  await loadOnlineProfile();if(juntoOnline.recoveryPending){passwordUpdateModal();return}if(await acceptPendingInvite())return;await restoreOnlineTrips();
}
async function initializeOnlineAccount(){
  captureInvite();juntoOnline.configured=onlineReady();if(!juntoOnline.configured){updateAccountButton();return}
  const config=onlineConfig();juntoOnline.client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});const {data}=await juntoOnline.client.auth.getSession();juntoOnline.user=data.session?.user||null;
  if(juntoOnline.user){hideWelcome();await resumeAuthenticatedAccount()}else{updateAccountButton();if(localStorage.getItem('junto_pending_invite'))setTimeout(accountModal,350);else showWelcome()}
  juntoOnline.client.auth.onAuthStateChange((authEvent,session)=>{juntoOnline.user=session?.user||null;juntoOnline.profile=null;if(authEvent==='PASSWORD_RECOVERY')juntoOnline.recoveryPending=true;if(juntoOnline.user){hideWelcome();setTimeout(resumeAuthenticatedAccount,0)}else{juntoOnline.restoredFor=null;updateAccountButton()}});
}

document.addEventListener('click',async event=>{
  const welcomeAuth=event.target.closest('[data-welcome-auth]');if(welcomeAuth){if(!juntoOnline.configured)return accountModal();authModal(welcomeAuth.dataset.welcomeAuth);return}
  if(event.target.closest('[data-welcome-demo]')){hideWelcome(true);document.querySelector('#app')?.focus({preventScroll:true});return}
  if(event.target.closest('[data-account]')){accountModal();return}if(event.target.closest('[data-online-signout]')){await juntoOnline.client?.auth.signOut();closeModal();toast('Você saiu da conta. O modo local continua disponível.');return}
  const authMode=event.target.closest('[data-auth-mode]');if(authMode){authModal(authMode.dataset.authMode);return}
  if(event.target.closest('[data-google-login]')){const {error}=await juntoOnline.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:authReturnUrl()}});if(error)toast(authMessage(error,'Não foi possível entrar com o Google.'),'error');return}
  if(event.target.closest('[data-online-import]')){await importActiveTrip();return}if(event.target.closest('[data-admin-invite]')){await createAdminInvite();return}if(event.target.closest('[data-online-trips]')){await onlineTripsModal();return}
  const open=event.target.closest('[data-open-online-trip]');if(open){await loadOnlineTrip(open.dataset.openOnlineTrip);return}
  if(event.target.closest('[data-copy-admin-invite]')){const input=document.querySelector('#adminInviteUrl'),value=input?.value;try{await navigator.clipboard.writeText(value);toast('Link copiado.')}catch{input?.select();toast('Selecione e copie o link.')}return}
},true);
document.addEventListener('submit',async event=>{
  if(!['online-login','online-signup','online-forgot','online-password-update','online-profile'].includes(event.target.id))return;event.preventDefault();event.stopImmediatePropagation();const form=new FormData(event.target);
  if(event.target.id==='online-login'){const email=String(form.get('onlineEmail')||'').trim().toLowerCase(),password=String(form.get('onlinePassword')||'');const {error}=await juntoOnline.client.auth.signInWithPassword({email,password});if(error)return toast(authMessage(error,'Não foi possível entrar agora.'),'error');closeModal();toast('Você entrou na sua conta.');return}
  if(event.target.id==='online-signup'){const name=String(form.get('onlineSignupName')||'').trim(),email=String(form.get('onlineSignupEmail')||'').trim().toLowerCase(),password=String(form.get('onlineSignupPassword')||'');const {data,error}=await juntoOnline.client.auth.signUp({email,password,options:{emailRedirectTo:authReturnUrl(),data:{display_name:name}}});if(error)return toast(authMessage(error,'Não foi possível criar a conta.'),'error');closeModal();hideWelcome(true);if(data.session)toast('Conta criada. Você já está conectado.');else toast('Conta criada. Confirme o e-mail para entrar.');return}
  if(event.target.id==='online-forgot'){const email=String(form.get('onlineForgotEmail')||'').trim().toLowerCase();const {error}=await juntoOnline.client.auth.resetPasswordForEmail(email,{redirectTo:authReturnUrl('recovery')});if(error)return toast(authMessage(error,'Não foi possível enviar a recuperação.'),'error');closeModal();toast('Enviamos o link de recuperação para seu e-mail.');return}
  if(event.target.id==='online-password-update'){const password=String(form.get('onlineNewPassword')||''),confirmation=String(form.get('onlineNewPasswordConfirm')||'');if(password!==confirmation)return toast('As senhas não são iguais.','error');const {error}=await juntoOnline.client.auth.updateUser({password});if(error)return toast(authMessage(error,'Não foi possível atualizar a senha.'),'error');closeModal();toast('Senha atualizada com sucesso.');return}
  const displayName=String(form.get('onlineName')||'').trim(),phone=String(form.get('onlinePhone')||'').trim()||null;const {data,error}=await juntoOnline.client.from('profiles').update({display_name:displayName,phone,updated_at:new Date().toISOString()}).eq('id',juntoOnline.user.id).select().single();if(error)return toast('Não foi possível atualizar o perfil.','error');juntoOnline.profile=data;closeModal();updateAccountButton();toast('Perfil atualizado.');
},true);

initializeOnlineAccount();
if(!onlineReady())showWelcome();
