'use strict';
/* Local SVG icon set shared by all navigation and action components. */
const juntoIconPaths={menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',home:'<path d="m3 10 9-7 9 7v10H14v-6h-4v6H3Z"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/>',wallet:'<path d="M4 6h15v4M4 6a2 2 0 0 1 0-4h13v4M4 6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h17V10h-6v6h6"/><path d="M17 13h1"/>',receipt:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 8h8M8 12h8M8 16h4"/>',person:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',plus:'<path d="M12 4v16M4 12h16"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15ZM4 20h16"/>',trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',check:'<path d="m4 12 5 5L20 6"/>',share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4m-6 8 6 4"/>',refresh:'<path d="M20 7V3l-3 3A8 8 0 1 0 20 16M20 3h-5"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',bag:'<path d="M5 7h14l2 14H3ZM8 7V5a4 4 0 0 1 8 0v2"/>',pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'};
function juntoIcon(name){const paths=juntoIconPaths[name];return paths?`<svg class="ds-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`:''}
function decorateJuntoComponents(root=document){
  if(!root.querySelectorAll)return;
  const navNames={inicio:'home',viagens:'calendar',grupos:'users',contribuicoes:'wallet',financeiro:'receipt',pessoas:'person',mais:'more',app:'home','guest-event-info':'pin','guest-finance-summary':'wallet','guest-participants':'users','guest-shopping':'bag'};
  const navs=[...(root.matches?.('.nav')?[root]:[]),...root.querySelectorAll('.nav')];
  navs.forEach(button=>{const name=navNames[button.dataset.simplePage||button.dataset.guestSection]||(button.hasAttribute('data-leave-participant-view')?'calendar':null),span=button.querySelector('span');if(name&&span&&!span.querySelector('.ds-icon')){span.classList.add('ds-nav-icon');span.innerHTML=juntoIcon(name)}});
  const buttons=[...(root.matches?.('button.button,a.button')?[root]:[]),...root.querySelectorAll('button.button,a.button')];
  buttons.forEach(button=>{if(button.querySelector('.ds-icon')||button.matches('[data-google-login],.auth-google-primary'))return;let name=null;
    if(button.matches('.danger,[data-directory-delete]'))name='trash';
    else if(button.matches('[data-new-trip],[data-new-historical-trip],[data-add-shopping],[data-new-member],[data-add-market-purchase]'))name='plus';
    else if(button.matches('[data-edit-shopping],[data-edit-person-v3],[data-edit-member]'))name='edit';
    else if(button.matches('[data-general-invite],[data-share-created-event],[data-named-invite]'))name='share';
    else if(button.matches('[data-refresh-planning-directory],[data-refresh-online-trip],[data-refresh-participant-trip]'))name='refresh';
    else if(button.matches('[data-open-online-trip],[data-select-simple-trip]'))name='arrow';
    else if(button.matches('[data-saved-people]'))name='users';
    else if(button.type==='submit'&&button.closest('form'))name='check';
    if(name){button.insertAdjacentHTML('afterbegin',juntoIcon(name));if(name==='plus'){for(const node of button.childNodes)if(node.nodeType===3){node.textContent=node.textContent.replace(/^\s*\+\s*/,'');break}}}
  });
  root.querySelectorAll('#menu-open,#menu-close,.modal-head button[data-close]').forEach(button=>{if(!button.querySelector('.ds-icon'))button.innerHTML=juntoIcon(button.id==='menu-open'?'menu':'close')});
  root.querySelectorAll('.sidebar-account button i').forEach(icon=>{if(!icon.querySelector('.ds-icon'))icon.innerHTML=juntoIcon('person')});
}
decorateJuntoComponents();
let queuedIconRoots=new Set(),iconsQueued=false;
new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&!node.matches('svg,.ds-icon *'))queuedIconRoots.add(node);if(!iconsQueued&&queuedIconRoots.size){iconsQueued=true;queueMicrotask(()=>{iconsQueued=false;const roots=[...queuedIconRoots];queuedIconRoots.clear();roots.forEach(decorateJuntoComponents)})}}).observe(document.body,{childList:true,subtree:true});
