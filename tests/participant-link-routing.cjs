const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),root=path.resolve(__dirname,'..'),errors=[];
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"><\/script>/g,(m,src)=>src.startsWith('http')?'':`<script>${fs.readFileSync(path.join(root,src.split('?')[0]),'utf8').replaceAll('</script','<\\/script')}</script>`);
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'https://junto-six-eta.vercel.app/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{}}});
const w=dom.window,run=source=>{const s=w.document.createElement('script');s.textContent=source;w.document.body.append(s);s.remove()},tick=()=>new Promise(r=>setTimeout(r,35));
(async()=>{await tick();run(`
 window.calls=[];window.copied='';window.accessStatus='open';window.token='a'.repeat(64);
 juntoOnline.user={id:'owner'};db.active='trip-local';db.trips=[{id:db.active,name:'Natal fixture'}];db.people=[{id:'person',trip:db.active,name:'Ricardo fixture'}];
 activeOnlineLink=()=>({tripId:'trip-remote'});syncTripSnapshotById=async()=>true;
 juntoOnline.client={rpc:async(name,args)=>{window.calls.push({name,args});return {data:name==='create_participant_access_link'?window.token:name==='preview_participant_access_link'?{status:window.accessStatus}:[]}}};
 Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copied=value}},configurable:true});
 participantInviteModal('person');`);
 w.document.querySelector('#existing-access-link .primary').click();await tick();await tick();
 assert(w.document.querySelector('#existingParticipantAccessUrl'),'Generating from the actual form must display the individual URL');
 const url=new URL(w.document.querySelector('#existingParticipantAccessUrl').value);assert.equal(url.searchParams.get('invite'),'access:'+w.token);assert(!url.searchParams.has('join'));
 w.document.querySelector('[data-copy-existing-access]').click();await tick();assert.equal(w.copied,url.toString(),'Copy must use the individual modal input');
 assert(!w.calls.some(c=>c.name==='create_trip_join_link'||c.name==='accept_trip_join_link'),'Individual path must never call general invitation endpoints');
 // Existing access can be resent without attempting to bind/create a new participant.
 run(`window.accessStatus='approved';participantInviteModal('person')`);w.document.querySelector('#existing-access-link .primary').click();await tick();await tick();assert(w.document.querySelector('.modal h2').textContent.includes('Reenviar'));
 run(`localStorage.setItem('junto_pending_join',window.token);localStorage.removeItem('junto_pending_invite');window.resolvePromise=resolvePendingIndividualAccess()`);await w.resolvePromise;
 assert.equal(w.localStorage.getItem('junto_pending_join'),null);assert.equal(w.localStorage.getItem('junto_pending_invite'),'access:'+w.token);
 // A valid general link is not reclassified when the access registry has no match.
 run(`window.accessStatus='invalid';localStorage.setItem('junto_pending_join','b'.repeat(64));localStorage.removeItem('junto_pending_invite');window.resolvePromise=resolvePendingIndividualAccess()`);await w.resolvePromise;assert.equal(w.localStorage.getItem('junto_pending_join'),'b'.repeat(64));
 await tick();assert.deepEqual(errors,[]);dom.window.close();console.log('PASS individual access: actual form submission, correct query type, clipboard, resend and legacy URL routing');
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
