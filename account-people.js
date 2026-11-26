'use strict';
/* Grupos da conta: grupos, pessoas, Turmas, vínculos, mapa e preferências de quarto ficam salvos na conta
   (RPCs get/save_account_people_workspace), não só dentro do snapshot de cada planejamento.

   - Ao entrar: carrega o que está salvo; na primeira vez, o servidor manda os grupos dos planejamentos
     próprios para inicializar. O que está salvo na conta vale para os grupos dela.
   - A cada alteração (save): envia os grupos locais, com revisão. O servidor descarta grupos que só
     existem em planejamentos de outras pessoas (o coadministrador não leva o grupo do dono para a conta dele).
   - Ao abrir um planejamento: o snapshot pode estar mais antigo que a conta. Para os grupos da conta, os
     dados locais continuam valendo (pessoas são unidas, para não perder quem foi incluído pelo planejamento),
     e o snapshot é atualizado na próxima sincronização.
   - Se as funções ainda não existirem no banco, nada muda: o app continua como antes. */

const ACCOUNT_PEOPLE_KEYS=['members','groupFamilies','relationships','peopleMapLayouts','roomPreferences'];
const accountPeople={userId:null,loaded:false,loading:null,revision:0,mine:new Set(),lastSent:'',timer:null,saving:false,again:false};

function accountPeopleEligible(){
  return Boolean(juntoOnline.client&&juntoOnline.user&&!juntoOnline.user.is_anonymous&&!juntoOnline.participantTripId);
}

function resetAccountPeople(){
  clearTimeout(accountPeople.timer);
  Object.assign(accountPeople,{userId:null,loaded:false,loading:null,revision:0,mine:new Set(),lastSent:'',timer:null,saving:false,again:false});
}

function accountPeopleClone(value){return value==null?value:JSON.parse(JSON.stringify(value))}

function mergeRecordsById(current,incoming,overwrite){
  const map=new Map((current||[]).filter(item=>item&&item.id).map(item=>[item.id,item]));
  (incoming||[]).forEach(item=>{if(item&&item.id&&(overwrite||!map.has(item.id)))map.set(item.id,accountPeopleClone(item))});
  return [...map.values()];
}

// peopleMapLayouts não tem id: uma entrada por groupId.
function recordsOfGroup(key,groupId){return (db[key]||[]).filter(item=>item&&item.groupId===groupId)}

function accountPeoplePayload(){
  const groups=(db.groups||[]).filter(group=>group&&group.id&&!group.demo),ids=new Set(groups.map(group=>group.id));
  const payload={schemaVersion:1,groups:accountPeopleClone(groups)};
  ACCOUNT_PEOPLE_KEYS.forEach(key=>{payload[key]=accountPeopleClone((db[key]||[]).filter(item=>item&&ids.has(item.groupId)))});
  return payload;
}

function applyAccountPeople(result){
  const stored=result?.payload&&typeof result.payload==='object'?result.payload:null;
  const storedIds=new Set((stored?.groups||[]).map(group=>group?.id).filter(Boolean));
  // Grupos de planejamentos próprios que ainda não estão na conta: somam, sem substituir nada local.
  (result?.owned_trip_groups||[]).forEach(bundle=>{
    const group=bundle?.group;if(!group?.id||storedIds.has(group.id))return;
    db.groups=mergeRecordsById(db.groups,[group],false);
    ACCOUNT_PEOPLE_KEYS.forEach(key=>{
      if(key==='peopleMapLayouts'){if(!recordsOfGroup(key,group.id).length)db[key]=(db[key]||[]).concat(accountPeopleClone(bundle[key]||[]));return}
      db[key]=mergeRecordsById(db[key],bundle[key],false);
    });
    accountPeople.mine.add(group.id);
  });
  // O que está salvo na conta vale para os grupos dela (inclusive vínculos removidos em outro aparelho).
  if(stored){
    db.groups=mergeRecordsById(db.groups,stored.groups,true);
    ACCOUNT_PEOPLE_KEYS.forEach(key=>{
      if(key==='members'){db.members=mergeRecordsById(db.members,stored.members,true);return}
      db[key]=(db[key]||[]).filter(item=>!storedIds.has(item?.groupId)).concat(accountPeopleClone(stored[key]||[]));
    });
    storedIds.forEach(id=>accountPeople.mine.add(id));
  }
  if(!db.activeGroupId||!(db.groups||[]).some(group=>group.id===db.activeGroupId))db.activeGroupId=(db.groups||[]).find(group=>accountPeople.mine.has(group.id))?.id||db.groups?.[0]?.id||'';
  if(typeof normalizeFamilyLinks==='function')normalizeFamilyLinks(db);
}

