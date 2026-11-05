const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'event-invitations.js'),'utf8'),authSource=fs.readFileSync(path.join(root,'stage5-auth.js'),'utf8');
const start=source.indexOf('async function authenticateForInvitation('),end=source.indexOf('const authBeforeGeneralInvitation',start);
const factory=new Function('juntoOnline','generalInvitation','pendingJoin','localStorage','authModal','isolateAccountWorkspace','showAuthFeedback','authMessage',source.slice(start,end)+';return authenticateForInvitation;');
(async()=>{
 for(const scenario of [{name:'visitor',user:null},{name:'temporary guest',user:{id:'temporary',is_anonymous:true}},{name:'logout error',user:{id:'temporary',is_anonymous:true},fail:true}]){
  const storage=new Map(),calls=[],state={user:scenario.user,client:{auth:{signOut:async arg=>{calls.push(['signOut',arg]);return scenario.fail?{error:{message:'Network error'}}:{}}}}};
  const authenticate=factory(state,{token:'test-token'},()=> 'test-token',{setItem:(k,v)=>storage.set(k,v)},mode=>calls.push(['authModal',mode]),()=>{calls.push(['isolate']);storage.clear()},message=>calls.push(['feedback',message]),error=>error.message);
  await authenticate('maybe');
  assert(calls.some(item=>item[0]==='authModal'&&item[1]==='login'),scenario.name+': normal login required');
  if(!scenario.fail)assert.equal(JSON.parse(storage.get('junto_join_intent')).answer,'maybe');
  if(scenario.user&&!scenario.fail){assert.equal(state.user,null);assert.equal(calls.find(item=>item[0]==='signOut')[1].scope,'local');assert.equal(storage.get('junto_pending_join'),'test-token')}
  if(scenario.fail)assert(calls.some(item=>item[0]==='feedback'));
 }
 assert(!source.slice(start,end).includes('guest-upgrade'));
 assert(authSource.includes('Continuar com Google'));
 const feedbackStart=authSource.indexOf('function showAuthFeedback('),feedbackEnd=authSource.indexOf('function authModal(',feedbackStart);
 let feedback=null,toastUsed=false;
 const form={querySelector:()=>feedback,prepend:node=>{feedback=node}};
 const document={querySelector:()=>form,createElement:()=>({dataset:{},setAttribute(k,v){this[k]=v},scrollIntoView(){},focus(){this.focused=true}})};
 const showFeedback=new Function('document','toast',authSource.slice(feedbackStart,feedbackEnd)+';return showAuthFeedback;')(document,()=>{toastUsed=true});
 showFeedback('Não foi possível entrar');
 assert.equal(feedback.textContent,'Não foi possível entrar');assert.equal(feedback.role,'alert');assert(feedback.focused);assert(!toastUsed);
 console.log('PASS normal login for visitors and temporary guests, local-only signout, preserved invitation intent, visible in-form errors');
})().catch(error=>{console.error(error);process.exitCode=1});
