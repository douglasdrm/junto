// Regressão: nomes vindos do banco (evento, participante) não podem virar HTML.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const vc=new VirtualConsole();
const dom=new JSDOM('<!doctype html><body><main id="app"></main><nav id="nav"></nav><div id="toasts"></div><div id="modal-root"></div><aside class="sidebar"></aside><div id="shade"></div></body>',{runScripts:'dangerously',url:'https://junto.test/',virtualConsole:vc});
const w=dom.window;
// Script clássico (como no index.html): declarações ficam no escopo global mesmo se o render inicial falhar.
const script=w.document.createElement('script');script.textContent=fs.readFileSync(path.join(root,'app.js'),'utf8');w.document.body.appendChild(script);
const doc=w.document;
const payload='<img src=x onerror="window.__xss=1">';

w.eval('modal').call(w,`Participar de ${payload}`,`Associar ${payload} à sua conta?`,'<p class="body-ok">ok</p>');
const root2=doc.querySelector('#modal-root');
assert.equal(root2.querySelector('img'),null,'título/subtítulo do modal não podem gerar elementos');
assert.equal(root2.querySelector('h2').textContent,`Participar de ${payload}`);
assert.equal(root2.querySelector('.modal-head p').textContent,`Associar ${payload} à sua conta?`);
assert(root2.querySelector('.body-ok'),'o corpo do modal continua aceitando HTML montado pelo app');

const quoted='Ana" autofocus onfocus="window.__xss=1';
const html=w.eval('select')('payer','Quem pagou',[['','Selecione'],[quoted,quoted]],quoted);
const holder=doc.createElement('div');holder.innerHTML=html;
const option=holder.querySelectorAll('option')[1];
assert.equal(option.value,quoted,'valor da opção preservado como texto');
assert.equal(option.hasAttribute('onfocus'),false,'aspas no nome não podem criar atributos');
assert.equal(option.selected,true);

const safeUrl=w.eval('safeUrl');
assert.equal(safeUrl('javascript:alert(1)'),null);
assert.equal(safeUrl('https://exemplo.com/casa').href,'https://exemplo.com/casa');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
assert(!source.includes('href="${esc(h.url)}"'),'links de imóveis precisam passar por safeUrl na exibição');
console.log('html-escaping ok');
