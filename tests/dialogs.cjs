// Modais acessíveis (Esc, Tab, foco de volta) e askConfirm() no lugar de window.confirm().
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script src="([^"]+)"(?: defer)?><\/script>/g,(m,src)=>src.startsWith('http')?'':`<script>${fs.readFileSync(path.join(root,src.split('?')[0]),'utf8').replaceAll('</script','<\\/script')}</script>`);
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented'))errors.push(e.message)});
const dom=new JSDOM(html,{url:'https://junto.test/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.structuredClone=structuredClone;w.matchMedia=()=>({matches:false,addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.confirm=()=>{throw new Error('window.confirm não deve ser usado nas ações convertidas')};
  // jsdom não calcula layout; considera visível tudo que não está oculto.
  w.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}]};
}});
const w=dom.window,doc=w.document,tick=()=>new Promise(r=>setTimeout(r,20));
const key=(name,extra={})=>doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,...extra}));
(async()=>{try{
  await tick();
  const opener=doc.createElement('button');opener.textContent='Abrir';doc.querySelector('#app').append(opener);opener.focus();

  // Modal: rótulos, foco inicial, Tab preso, Esc fecha pelo [data-close] e foco volta.
  w.eval(`modal('Editar pessoa','Altere o nome.','<form><input name="a"><input name="b"><button type="button" class="last">Salvar</button></form>')`);
  const dialog=doc.querySelector('#modal-root .modal');
  assert.equal(dialog.getAttribute('aria-labelledby'),'modal-title');
  assert.equal(doc.getElementById('modal-title').textContent,'Editar pessoa');
  assert.equal(doc.getElementById(dialog.getAttribute('aria-describedby')).textContent,'Altere o nome.');
  assert.equal(doc.activeElement.name,'a','foco no primeiro campo');
  doc.querySelector('#modal-root .last').focus();key('Tab');
  assert(dialog.contains(doc.activeElement),'Tab no último elemento volta para dentro do modal');
  assert.equal(doc.activeElement.getAttribute('data-close'),'','Tab circula para o primeiro (botão fechar)');
  key('Tab',{shiftKey:true});assert(doc.activeElement.classList.contains('last'),'Shift+Tab no primeiro vai para o último');
  let closedByButton=0;doc.querySelector('#modal-root [data-close]').addEventListener('click',()=>closedByButton++);
  key('Escape');
  assert.equal(closedByButton,1,'Esc usa o mesmo [data-close] do mouse');
  assert.equal(doc.querySelector('#modal-root .modal'),null,'Esc fecha o modal');
  assert.equal(doc.activeElement,opener,'foco volta para quem abriu');

  // askConfirm: texto escapado, Esc = cancelar, foco em Cancelar nas ações de perigo.
  let answer=w.askConfirm('<img src=x onerror="window.__xss=1"> some',{title:'Excluir <b>?</b>',confirmLabel:'Excluir',danger:true});
  let layer=doc.querySelector('.confirm-bg');
  assert(layer,'diálogo aberto');
  assert.equal(layer.querySelector('img'),null);assert.equal(layer.querySelector('b'),null);
  assert.equal(layer.querySelector('h2').textContent,'Excluir <b>?</b>');
  assert(layer.querySelector('[data-confirm-ok]').classList.contains('danger'));
  assert(doc.activeElement.hasAttribute('data-confirm-cancel'),'perigo: foco inicial em Cancelar');
  assert.equal(layer.querySelector('[role=alertdialog]').getAttribute('aria-describedby'),layer.querySelector('.confirm-message').id);
  key('Escape');
  assert.equal(await answer,false);assert.equal(doc.querySelector('.confirm-bg'),null);assert.equal(doc.activeElement,opener);

  // Sobre um modal aberto: clicar no fundo do diálogo cancela sem fechar o modal; Esc não fecha os dois.
  w.eval(`modal('Pagamento','Detalhes.','<p>corpo</p>')`);
  answer=w.askConfirm('Cancelar pagamento?');
  doc.querySelector('.confirm-bg').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  assert.equal(await answer,false);
  assert(doc.querySelector('#modal-root .modal'),'o modal de baixo continua aberto');
  answer=w.askConfirm('Confirmar?');key('Escape');assert.equal(await answer,false);
  assert(doc.querySelector('#modal-root .modal'),'Esc fecha só o diálogo de confirmação');
  answer=w.askConfirm('Confirmar?');assert(doc.activeElement.hasAttribute('data-confirm-ok'),'sem perigo: foco em Confirmar');
  doc.querySelector('.confirm-bg [data-confirm-ok]').click();assert.equal(await answer,true);
  w.closeModal();

  // Esc também fecha o menu lateral quando não há modal.
  doc.querySelector('.sidebar').classList.add('open');opener.focus();key('Escape');
  assert(!doc.querySelector('.sidebar').classList.contains('open'),'Esc fecha o menu');

  await tick();
  assert.equal(w.__xss,undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS dialogs: modal labels, focus trap, Esc via data-close, focus restore; askConfirm escaping, danger focus, Esc/backdrop cancel, stacking over modal');
}catch(error){console.error(error,errors);process.exitCode=1}finally{w.close()}})();
