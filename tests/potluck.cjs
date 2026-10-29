const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),root=path.resolve(__dirname,'..'),errors=[];
let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"><\/script>/g,(m,src)=>src.startsWith('http')?'':`<script>${fs.readFileSync(path.join(root,src.split('?')[0]),'utf8').replaceAll('</script','<\\/script')}</script>`);
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'https://junto-six-eta.vercel.app/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{}}});
const w=dom.window,run=source=>{const s=w.document.createElement('script');s.textContent=source;w.document.body.append(s);s.remove()},tick=()=>new Promise(r=>setTimeout(r,35));
(async()=>{await tick();run(`
 window.calls=[];window.fixture={organizer:true,can_choose:true,mode:'potluck',allow_extras:true,revision:1,items:[{id:'dish',name:'Salpicão',category:'Acompanhamentos',quantity:2,unit:'travessas',note:'Serve 8 pessoas',from_list:true,claims:[]}]};
 juntoOnline.user={id:'owner'};juntoOnline.participantTripId='remote';purchaseTripId=()=>juntoOnline.participantTripId;
 juntoOnline.client={rpc:async(name,args)=>{window.calls.push({name,args});if(name==='get_event_potluck')return {data:structuredClone(window.fixture)};if(name==='change_event_potluck'){if(args.action==='settings'){window.fixture.allow_extras=args.body.allow_extras;window.fixture.mode=args.body.mode}if(args.action==='item')window.fixture.items.push({...args.body,id:'added-item',from_list:true,claims:[]});if(args.action==='claim')window.fixture.items[0].claims=[{id:'claim',own:true,label:args.body.label||'Pessoa',quantity:Number(args.body.quantity),scope:args.body.scope,delivered:false}];if(args.action==='unclaim')window.fixture.items[0].claims=[];window.fixture.revision++;return {data:structuredClone(window.fixture)}}return {data:[]}}};
 document.querySelector('#app').innerHTML='<div class="participant-portal"></div>';window.refresh=decoratePotluck(true);`);await w.refresh;
 assert(w.document.querySelector('[data-potluck-extra]'));assert(w.document.querySelector('[data-potluck-add]'));assert(w.document.querySelector('[data-potluck-choose="dish"]'));
 w.document.querySelector('[data-potluck-choose]').click();await tick();w.document.querySelector('[name=quantity]').value='1';w.document.querySelector('[name=scope]').value='family';w.document.querySelector('[name=label]').value='Casal teste';w.document.querySelector('#potluck-form .primary').click();await tick();
 const claim=w.calls.find(c=>c.args?.action==='claim');assert.equal(claim.args.body.scope,'family');assert.equal(claim.args.expected_revision,1);assert(w.document.querySelector('.potluck-mine').textContent.includes('Casal teste'));assert(w.document.querySelector('.potluck-pill').textContent.includes('Faltam 1'));
 // Refresh reconstructs the choice from server, not cached DOM.
 run('potluckState=null;window.refresh=decoratePotluck(true)');await w.refresh;assert(w.document.querySelector('.potluck-mine').textContent.includes('Salpicão'));
 w.document.querySelector('[data-potluck-settings]').click();await tick();w.document.querySelector('[name=potluckAllowExtras]').checked=false;w.document.querySelector('#potluck-form .primary').click();await tick();assert(!w.document.querySelector('[data-potluck-extra]'));
 run(`window.fixture.organizer=false;potluckState=null;window.refresh=decoratePotluck(true)`);await w.refresh;assert(!w.document.querySelector('[data-potluck-settings]'));assert(!w.document.querySelector('[data-potluck-edit]'));assert(w.document.querySelector('[data-potluck-unclaim]'));
 w.document.querySelector('[data-potluck-unclaim]').click();await tick();assert(w.document.querySelector('.potluck-mine').textContent.includes('ainda não escolheu'));
 run(`window.fixture.items=[];window.fixture.allow_extras=true;window.refresh=decoratePotluck(true)`);await w.refresh;assert(w.document.querySelector('[data-potluck-extra]'));assert(w.document.querySelector('#event-potluck').textContent.includes('lista está aberta'));
 w.document.querySelector('[data-potluck-extra]').click();await tick();assert(w.document.querySelector('#potluck-form [name=name]'));
 // Adding a list item includes a hidden field named id: it must not mask the form identifier.
 run(`closeModal();window.fixture.organizer=true;window.fixture.mode='mixed';window.refresh=decoratePotluck(true)`);await w.refresh;
 w.document.querySelector('[data-potluck-add]').click();await tick();
 Object.defineProperty(w.document.querySelector('#potluck-form'),'id',{value:w.document.querySelector('#potluck-form [name=id]'),configurable:true});
 w.document.querySelector('#potluck-form [name=name]').value='Arroz de Natal';
 w.document.querySelector('#potluck-form [name=quantity]').value='2';
 w.document.querySelector('#potluck-form [name=unit]').value='travessas';
 w.document.querySelector('#potluck-form .primary').click();await tick();
 assert(w.calls.some(c=>c.name==='change_event_potluck'&&c.args.action==='item'&&c.args.body.name==='Arroz de Natal'),'Save must reach the server even with hidden name=id');
 assert(!w.document.querySelector('#potluck-form'),'Successful save must close the modal');
 assert(w.document.querySelector('.potluck-grid').textContent.includes('Arroz de Natal'));
 // Creation preferences survive state-building and travel creation remains untouched.
 run(`quickMeta={type:'event',extras:{potluckMode:'mixed',potluckAllowExtras:false,mode:'later',pix:'',dueDay:'',start:'',end:'',multi:false,useOpening:false}};window.creationMarkup=creationDetails();window.state={trips:[{id:'new',eventType:'event'}],people:[]};applyCreationSettings(window.state,'new');`);
 assert(w.creationMarkup.includes('name="potluckMode"'));assert.equal(w.state.trips[0].potluckMode,'mixed');assert.equal(w.state.trips[0].potluckAllowExtras,false);
 run(`quickMeta.type='trip';window.travelMarkup=creationDetails()`);assert(!w.travelMarkup.includes('name="potluckMode"'));
 assert(!w.calls.some(c=>/payment|sync_trip|shopping_purchase/.test(c.name)),'Food choices must not mutate financial or shopping records');
 await tick();assert.deepEqual(errors,[]);dom.window.close();console.log('PASS potluck UI: policies, family choice, refresh, permissions, creation, no finance mutation');
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
