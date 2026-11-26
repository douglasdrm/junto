'use strict';
/* Vínculos familiares — fonte única: db.relationships ({groupId, fromMemberId, toMemberId, type, label}).

   Direção gravada (from → to), a mesma usada pela árvore (familyGenerationLevels) e pelo mapa:
     parent       from é pai/mãe de to              (from fica uma geração acima)
     grandparent  from é avô/avó de to              (duas gerações acima)
     stepchild    from é padrasto/madrasta de to    (to é enteado(a) de from)
     dependent    from é responsável; to é dependente
     responsible  from é responsável por to
     partner, ex, sibling, friend, custom: sem direção (mesma geração para partner/ex/sibling)
   O tipo legado "child" (from é filho(a) de to) é convertido para "parent" invertido.

   O cadastro antigo guardava vínculos em member.relationships. A migrateV7 copia esses dados para
   db.relationships, mas a cada carregamento: um vínculo removido na árvore voltava depois de recarregar,
   e o editor de pessoa lia a lista antiga (mostrando "Nenhum vínculo" para vínculos criados na árvore).
   normalizeFamilyLinks() esvazia a lista antiga depois da cópia e unifica os tipos. */

const FAMILY_LINK_OPTIONS=[
  // valor, texto em "A é ___ B", como gravar (a,b) => [from,to,type]
  ['parent','pai/mãe de',(a,b)=>[a,b,'parent']],
  ['child-of','filho(a) de',(a,b)=>[b,a,'parent']],
  ['partner','companheiro(a) de',(a,b)=>[a,b,'partner']],
  ['sibling','irmão/irmã de',(a,b)=>[a,b,'sibling']],
  ['grandparent','avô/avó de',(a,b)=>[a,b,'grandparent']],
  ['grandchild-of','neto(a) de',(a,b)=>[b,a,'grandparent']],
  ['stepparent','padrasto/madrasta de',(a,b)=>[a,b,'stepchild']],
  ['stepchild-of','enteado(a) de',(a,b)=>[b,a,'stepchild']],
  ['responsible','responsável por',(a,b)=>[a,b,'responsible']],
  ['dependent-of','dependente de',(a,b)=>[b,a,'dependent']],
  ['ex','ex-companheiro(a) de',(a,b)=>[a,b,'ex']],
  ['friend','amigo(a) de',(a,b)=>[a,b,'friend']],
  ['custom','outro vínculo com',(a,b)=>[a,b,'custom']],
];
const FAMILY_LINK_BY_VALUE=new Map(FAMILY_LINK_OPTIONS.map(option=>[option[0],option]));
const FAMILY_SYMMETRIC=new Set(['partner','ex','sibling','friend','custom']);
const FAMILY_QUICK_ADD=[['parent-of-me','+ Pai ou mãe'],['child-of-me','+ Filho(a)'],['partner','+ Companheiro(a)'],['sibling','+ Irmão/irmã'],['custom','+ Outro vínculo']];

function familyMemberName(id){return (db.members||[]).find(member=>member.id===id)?.name||'Pessoa removida'}

// Opção do formulário e "outra pessoa" para um vínculo gravado, vistos a partir de viewerId.
function familyLinkView(relation,viewerId){
  const isFrom=relation.fromMemberId===viewerId,other=isFrom?relation.toMemberId:relation.fromMemberId;
  const byType={
    parent:isFrom?'parent':'child-of',
    child:isFrom?'child-of':'parent',
    grandparent:isFrom?'grandparent':'grandchild-of',
    stepchild:isFrom?'stepparent':'stepchild-of',
    dependent:isFrom?'responsible':'dependent-of',
    responsible:isFrom?'responsible':'dependent-of',
  };
  return {option:byType[relation.type]||(FAMILY_SYMMETRIC.has(relation.type)?relation.type:'custom'),other};
}

