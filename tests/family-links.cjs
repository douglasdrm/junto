// Vínculos familiares: fonte única, editor de pessoa, frase com direção e posição na árvore.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"(?: defer)?><\/script>/g,(m,src)=>src.startsWith('http')?'':`<script>${fs.readFileSync(path.join(root,src.split('?')[0]),'utf8').replaceAll('</script','<\\/script')}</script>`);
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'https://junto.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.confirm=()=>{throw new Error('window.confirm não deve ser usado')};
}});
const w=dom.window,doc=w.document,tick=()=>new Promise(r=>setTimeout(r,25));
const run=source=>w.eval(source);
const section=()=>doc.querySelector('[data-family-links-for]');
const texts=()=>[...section().querySelectorAll('.family-links-list .record span')].map(span=>span.textContent);
const confirmDialog=async()=>{await tick();doc.querySelector('.confirm-bg [data-confirm-ok]').click();await tick()};
(async()=>{try{
  await tick();
  // Estado com o problema relatado: vínculos da árvore em db.relationships e um vínculo antigo em member.relationships
  // que tinha sido removido da árvore (voltava a cada carregamento).
  run(`
    db.groups=[{id:'g',name:'Família',active:true}];db.activeGroupId='g';
    db.members=[{id:'ana',groupId:'g',name:'Ana'},{id:'beto',groupId:'g',name:'Beto'},{id:'bia',groupId:'g',name:'Bia'},{id:'caio',groupId:'g',name:'Caio',relationships:[{targetMemberId:'bia',type:'friend',label:''}]},{id:'vo',groupId:'g',name:'Vó Lia'}];
    db.relationships=[
      {id:'r1',groupId:'g',fromMemberId:'ana',toMemberId:'bia',type:'parent',label:''},
      {id:'r2',groupId:'g',fromMemberId:'bia',toMemberId:'beto',type:'child',label:''},
      {id:'r3',groupId:'g',fromMemberId:'ana',toMemberId:'beto',type:'partner',label:''},
      {id:'r4',groupId:'g',fromMemberId:'caio',toMemberId:'ana',type:'relative',label:''}];
    render();`);
  await tick();

  // Normalização: lista antiga copiada e esvaziada, "child" vira "parent" invertido, "relative" vira "custom".
  const state=JSON.parse(run('JSON.stringify({members:db.members,relationships:db.relationships})'));
  assert.deepEqual(state.members.find(m=>m.id==='caio').relationships,[],'lista antiga esvaziada');
  const r2=state.relationships.find(r=>r.id==='r2');assert.equal(r2.type,'parent');assert.equal(r2.fromMemberId,'beto');assert.equal(r2.toMemberId,'bia');
  const r4=state.relationships.find(r=>r.id==='r4');assert.equal(r4.type,'custom');assert.equal(r4.label,'Outro familiar');
  assert(state.relationships.some(r=>r.fromMemberId==='caio'&&r.toMemberId==='bia'&&r.type==='friend'),'vínculo antigo preservado no modelo novo');
  run(`db.relationships=db.relationships.filter(r=>!(r.fromMemberId==='caio'&&r.type==='friend'));render();`);
  assert(!run(`db.relationships.some(r=>r.fromMemberId==='caio'&&r.type==='friend')`),'vínculo removido não volta depois de render/normalização');

  // O editor de pessoa mostra os mesmos vínculos da árvore, do ponto de vista da pessoa.
  run(`openPermanentMember(db.members.find(m=>m.id==='bia'))`);await tick();
  assert(section(),'seção de vínculos no editor');
  assert(!doc.querySelector('#modal-root').textContent.includes('Nenhum vínculo cadastrado'),'não diz que não há vínculos');
  assert.deepEqual(texts().sort(),['Filho(a) de Ana','Filho(a) de Beto']);
  assert(section().textContent.includes('2ª geração'),'mostra a posição na árvore');

  // Atalho "+ Irmão/irmã" e adicionar sem sair do editor (campos já digitados continuam no formulário).
  doc.querySelector('[name=nickname]').value='Bi';
  section().querySelector('[data-family-quick="sibling"]').click();
  assert.equal(section().querySelector('[data-family-link-type]').value,'sibling');
  const other=section().querySelector('[data-family-link-other]');other.value='caio';other.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(section().querySelector('[data-family-link-preview]').textContent,'Bia é irmão/irmã de Caio. Na árvore: na mesma geração.');
  section().querySelector('[data-family-link-save]').click();await tick();
  assert(texts().includes('Irmão/irmã de Caio'));
  assert.equal(doc.querySelector('[name=nickname]').value,'Bi','edição em andamento preservada');

  // "+ Pai ou mãe" grava a direção certa: Bia é filha de Vó Lia (from = Vó Lia, a mais velha).
  section().querySelector('[data-family-quick="parent-of-me"]').click();
  assert.equal(section().querySelector('[data-family-link-type]').value,'child-of');
  section().querySelector('[data-family-link-other]').value='vo';section().querySelector('[data-family-link-save]').click();await tick();
  assert(run(`db.relationships.some(r=>r.type==='parent'&&r.fromMemberId==='vo'&&r.toMemberId==='bia')`),'pai/mãe gravado com from = mais velho');

  // Duplicado é recusado.
  section().querySelector('[data-family-quick="parent-of-me"]').click();section().querySelector('[data-family-link-other]').value='ana';section().querySelector('[data-family-link-save]').click();await tick();
  assert.equal(run(`db.relationships.filter(r=>r.type==='parent'&&r.fromMemberId==='ana'&&r.toMemberId==='bia').length`),1);

  // Editar: Vó Lia na verdade é avó. Muda o tipo na linha de edição.
  const editVo=[...section().querySelectorAll('.family-links-list .record')].find(row=>row.textContent.includes('Vó Lia'));
  editVo.querySelector('[data-family-link-edit]').click();await tick();
  assert.equal(section().querySelector('[data-family-link-type]').value,'child-of');assert.equal(section().querySelector('[data-family-link-other]').value,'vo');
  section().querySelector('[data-family-link-type]').value='grandchild-of';section().querySelector('[data-family-link-save]').click();await tick();
  assert(texts().includes('Neto(a) de Vó Lia'));
  assert(run(`db.relationships.some(r=>r.type==='grandparent'&&r.fromMemberId==='vo'&&r.toMemberId==='bia')`));
  assert(!run(`db.relationships.some(r=>r.type==='parent'&&r.fromMemberId==='vo')`),'edição substitui, não duplica');

  // Remover pede confirmação própria.
  const caioRow=[...section().querySelectorAll('.family-links-list .record')].find(row=>row.textContent.includes('Caio'));
  caioRow.querySelector('[data-family-link-delete]').click();await confirmDialog();
  assert(!texts().some(text=>text.includes('Caio')));

  // Salvar a pessoa não recria nada no modelo antigo.
  doc.querySelector('#member-v5 button.primary').click();await tick();
  assert.deepEqual(JSON.parse(run('JSON.stringify(db.members.find(m=>m.id==="bia").relationships||[])')),[]);

  // Formulário em frase usado pela árvore: "Ana é mãe/pai de ..." com prévia.
  run(`mapSelection.clear();mapSelection.add('ana');mapSelection.add('caio');modal('Criar relacionamento','x',relationshipForm())`);await tick();
  const form=doc.querySelector('#family-link-form');
  assert.equal(form.querySelector('[name=familyFrom]').value,'ana');assert.equal(form.querySelector('[name=familyTo]').value,'caio');
  form.querySelector('[name=familyType]').value='stepparent';form.querySelector('[name=familyType]').dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(form.querySelector('[data-family-link-preview]').textContent,'Ana é padrasto/madrasta de Caio. Na árvore: Ana fica uma geração acima de Caio.');
  form.querySelector('button.primary').click();await tick();
  assert(run(`db.relationships.some(r=>r.type==='stepchild'&&r.fromMemberId==='ana'&&r.toMemberId==='caio')`));

  // Árvore e detalhes usam a mesma descrição direcional.
  const levels=run(`(()=>{const l=familyGenerationLevels(groupMembers());return {ana:l.get('ana'),bia:l.get('bia'),caio:l.get('caio'),vo:l.get('vo')}})()`);
  assert(levels.bia>levels.ana&&levels.caio>levels.ana&&levels.vo<levels.bia,'gerações seguem os vínculos: '+JSON.stringify(levels));
  const tree=run(`automaticFamilyTree(groupMembers())`);
  assert(tree.includes('Pai/mãe de Bia'),'card da Ana diz de quem é mãe/pai');assert(tree.includes('Enteado(a) de Ana'));
  run(`openMemberDetails(db.members.find(m=>m.id==='ana'))`);await tick();
  assert(doc.querySelector('[data-member-links]').textContent.includes('Padrasto/madrasta de Caio'));
  doc.querySelector('[data-member-links] [data-delete-relation]').click();await confirmDialog();
  assert(doc.querySelector('[data-member-links]'),'detalhes continuam abertos e atualizados');

  // Caso relatado: "Thalles é filho de Ricardo" e "Ricardo é pai de Nicollas", inclusive com dados do formulário antigo.
  run(`db.members.push({id:'ricardo',groupId:'g',name:'Ricardo'},{id:'thalles',groupId:'g',name:'Thalles'},{id:'nicollas',groupId:'g',name:'Nicollas'});
    db.relationships.push({id:'old-child',groupId:'g',fromMemberId:'thalles',toMemberId:'ricardo',type:'child',label:''});
    saveFamilyLink({fromId:'ricardo',option:'parent',toId:'nicollas'});render();`);
  const say=id=>run(`groupRelations().filter(x=>x.fromMemberId==='${id}'||x.toMemberId==='${id}').map(x=>describeFamilyLink(x,'${id}')).sort().join(' · ')`);
  assert.equal(say('ricardo'),'Pai/mãe de Nicollas · Pai/mãe de Thalles');
  assert.equal(say('thalles'),'Filho(a) de Ricardo');assert.equal(say('nicollas'),'Filho(a) de Ricardo');
  assert(run(`mapLines(groupMembers())`).includes('Ricardo é pai/mãe de Thalles'),'linha do mapa com frase direcional');
  await new Promise(resolve=>setTimeout(resolve,150));

  assert.deepEqual(errors,[]);
  console.log('PASS family links: single source, legacy cleanup, editor shows tree links, quick add, direction, edit, delete, sentence form, generations');
}catch(error){console.error(error,errors);process.exitCode=1}finally{w.close()}})();
