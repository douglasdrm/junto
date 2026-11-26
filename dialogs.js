'use strict';
/* Diálogos acessíveis.
   - Teclado nos modais de modal(): Esc fecha (pelo mesmo [data-close] do mouse, para manter a
     limpeza de cada tela) e Tab circula só dentro do modal aberto.
   - askConfirm(): confirmação própria no lugar de window.confirm(), com texto sempre escapado,
     botão de perigo e foco inicial em "Cancelar" nas ações destrutivas. Resolve true/false. */

const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';

function focusableIn(container){
  return [...container.querySelectorAll(FOCUSABLE)].filter(element=>!element.closest('[hidden]')&&element.getClientRects().length>0);
}

function trapTab(event,container){
  const items=focusableIn(container);
  if(!items.length){event.preventDefault();container.focus();return}
  const first=items[0],last=items[items.length-1],active=document.activeElement;
  if(event.shiftKey&&(active===first||!container.contains(active))){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&(active===last||!container.contains(active))){event.preventDefault();first.focus()}
}

document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||document.querySelector('.confirm-bg'))return;
  const dialog=document.querySelector('#modal-root .modal');
  if(dialog){
    if(event.key==='Escape'){
      event.preventDefault();
      const close=dialog.querySelector('[data-close]');
      if(close)close.click();else closeModal();
    }else if(event.key==='Tab')trapTab(event,dialog);
    return;
  }
  if(event.key==='Escape'&&document.querySelector('.sidebar.open'))closeMenu();
});

let confirmSequence=0;
function askConfirm(message,options={}){
  const {title='Confirmar ação',confirmLabel='Confirmar',cancelLabel='Cancelar',danger=false}=options;
  return new Promise(resolve=>{
    const previous=document.activeElement,id=`confirm-${++confirmSequence}`;
    const layer=document.createElement('div');
    layer.className='confirm-bg';
    layer.innerHTML=`<section class="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="${id}-title" aria-describedby="${id}-message" tabindex="-1"><h2 id="${id}-title"></h2><p id="${id}-message" class="confirm-message"></p><div class="actions"><button type="button" class="button secondary" data-confirm-cancel></button><button type="button" class="button ${danger?'danger':'primary'}" data-confirm-ok></button></div></section>`;
    layer.querySelector('h2').textContent=title;
    layer.querySelector('.confirm-message').textContent=message;
    layer.querySelector('[data-confirm-cancel]').textContent=cancelLabel;
    layer.querySelector('[data-confirm-ok]').textContent=confirmLabel;
    const dialog=layer.querySelector('.confirm-dialog');
    let done=false;
    const finish=value=>{
      if(done)return;done=true;
      document.removeEventListener('keydown',onKey,true);
      layer.remove();
      if(previous?.isConnected&&typeof previous.focus==='function')previous.focus();
      resolve(value);
    };
    const onKey=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false)}
      else if(event.key==='Tab'){event.stopPropagation();trapTab(event,dialog)}
    };
    // Cliques não chegam aos handlers globais (que fecham o modal de baixo ao clicar no fundo).
    layer.addEventListener('click',event=>{
      event.stopPropagation();
      if(event.target.closest('[data-confirm-ok]'))finish(true);
      else if(event.target.closest('[data-confirm-cancel]')||event.target===layer)finish(false);
    });
    document.addEventListener('keydown',onKey,true);
    document.body.append(layer);
    layer.querySelector(danger?'[data-confirm-cancel]':'[data-confirm-ok]').focus();
  });
}