function describeFamilyLink(relation,viewerId){
  const {option,other}=familyLinkView(relation,viewerId),name=familyMemberName(other);
  if(option==='custom')return `${relation.label||'Outro vínculo'} · ${name}`;
  const text=FAMILY_LINK_BY_VALUE.get(option)[1];
  // "responsável" visto por quem é cuidado pelo tipo responsible: "sob responsabilidade de".
  if(relation.type==='responsible'&&relation.toMemberId===viewerId)return `Sob responsabilidade de ${name}`;
  return `${text[0].toUpperCase()}${text.slice(1)} ${name}`;
}

// Frase completa a partir de quem está em "from": "Ricardo é pai/mãe de Thalles".
function familyLinkSentence(relation){
  const {option}=familyLinkView(relation,relation.fromMemberId),from=familyMemberName(relation.fromMemberId),to=familyMemberName(relation.toMemberId);
  return option==='custom'?`${from} e ${to}: ${relation.label||'outro vínculo'}`:`${from} é ${FAMILY_LINK_BY_VALUE.get(option)[1]} ${to}`;
}

function familyLinkKey(from,to,type){return FAMILY_SYMMETRIC.has(type)?[from,to].sort().join('|')+'|'+type:`${from}|${to}|${type}`}

function normalizeFamilyLinks(data){
  if(!data||typeof data!=='object')return false;
  let changed=false;
  if(!Array.isArray(data.relationships)){data.relationships=[];changed=true}
  const members=Array.isArray(data.members)?data.members:[];
  // Garante a cópia (a migrateV7 já faz isso no carregamento; aqui cobre dados vindos do servidor) e esvazia a lista antiga.
  members.forEach(member=>{
    const legacy=member.relationships;
    if(!Array.isArray(legacy)||!legacy.length)return;
    legacy.forEach(item=>{
      if(!item?.targetMemberId||item.targetMemberId===member.id)return;
      if(!data.relationships.some(relation=>relation.groupId===member.groupId&&relation.fromMemberId===member.id&&relation.toMemberId===item.targetMemberId&&relation.type===item.type))
        data.relationships.push({id:'rel-'+member.id+'-'+item.targetMemberId+'-'+item.type,groupId:member.groupId,fromMemberId:member.id,toMemberId:item.targetMemberId,type:item.type,label:item.label||'',createdAt:''});
    });
    member.relationships=[];changed=true;
  });
  const seen=new Set(),kept=[];
  data.relationships.forEach(relation=>{
    if(!relation||!relation.fromMemberId||!relation.toMemberId||relation.fromMemberId===relation.toMemberId){changed=true;return}
    if(relation.type==='child'){[relation.fromMemberId,relation.toMemberId]=[relation.toMemberId,relation.fromMemberId];relation.type='parent';changed=true}
    if(relation.type==='relative'||relation.type==='other'){relation.label=relation.label||(relation.type==='relative'?'Outro familiar':'Outro vínculo');relation.type='custom';changed=true}
    const key=relation.groupId+'|'+familyLinkKey(relation.fromMemberId,relation.toMemberId,relation.type)+(relation.type==='custom'?'|'+relation.label:'');
    if(seen.has(key)){changed=true;return}
    seen.add(key);kept.push(relation);
  });
  if(kept.length!==data.relationships.length)data.relationships=kept;
  return changed;
}

function familyGenerationLabel(memberId){
  if(typeof familyGenerationLevels!=='function')return '';
  const level=familyGenerationLevels(groupMembers()).get(memberId)||0;
  return level===0?'Base da família':`${level+1}ª geração`;
}

function familyLinkOptionsMarkup(selected){
  return FAMILY_LINK_OPTIONS.map(([value,text])=>`<option value="${value}" ${value===selected?'selected':''}>${esc(text)}</option>`).join('');
}
function familyPeopleOptions(selected,exceptId){
  return groupMembers().filter(member=>member.id!==exceptId).map(member=>`<option value="${esc(member.id)}" ${member.id===selected?'selected':''}>${esc(member.name)}</option>`).join('');
}

