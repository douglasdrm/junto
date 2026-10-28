const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace(/<script src="([^"]+)"><\/script>/g,(match,src)=>src.startsWith('http')?'':`<script>${fs.readFileSync(path.join(root,src.split('?')[0]),'utf8').replaceAll('</script','<\\/script')}</script>`);
const errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'https://junto-six-eta.vercel.app/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{}}});
const w=dom.window;
function run(source){const script=w.document.createElement('script');script.textContent=source;w.document.body.append(script);script.remove()}
setTimeout(async()=>{try{
 assert.deepEqual(errors,[]);
 run(`juntoOnline.user={id:'account-a',email:'a@example.com'};isolateAccountWorkspace('account-a');db.trips=[{id:'private-a',name:'PRIVATE ACCOUNT A',groupId:'g-a',demo:false}];db.groups=[{id:'g-a',name:'PRIVATE GROUP A'}];db.people=[{id:'p-a',trip:'private-a',name:'PRIVATE PERSON A'}];db.active='private-a';db.onlineTrips={'private-a':{tripId:'remote-a',revision:1}};db.accountOwnerId='account-a';saveLocal();`);
 run(`juntoOnline.user={id:'account-b',email:'b@example.com'};isolateAccountWorkspace('account-b');window.afterSwitch={trips:db.trips.length,people:db.people.length,groups:db.groups.length,active:db.active,owner:db.accountOwnerId};`);
 assert.equal(w.afterSwitch.trips,0);assert.equal(w.afterSwitch.people,0);assert.equal(w.afterSwitch.groups,0);assert.equal(w.afterSwitch.active,'');assert.equal(w.afterSwitch.owner,'account-b');
 assert(!w.document.querySelector('#app').textContent.includes('PRIVATE ACCOUNT A'));
 assert(w.localStorage.getItem('junto_account_recovery:account-a').includes('PRIVATE ACCOUNT A'));
 run(`db.trips=[{id:'private-b',name:'PRIVATE ACCOUNT B',demo:false}];db.accountOwnerId='account-b';juntoOnline.user=null;isolateAccountWorkspace(null);window.logoutTripCount=db.trips.length;`);
 assert.equal(w.logoutTripCount,0);assert(!w.document.querySelector('#app').textContent.includes('PRIVATE ACCOUNT B'));
 run(`juntoOnline.user={id:'account-a',email:'a@example.com'};isolateAccountWorkspace('account-a');window.returnTripCount=db.trips.length;`);
 assert.equal(w.returnTripCount,0,'Cached trips must be authorized by the server before being shown again');
 run(`window.lateProfileResolve=null;juntoOnline.client={from:()=>({select:()=>({eq:()=>({single:()=>new Promise(resolve=>window.lateProfileResolve=resolve)})})})};window.profilePromise=loadOnlineProfile();`);
 run(`juntoOnline.user={id:'account-b',email:'b@example.com'};isolateAccountWorkspace('account-b');window.lateProfileResolve({data:{id:'account-a',display_name:'PRIVATE NAME A'}});`);
 await w.profilePromise;run(`window.profileAfterSwitch=juntoOnline.profile;`);assert.equal(w.profileAfterSwitch,null);
 assert.deepEqual(errors,[]);
 console.log('PASS: account switching and logout clear private state; recovery copies stay isolated; delayed profile responses cannot cross accounts.');
}catch(error){console.error(error,errors);process.exitCode=1}finally{dom.window.close()}},100);
