// Grupos da conta: carregar sem planejamento aberto, salvar com revisão, conflito e snapshot antigo.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"(?: defer)?><\/script>/g,(m,src)=>src.startsWith('http')?'':`<script>${fs.readFileSync(path.join(root,src.split('?')[0]),'utf8').replaceAll('</script','<\\/script')}</script>`);
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'https://junto.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
}});
const w=dom.window,tick=(ms=30)=>new Promise(r=>setTimeout(r,ms)),run=source=>w.eval(source);
(async()=>{try{
  await tick();
  // Cliente falso: guarda as chamadas e responde conforme o servidor.
  w.server={revision:0,payload:null,owned:[],calls:[],conflictOnce:false,missing:false};
  run(`juntoOnline.client={rpc:async(name,args)=>{
    const s=window.server;s.calls.push({name,args:JSON.parse(JSON.stringify(args||{}))});
    if(s.missing)return {data:null,error:{message:'function not found'}};
    if(name==='get_account_people_workspace')return {data:{revision:s.revision,payload:s.payload,owned_trip_groups:s.owned},error:null};
    if(name==='save_account_people_workspace'){
      if(s.conflictOnce||args.expected_revision!==s.revision){s.conflictOnce=false;return {data:null,error:{code:'40001',message:'revision conflict'}}}
      s.revision++;s.payload=args.new_payload;return {data:{revision:s.revision,payload:s.payload},error:null};
    }
    return {data:null,error:{message:'unexpected '+name}};
  }};`);
  const calls=name=>w.server.calls.filter(call=>call.name===name);

  // RPC ausente (migration ainda não aplicada): nada quebra, nada é salvo.
  w.server.missing=true;
  run(`juntoOnline.user={id:'u1',email:'u1@example.test'};db.groups=[];db.members=[];db.relationships=[];db.trips=[];db.active='';`);
  assert.equal(await run('loadAccountPeople()'),false);assert.equal(run('accountPeople.loaded'),false);
  run('save()');await tick(1300);assert.equal(calls('save_account_people_workspace').length,0,'sem carregar, não salva');
  w.server.missing=false;w.server.calls=[];

  // Primeira entrada sem planejamento aberto: inicializa pelos planejamentos próprios (com vínculo no formato antigo).
  w.server.owned=[{group:{id:'g1',name:'Família'},members:[{id:'ricardo',groupId:'g1',name:'Ricardo'},{id:'thalles',groupId:'g1',name:'Thalles'}],
    relationships:[{id:'r-old',groupId:'g1',fromMemberId:'thalles',toMemberId:'ricardo',type:'child',label:''}],groupFamilies:[],peopleMapLayouts:[{groupId:'g1',zoom:1,positions:{}}],roomPreferences:[]}];
  assert.equal(await run('loadAccountPeople()'),true);
  assert.equal(run('db.groups.map(g=>g.id).join()'),'g1');assert.equal(run('db.activeGroupId'),'g1');
  assert.equal(run(`describeFamilyLink(db.relationships[0],'ricardo')`),'Pai/mãe de Thalles');
  await tick(60);
  assert.equal(calls('save_account_people_workspace').length,1,'inicialização salva na conta');
  assert.equal(calls('save_account_people_workspace')[0].args.expected_revision,0);
  assert.equal(w.server.revision,1);

  // Página de grupos funciona sem planejamento aberto.
  run(`db.simplePage='grupos';db.legacyPage='';render();`);
  assert(w.document.querySelector('#app').textContent.includes('Família'),'grupo da conta aparece sem planejamento');

  // Alteração salva com a revisão atual.
  run(`db.members.push({id:'nicollas',groupId:'g1',name:'Nicollas'});saveFamilyLink({fromId:'ricardo',option:'parent',toId:'nicollas'});save();`);
  await tick(1350);
  const last=calls('save_account_people_workspace').at(-1);
  assert.equal(last.args.expected_revision,1);assert.equal(w.server.revision,2);
  assert(last.args.new_payload.relationships.some(r=>r.fromMemberId==='ricardo'&&r.toMemberId==='nicollas'&&r.type==='parent'));
  const before=calls('save_account_people_workspace').length;run('save()');await tick(1350);
  assert.equal(calls('save_account_people_workspace').length,before,'sem mudança, não reenvia');

  // Conflito: outro aparelho salvou antes; a versão da conta é recarregada.
  w.server.payload={...w.server.payload,relationships:w.server.payload.relationships.filter(r=>r.toMemberId!=='nicollas')};w.server.revision=5;
  run(`db.groups[0].name='Família Silva';save();`);await tick(1400);await tick(60);
  assert(!run(`db.relationships.some(r=>r.toMemberId==='nicollas')`),'vínculo removido em outro aparelho não volta');
  assert(w.document.querySelector('#toasts').textContent.includes('outro aparelho'));
  assert.equal(run('accountPeople.revision'),w.server.revision,'revisão local acompanha a do servidor');
  const accountName=run(`db.groups.find(g=>g.id==='g1').name`);

  // Abrir um planejamento com snapshot antigo não desfaz os vínculos da conta; pessoas do snapshot são somadas.
  run(`saveFamilyLink({fromId:'ricardo',option:'parent',toId:'nicollas'});save();`);await tick(1350);
  run(`mergeOnlineBundle({trip:{id:'local-trip',groupId:'g1',name:'Natal'},group:{id:'g1',name:'Família antiga'},
    members:[{id:'ricardo',groupId:'g1',name:'Ricardo'},{id:'tia',groupId:'g1',name:'Tia Rosa'}],
    relationships:[{id:'stale',groupId:'g1',fromMemberId:'ricardo',toMemberId:'thalles',type:'friend'}]},'remote-trip',3)`);
  assert(run(`db.relationships.some(r=>r.fromMemberId==='ricardo'&&r.toMemberId==='nicollas')`),'vínculos da conta preservados');
  assert(!run(`db.relationships.some(r=>r.id==='stale')`),'vínculo antigo do snapshot não volta');
  assert(run(`db.members.some(m=>m.id==='tia')`)&&run(`db.members.some(m=>m.id==='nicollas')`),'pessoas unidas');
  assert.equal(run(`db.groups.find(g=>g.id==='g1').name`),accountName,'nome do grupo da conta, não o do snapshot antigo');

  // Visão de participante e troca de conta: nada é lido nem enviado.
  w.server.calls=[];run(`juntoOnline.participantTripId='remote-trip';save();`);await tick(1350);
  assert.equal(calls('save_account_people_workspace').length,0);
  run(`juntoOnline.participantTripId=null;isolateAccountWorkspace('u2');`);
  assert.equal(run('accountPeople.loaded'),false);assert.equal(run('db.groups.length'),0,'outra conta começa vazia');

  await tick(100);
  assert.deepEqual(errors,[]);
  console.log('PASS account people: dormant without RPC, bootstrap from own trips, groups page without planning, revisioned saves, conflict reload, stale snapshot kept out, account switch');
}catch(error){console.error(error,errors);process.exitCode=1}finally{w.close()}})();
