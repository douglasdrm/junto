const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),root=path.resolve(__dirname,'..'),errors=[];
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"(?: defer)?><\/script>/g,(m,src)=>src.startsWith('http')?'':`<script>${fs.readFileSync(path.join(root,src.split('?')[0]),'utf8').replaceAll('</script','<\\/script')}</script>`);
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'https://junto.unodev.com.br/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{}}});
const w=dom.window,run=source=>w.eval(source),tick=()=>new Promise(r=>setTimeout(r,50));
(async()=>{await tick();run(`
window.calls=[];window.participantOpened=null;window.answers=[];window.token='a'.repeat(64);
juntoOnline.user=null;localStorage.setItem('junto_pending_join',window.token);
juntoOnline.client={rpc:async(name,args)=>{window.calls.push({name,args});return {data:name==='preview_event_invitation'?{status:'available',name:'Natal de teste',kind:'Evento',date:'2026-12-24',region:'Rio',participant_count:2,participant_initials:['D','R'],cover_image:'https://example.com/cover.jpg',can_respond:true}:name==='respond_event_invitation'?{trip_id:'remote',response:args.answer==='remember'?'pending':args.answer}:[]}}};
loadOnlineProfile=async()=>{};showParticipantTrip=async id=>{window.participantOpened=id};openPlanningDirectory=()=>{window.directoryOpened=true};
window.testPromise=showGeneralInviteWelcome();`);await w.testPromise;
assert(w.document.querySelector('.invitation-event-title h3').textContent.includes('Natal de teste'));
assert(w.document.querySelector('.invitation-event-hero img'));assert(w.document.querySelector('.invitation-people').textContent.includes('2 participantes confirmados'));
w.document.querySelector('[data-preview-general-invitation]').click();assert(w.document.querySelector('[data-event-invitation-answer="accepted"]'));
assert(!w.calls.some(c=>c.name==='respond_event_invitation'),'Preview must not create membership or response for a guest');
w.document.querySelector('[data-event-invitation-answer="maybe"]').click();assert(w.document.querySelector('#online-login'),'Guest response must require login');
assert.equal(JSON.parse(w.localStorage.getItem('junto_join_intent')).answer,'maybe');
run(`juntoOnline.user={id:'account-a',is_anonymous:false};window.testPromise=joinTripModal()`);await w.testPromise;
assert(w.calls.some(c=>c.name==='respond_event_invitation'&&c.args.answer==='maybe'));assert.equal(w.participantOpened,null,'Maybe cannot open private participant view');assert.equal(w.localStorage.getItem('junto_pending_join'),null);
run(`window.testPromise=showGeneralInviteWelcome('saved-invite')`);await w.testPromise;
w.document.querySelector('[data-event-invitation-answer="accepted"]').click();assert(w.document.querySelector('#join-trip'));
run(`window.testPromise=acceptPendingJoin('Pessoa teste','')`);await w.testPromise;
assert.equal(w.participantOpened,'remote');const acceptance=w.calls.find(c=>c.name==='respond_event_invitation'&&c.args.answer==='accepted');assert.equal(acceptance.args.saved_id,'saved-invite');assert.equal(acceptance.args.raw_token,null);
// Failed preview cannot leave a previously valid invitation in memory.
run(`juntoOnline.client.rpc=async()=>({data:{status:'invalid'}});window.testPromise=showGeneralInviteWelcome('invalid')`);await w.testPromise;
run(`window.testPromise=acceptPendingJoin('Pessoa teste','')`);assert.equal(await w.testPromise,false);
assert.deepEqual(errors,[]);dom.window.close();console.log('PASS general invitations: public preview, mandatory account, maybe saved without participation, saved invite acceptance, stale context rejection');
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