// Seção do editor de pessoa: lista do ponto de vista da pessoa + linha para criar/editar sem sair do formulário.
function familyLinksSection(member,editing=null){
  const links=groupRelations(member.groupId).filter(relation=>relation.fromMemberId===member.id||relation.toMemberId===member.id);
  const others=groupMembers(member.groupId).filter(item=>item.id!==member.id);
  const view=editing?familyLinkView(editing,member.id):{option:'parent',other:''};
  const generation=familyGenerationLabel(member.id);
  return `<fieldset class="age-rules family-links-section" data-family-links-for="${esc(member.id)}"><legend>Vínculos e posição na árvore</legend>
<p class="help">${generation?`<b>${esc(member.name)}</b> está em: <b>${esc(generation)}</b>. `:''}A posição na árvore vem dos vínculos: pais e avós ficam acima, filhos e netos abaixo, companheiros e irmãos na mesma geração.</p>
${links.length?`<div class="family-links-list">${links.map(relation=>`<div class="record ${editing?.id===relation.id?'editing':''}"><span>${esc(describeFamilyLink(relation,member.id))}</span><div class="record-actions"><button type="button" class="button ghost small" data-family-link-edit="${esc(relation.id)}">Editar</button><button type="button" class="button danger small" data-family-link-delete="${esc(relation.id)}">Remover</button></div></div>`).join('')}</div>`:'<p class="help">Nenhum vínculo cadastrado ainda.</p>'}
${others.length?`<div class="family-link-editor" data-editing="${esc(editing?.id||'')}"><p class="family-link-sentence"><b>${esc(member.name)}</b> é</p><div class="form-grid"><div class="field"><label for="familyLinkType">Vínculo</label><select id="familyLinkType" data-family-link-type>${familyLinkOptionsMarkup(view.option)}</select></div><div class="field"><label for="familyLinkOther">Pessoa</label><select id="familyLinkOther" data-family-link-other><option value="">Selecione</option>${familyPeopleOptions(view.other,member.id)}</select></div><div class="field" data-family-link-label-field ${view.option==='custom'?'':'hidden'}><label for="familyLinkLabel">Descrição</label><input id="familyLinkLabel" data-family-link-label maxlength="80" value="${esc(editing?.label||'')}" placeholder="Ex.: padrinho, prima"></div></div>
<p class="help" data-family-link-preview aria-live="polite">${esc(familyPreviewText(member.id,view.option,view.other,editing?.label||''))}</p>
<div class="actions"><button type="button" class="button primary small" data-family-link-save>${editing?'Salvar alteração':'Adicionar vínculo'}</button>${editing?'<button type="button" class="button ghost small" data-family-link-cancel>Cancelar edição</button>':''}</div>
<div class="family-quick-add" aria-label="Atalhos">${FAMILY_QUICK_ADD.map(([value,label])=>`<button type="button" class="button secondary small" data-family-quick="${value}">${label}</button>`).join('')}</div></div>`:'<p class="help">Cadastre outras pessoas no grupo para criar vínculos.</p>'}
</fieldset>`;
}