async function loadAccountPeople(force=false){
  if(!accountPeopleEligible())return false;
  const userId=juntoOnline.user.id;
  if(!force&&accountPeople.loaded&&accountPeople.userId===userId)return true;
  if(accountPeople.loading&&accountPeople.userId===userId)return accountPeople.loading;
  accountPeople.userId=userId;
  accountPeople.loading=(async()=>{
    const {data,error}=await juntoOnline.client.rpc('get_account_people_workspace');
    if(juntoOnline.user?.id!==userId)return false;
    if(error){console.warn('Grupos da conta indisponíveis:',error.message||error);return false}
    accountPeople.revision=Number(data?.revision)||0;
    applyAccountPeople(data);
    accountPeople.loaded=true;
    saveLocal();render();
    queueAccountPeopleSave(0);
    return true;
  })();
  try{return await accountPeople.loading}finally{accountPeople.loading=null}
}

function queueAccountPeopleSave(delay=1200){
  if(!accountPeople.loaded||!accountPeopleEligible()||accountPeople.userId!==juntoOnline.user.id)return;
  clearTimeout(accountPeople.timer);
  accountPeople.timer=setTimeout(()=>{void flushAccountPeople()},delay);
}

async function flushAccountPeople(){
  if(!accountPeople.loaded||!accountPeopleEligible())return false;
  if(accountPeople.saving){accountPeople.again=true;return false}
  const payload=accountPeoplePayload(),text=JSON.stringify(payload);
  if(text===accountPeople.lastSent)return true;
  const userId=juntoOnline.user.id;accountPeople.saving=true;
  try{
    const {data,error}=await juntoOnline.client.rpc('save_account_people_workspace',{new_payload:payload,expected_revision:accountPeople.revision});
    if(juntoOnline.user?.id!==userId)return false;
    if(error){
      if(error.code==='40001'||/revision conflict/i.test(error.message||'')){
        accountPeople.loaded=false;accountPeople.mine.clear();
        await loadAccountPeople(true);
        toast('Seus grupos foram alterados em outro aparelho. Carregamos a versão mais recente.','error');
      }else{console.warn('Não foi possível salvar os grupos da conta:',error.message||error)}
      return false;
    }
    accountPeople.revision=Number(data?.revision)||accountPeople.revision+1;
    accountPeople.lastSent=text;
    (data?.payload?.groups||[]).forEach(group=>group?.id&&accountPeople.mine.add(group.id));
    return true;
  }finally{
    accountPeople.saving=false;
    if(accountPeople.again){accountPeople.again=false;queueAccountPeopleSave(300)}
  }
}

const saveBeforeAccountPeople=save;
save=function(...args){const result=saveBeforeAccountPeople(...args);queueAccountPeopleSave();return result};

const restoreBeforeAccountPeople=restoreOnlineTrips;
restoreOnlineTrips=async function(...args){const result=await restoreBeforeAccountPeople(...args);await loadAccountPeople();return result};

const isolateBeforeAccountPeople=isolateAccountWorkspace;
isolateAccountWorkspace=function(accountId,...rest){
  if((accountId||null)!==accountPeople.userId)resetAccountPeople();
  return isolateBeforeAccountPeople(accountId,...rest);
};

const mergeBeforeAccountPeople=mergeOnlineBundle;
mergeOnlineBundle=function(payload,...rest){
  const groupId=payload?.group?.id||payload?.trip?.groupId;
  const keep=accountPeople.loaded&&groupId&&accountPeople.mine.has(groupId)&&(db.groups||[]).some(group=>group.id===groupId);
  const before=keep?{group:accountPeopleClone((db.groups||[]).find(group=>group.id===groupId)),...Object.fromEntries(ACCOUNT_PEOPLE_KEYS.map(key=>[key,accountPeopleClone(recordsOfGroup(key,groupId))]))}:null;
  const result=mergeBeforeAccountPeople(payload,...rest);
  if(before){
    const snapshotText=JSON.stringify(ACCOUNT_PEOPLE_KEYS.map(key=>recordsOfGroup(key,groupId)));
    db.groups=(db.groups||[]).filter(group=>group.id!==groupId).concat(before.group);
    ACCOUNT_PEOPLE_KEYS.forEach(key=>{
      const fromSnapshot=recordsOfGroup(key,groupId),others=(db[key]||[]).filter(item=>item?.groupId!==groupId);
      db[key]=others.concat(key==='members'?mergeRecordsById(fromSnapshot,before.members,true):before[key]);
    });
    if(JSON.stringify(ACCOUNT_PEOPLE_KEYS.map(key=>recordsOfGroup(key,groupId)))!==snapshotText){
      saveLocal();render();
      if(typeof scheduleOnlineSync==='function')scheduleOnlineSync();
    }
  }
  return result;
};

if(juntoOnline.user&&!juntoOnline.user.is_anonymous)void loadAccountPeople();
