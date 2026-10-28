'use strict';
let workspaceAccountId=null;
function isolateAccountWorkspace(accountId,initial=false){
 const nextId=accountId||null;
 if(!initial&&workspaceAccountId===nextId&&db.accountOwnerId===nextId){document.body.classList.remove('account-check');return}
 const previous=workspaceAccountId||db.accountOwnerId;
 if((db.trips||[]).some(item=>!item.demo)){
  // Retain a recovery copy without ever showing it to a different account.
  try{localStorage.setItem(previous?`junto_account_recovery:${previous}`:'junto_unassigned_recovery',JSON.stringify(db))}catch{}
 }
 clearTimeout(juntoOnline.syncTimer);juntoOnline.syncTimer=null;juntoOnline.syncQueued=false;
 let clean=migrate(clone(EMPTY));
 for(const migration of [globalThis.migrateV3,globalThis.migrateV4,globalThis.migrateV5,globalThis.migrateV7,globalThis.migrateV8])if(typeof migration==='function')clean=migration(clean);
 clean.accountOwnerId=nextId;clean.active='';clean.activeGroupId='';clean.simplePage='viagens';clean.legacyPage='';clean.onlineTrips={};
 db=clean;workspaceAccountId=nextId;
 juntoOnline.restoring=false;juntoOnline.restoredFor=null;juntoOnline.participantTripId=null;juntoOnline.profile=null;
 Object.assign(planningDirectory,{userId:nextId,items:[],loaded:false,loading:false,error:''});
 if(typeof visualDetailsCache!=='undefined')visualDetailsCache.clear();
 if(typeof avatarUrlCache!=='undefined')avatarUrlCache.clear();
 if(typeof purchaseWorkspace!=='undefined'){purchaseWorkspace=null;purchaseWorkspaceKey='';purchaseWorkspaceLoading=null}
 if(typeof mapSelection!=='undefined')mapSelection.clear();
 closeModal();document.body.classList.remove('participant-online-view');saveLocal();render();document.body.classList.remove('account-check');
}
if(onlineReady())isolateAccountWorkspace(null,true);else document.body.classList.remove('account-check');