// Formulário em frase usado pelo mapa/árvore ("Definir vínculo entre as duas") e pelos detalhes da pessoa.
function relationshipForm(relation={}){
  const chosen=[...(typeof mapSelection!=='undefined'?mapSelection:[])];
  const a=relation.id?relation.fromMemberId:chosen[0]||'',view=relation.id?familyLinkView(relation,a):{option:'parent',other:chosen[1]||''};
  const people=selected=>`<option value="">Selecione</option>${groupMembers().map(member=>`<option value="${esc(member.id)}" ${member.id===selected?'selected':''}>${esc(member.name)}</option>`).join('')}`;
  return `<form id="family-link-form" data-id="${esc(relation.id||'')}"><div class="form-grid family-sentence-grid"><div class="field"><label for="familyFrom">Pessoa</label><select id="familyFrom" name="familyFrom" required>${people(a)}</select></div><div class="field"><label for="familyType">é</label><select id="familyType" name="familyType" data-family-link-type>${familyLinkOptionsMarkup(view.option)}</select></div><div class="field"><label for="familyTo">de / com</label><select id="familyTo" name="familyTo" required>${people(view.other)}</select></div></div><div class="field" data-family-link-label-field ${view.option==='custom'?'':'hidden'}><label for="familyLabel">Descrição</label><input id="familyLabel" name="familyLabel" maxlength="80" value="${esc(relation.label||'')}" placeholder="Ex.: padrinho, prima"></div><p class="help" data-family-link-preview aria-live="polite">${esc(familyPreviewText(a,view.option,view.other,relation.label||''))}</p><div class="notice">O vínculo não cria obrigação financeira.</div><div class="actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary">${relation.id?'Salvar vínculo':'Confirmar vínculo'}</button></div></form>`;
}

function familyPreviewText(fromId,option,toId,label){
  if(!fromId||!toId)return 'Escolha as duas pessoas para ver como fica.';
  if(fromId===toId)return 'Escolha duas pessoas diferentes.';
  const a=familyMemberName(fromId),b=familyMemberName(toId),text=option==='custom'?`${label||'outro vínculo'} com`:FAMILY_LINK_BY_VALUE.get(option)[1];
  const place={parent:`${a} fica uma geração acima de ${b}`,'child-of':`${a} fica uma geração abaixo de ${b}`,grandparent:`${a} fica duas gerações acima de ${b}`,'grandchild-of':`${a} fica duas gerações abaixo de ${b}`,stepparent:`${a} fica uma geração acima de ${b}`,'stepchild-of':`${a} fica uma geração abaixo de ${b}`,responsible:`${a} fica acima de ${b}`,'dependent-of':`${a} fica abaixo de ${b}`,partner:'na mesma geração',sibling:'na mesma geração',ex:'na mesma geração'}[option];
  return `${a} é ${text} ${b}.${place?` Na árvore: ${place}.`:''}`;
}

// Grava (cria ou altera) e reorganiza irmãos como o mapa já fazia. Devolve mensagem de erro ou ''.
function saveFamilyLink({id='',fromId,option,toId,label=''}){
  if(!fromId||!toId)return 'Escolha as duas pessoas.';
  if(fromId===toId)return 'Escolha duas pessoas diferentes.';
  const definition=FAMILY_LINK_BY_VALUE.get(option);if(!definition)return 'Escolha o tipo de vínculo.';
  const [from,to,type]=definition[2](fromId,toId),groupId=(db.members||[]).find(member=>member.id===fromId)?.groupId||db.activeGroupId;
  const old=db.relationships.find(relation=>relation.id===id);
  const key=familyLinkKey(from,to,type)+(type==='custom'?'|'+label.trim():'');
  if(db.relationships.some(relation=>relation.id!==old?.id&&relation.groupId===groupId&&familyLinkKey(relation.fromMemberId,relation.toMemberId,relation.type)+(relation.type==='custom'?'|'+(relation.label||'').trim():'')===key))return 'Este vínculo já existe.';
  const parentTypes=new Set(['parent','stepchild','dependent']),childOf=relation=>relation&&parentTypes.has(relation.type)?relation.toMemberId:'';
  const oldParents=old&&childOf(old)?descendantParents(childOf(old)):[];
  const record={groupId,fromMemberId:from,toMemberId:to,type,label:type==='custom'?label.trim():'',createdAt:old?.createdAt||new Date().toISOString()};
  if(old)Object.assign(old,record,{source:undefined});else db.relationships.push({id:uid(),...record});
  if(oldParents.length&&typeof reflowParentSet==='function')reflowParentSet(oldParents);
  const child=childOf(record);if(child&&typeof reflowDescendants==='function')reflowDescendants(child);
  return '';
}

function deleteFamilyLink(id){
  const removed=db.relationships.find(relation=>relation.id===id);if(!removed)return false;
  const child=['parent','stepchild','dependent'].includes(removed.type)?removed.toMemberId:'',oldParents=child?descendantParents(child):[];
  db.relationships=db.relationships.filter(relation=>relation.id!==id);
  if(oldParents.length&&typeof reflowParentSet==='function')reflowParentSet(oldParents);
  return true;
}

function familySectionFor(memberId){return [...document.querySelectorAll('[data-family-links-for]')].find(item=>item.dataset.familyLinksFor===memberId)||null}

function refreshFamilySection(memberId,editing=null){
  const section=familySectionFor(memberId),member=(db.members||[]).find(item=>item.id===memberId);
  if(!section||!member)return;
  section.outerHTML=familyLinksSection(member,editing);
  updateFamilyPreview(familySectionFor(memberId));
}

function updateFamilyPreview(scope){
  if(!scope)return;
  const preview=scope.querySelector('[data-family-link-preview]');if(!preview)return;
  const type=scope.querySelector('[data-family-link-type]')?.value||'parent';
  const fromId=scope.querySelector('[name="familyFrom"]')?.value||scope.dataset.familyLinksFor||scope.closest('[data-family-links-for]')?.dataset.familyLinksFor;
  const toId=(scope.querySelector('[name="familyTo"]')||scope.querySelector('[data-family-link-other]'))?.value;
  const label=(scope.querySelector('[name="familyLabel"]')||scope.querySelector('[data-family-link-label]'))?.value||'';
  const labelField=scope.querySelector('[data-family-link-label-field]');if(labelField)labelField.hidden=type!=='custom';
  preview.textContent=familyPreviewText(fromId,type,toId,label);
}

document.addEventListener('input',event=>{
  const scope=event.target.closest('#family-link-form,.family-links-section');if(scope)updateFamilyPreview(scope);
});
document.addEventListener('change',event=>{
  const scope=event.target.closest('#family-link-form,.family-links-section');if(scope)updateFamilyPreview(scope);
});

// Formulário em frase (modal próprio).
document.addEventListener('submit',event=>{
  if(event.target.id!=='family-link-form')return;
  event.preventDefault();event.stopImmediatePropagation();
  const form=new FormData(event.target);
  const error=saveFamilyLink({id:event.target.dataset.id,fromId:form.get('familyFrom'),option:form.get('familyType'),toId:form.get('familyTo'),label:String(form.get('familyLabel')||'')});
  if(error)return toast(error,'error');
  if(typeof mapSelection!=='undefined')mapSelection.clear();
  closeModal();commit(event.target.dataset.id?'Vínculo atualizado.':'Vínculo criado. A árvore foi reorganizada.');
},true);

// Ações dentro do editor de pessoa e nos detalhes (window/capture: roda antes dos handlers antigos).
window.addEventListener('click',async event=>{
  const section=event.target.closest('[data-family-links-for]');
  const deleteButton=event.target.closest('[data-family-link-delete],[data-delete-relation]');
  if(deleteButton){
    event.preventDefault();event.stopImmediatePropagation();
    const id=deleteButton.dataset.familyLinkDelete||deleteButton.dataset.deleteRelation,relation=db.relationships.find(item=>item.id===id);if(!relation)return;
    const viewer=section?.dataset.familyLinksFor||deleteButton.closest('[data-member-links]')?.dataset.memberLinks||relation.fromMemberId;
    const ownerName=familyMemberName(viewer);
    if(!await askConfirm(`${ownerName}: “${describeFamilyLink(relation,viewer)}” deixa de existir. A árvore é reorganizada; pessoas e Turmas são preservadas.`,{title:'Remover vínculo?',confirmLabel:'Remover vínculo',danger:true}))return;
    deleteFamilyLink(id);save();render();toast('Vínculo removido.');
    if(section)refreshFamilySection(viewer);
    else{const member=(db.members||[]).find(item=>item.id===viewer);if(member&&document.querySelector('[data-member-links]'))openMemberDetails(member)}
    return;
  }
  const editDetails=event.target.closest('[data-edit-relation]');
  if(editDetails){
    event.preventDefault();event.stopImmediatePropagation();
    const relation=db.relationships.find(item=>item.id===editDetails.dataset.editRelation);if(!relation)return;
    modal('Editar vínculo','Leia como uma frase: “Pessoa é … de …”.',relationshipForm(relation));updateFamilyPreview(document.querySelector('#family-link-form'));
    return;
  }
  if(!section)return;
  const memberId=section.dataset.familyLinksFor;
  const edit=event.target.closest('[data-family-link-edit]');
  if(edit){event.preventDefault();refreshFamilySection(memberId,db.relationships.find(item=>item.id===edit.dataset.familyLinkEdit));section.ownerDocument.querySelector('[data-family-link-other]')?.focus();return}
  if(event.target.closest('[data-family-link-cancel]')){event.preventDefault();refreshFamilySection(memberId);return}
  const quick=event.target.closest('[data-family-quick]');
  if(quick){
    event.preventDefault();
    const option={'parent-of-me':'child-of','child-of-me':'parent'}[quick.dataset.familyQuick]||quick.dataset.familyQuick;
    const select=section.querySelector('[data-family-link-type]');select.value=option;updateFamilyPreview(section);
    section.querySelector('[data-family-link-other]')?.focus();return;
  }
  if(event.target.closest('[data-family-link-save]')){
    event.preventDefault();
    const editor=section.querySelector('.family-link-editor');
    const error=saveFamilyLink({id:editor.dataset.editing,fromId:memberId,option:section.querySelector('[data-family-link-type]').value,toId:section.querySelector('[data-family-link-other]').value,label:section.querySelector('[data-family-link-label]')?.value||''});
    if(error)return toast(error,'error');
    const wasEditing=Boolean(editor.dataset.editing);
    save();render();refreshFamilySection(memberId);toast(wasEditing?'Vínculo atualizado.':'Vínculo adicionado. A árvore foi reorganizada.');
  }
},true);

// Detalhes da pessoa: vínculos do ponto de vista dela.
function openMemberDetails(member){
  if(!member)return;
  const links=groupRelations(member.groupId).filter(relation=>relation.fromMemberId===member.id||relation.toMemberId===member.id);
  const crews=permanentFamilies(member.groupId).filter(crew=>crew.memberIds.includes(member.id));
  const generation=familyGenerationLabel(member.id);
  modal(member.name,member.nickname||'Cadastro permanente',`<div class="detail-avatar">${esc(initials(member.name))}</div><p><b>Turmas:</b> ${crews.map(crew=>esc(crew.name)).join(', ')||'Nenhuma'}</p>${generation?`<p><b>Na árvore:</b> ${esc(generation)}</p>`:''}<div data-member-links="${esc(member.id)}">${links.map(relation=>`<div class="record"><span>${esc(describeFamilyLink(relation,member.id))}</span><div class="record-actions"><button type="button" class="button ghost small" data-edit-relation="${esc(relation.id)}">Editar</button><button type="button" class="button danger small" data-delete-relation="${esc(relation.id)}">Remover</button></div></div>`).join('')||'<p>Sem vínculos.</p>'}</div><div class="actions"><button type="button" class="button secondary" data-close>Fechar</button><button type="button" class="button primary" data-edit-member="${esc(member.id)}">Editar pessoa e vínculos</button></div>`);
}

if(normalizeFamilyLinks(db))save();
const renderBeforeFamilyLinks=render;
render=function(...args){if(normalizeFamilyLinks(db))save();return renderBeforeFamilyLinks(...args)};
function familyLinkCount(memberId){return (db.relationships||[]).filter(relation=>relation.fromMemberId===memberId||relation.toMemberId===memberId).length}
