'use strict';
// The market cart is a server draft. Official items change only at checkout/approval.
loadPurchaseWorkspace=async function(force=false){
 const id=purchaseTripId(),key=`${juntoOnline.user?.id}:${id}`;if(!id||!juntoOnline.user)return null;
 if(!force&&purchaseWorkspaceKey===key&&purchaseWorkspace)return purchaseWorkspace;
 if(!force&&purchaseWorkspaceLoading?.key===key)return purchaseWorkspaceLoading.promise;
 const promise=(async()=>{const {data,error}=await juntoOnline.client.rpc('get_market_purchase_workspace',{target_trip:id});if(error)throw error;if(key!==`${juntoOnline.user?.id}:${purchaseTripId()}`)return null;purchaseWorkspace=data;purchaseWorkspaceKey=key;return data})();
 purchaseWorkspaceLoading={key,promise};try{return await promise}finally{if(purchaseWorkspaceLoading?.promise===promise)purchaseWorkspaceLoading=null}
};
function activeMarketBatch(){return purchaseWorkspaceKey===`${juntoOnline.user?.id}:${purchaseTripId()}`?purchaseWorkspace?.batches?.find(batch=>batch.own&&batch.status==='draft'):null}
const shoppingModalBeforeBatches=shoppingItemModal;
shoppingItemModal=function(item={}){
 shoppingModalBeforeBatches(item);
 if(!item.id||purchaseWorkspaceKey!==`${juntoOnline.user?.id}:${purchaseTripId()}`)return;
 const batch=(purchaseWorkspace?.batches||[]).find(batch=>batch.status==='confirmed'&&(batch.items||[]).some(line=>line.picked&&line.source_item_id===item.id));
 if(!batch)return;const hint=document.querySelector('#shopping-item .purchase-receipt-hint');
 if(hint)hint.innerHTML=`<p class="help">Este item faz parte de ${esc(batch.store_name||'uma compra de mercado')}. A nota é compartilhada pelos itens dessa compra.</p>${batch.receipt_path?`<button type="button" class="button secondary small" data-view-purchase-receipt="${esc(batch.receipt_path)}">Ver nota fiscal da compra</button>`:`<button type="button" class="button secondary small" data-batch-attach="${esc(batch.id)}">Anexar nota fiscal à compra</button>`}`;
};
function marketPicked(batch){return (batch.items||[]).filter(item=>item.picked)}
function marketBatchTotal(batch){return marketPicked(batch).reduce((total,item)=>total+Number(item.total_cents||0),0)}
function marketBatchFailure(error){const message=error?.message||'';if(message.includes('draft changed'))return toast('A compra foi atualizada em outro aparelho. Atualize e confira os itens antes de salvar.','error');if(message.includes('invoice total differs'))return toast('O total da nota deve conferir com a soma dos itens. Ajuste os preços antes de finalizar.','error');if(message.includes('select items'))return toast('Marque os itens do carrinho e informe os preços antes de finalizar.','error');if(message.includes('already finalized')||message.includes('already reviewed'))return toast('Essa compra já foi finalizada ou conferida. Atualize a lista.','error');purchaseFailure(error)}
function marketBatchList(batch){return `<ul class="market-batch-summary">${marketPicked(batch).map(item=>`<li><span>${esc(item.name)} <small>${Number(item.quantity)} ${esc(item.unit||'')}</small></span><b>${cash(item.total_cents)}</b></li>`).join('')}</ul>`}
function marketCartMarkup(batch,data){
 const rows=(data.items||[]).map(source=>{const saved=(batch.items||[]).find(item=>item.source_item_id===source.id);return {source,saved}});
 const extras=(batch.items||[]).filter(item=>!item.source_item_id);
 const row=(source,saved)=>`<article class="market-cart-row ${saved?.picked?'in-cart':''}"><button type="button" class="market-cart-check" data-cart-item="${esc(source?.id||saved.id)}" data-cart-extra="${source?'false':'true'}" ${source?.purchased&&!saved?'disabled title="Este item já foi comprado. Para uma compra adicional, adicione outro item."':''} aria-label="${saved?.picked?'Editar item no carrinho':'Adicionar ao carrinho'}: ${esc(source?.name||saved.name)}">${saved?.picked?'✓':'+'}</button><button type="button" class="market-cart-name" data-cart-item="${esc(source?.id||saved.id)}" data-cart-extra="${source?'false':'true'}" ${source?.purchased&&!saved?'disabled':''}><strong>${esc(saved?.name||source.name)}</strong><small>${saved?.picked?'No carrinho':source?.purchased?'Já comprado anteriormente':'Pendente'} · ${Number(saved?.quantity||source?.quantity||1)} ${esc(saved?.unit||source?.unit||'')}</small></button><strong>${cash(saved?.total_cents??source?.totalCents??0)}</strong></article>`;
 return `<section class="market-cart-panel"><div class="section-head"><div><span class="guest-split-badge">COMPRA EM ANDAMENTO</span><h3>Seu carrinho</h3><p>Toque no item para atualizar quantidade, preço e marcar como comprado. Cada salvamento fica online.</p></div><button type="button" class="button secondary small" data-cart-add>Adicionar outro item</button></div><div class="market-cart-totals"><span>${marketPicked(batch).length} itens no carrinho</span><strong>${cash(marketBatchTotal(batch))}</strong></div><div class="market-cart-items">${rows.map(({source,saved})=>row(source,saved)).join('')}${extras.map(saved=>row(null,saved)).join('')||'<p class="help">Sua lista está vazia. Adicione o primeiro item.</p>'}</div><div class="actions"><button type="button" class="button primary" data-cart-checkout>Conferir e finalizar compra</button></div><p class="help">O que não estiver no carrinho continua pendente. A nota fiscal será anexada na finalização ou depois.</p></section>`;
}
function completedBatchMarkup(batch,organizer){
 return `<article class="card completed-market-batch"><div class="section-head"><div><h3>${esc(batch.store_name||'Compra de mercado')}</h3><p>${batch.purchased_on?date(batch.purchased_on):''}${organizer?' · '+esc(batch.buyer_name||'Participante'):''} · ${batch.status==='submitted'?'Aguardando conferência':batch.status==='confirmed'?'Compra confirmada':'Compra recusada'}</p></div><strong>${cash(batch.total_cents)}</strong></div>${marketBatchList(batch)}<p class="help">${batch.paid_from==='fund'?'Dinheiro da caixinha':'Dinheiro de quem comprou · acerto financeiro separado'}</p><div class="record-actions">${batch.receipt_path?`<button class="button secondary small" data-view-purchase-receipt="${esc(batch.receipt_path)}">Ver nota fiscal</button>`:`<button class="button secondary small" data-batch-attach="${esc(batch.id)}">Anexar nota fiscal</button>`}${organizer&&batch.status==='submitted'?`<button class="button primary small" data-batch-review="${esc(batch.id)}" data-batch-approve="true">Aprovar compra inteira</button><button class="button danger small" data-batch-review="${esc(batch.id)}" data-batch-approve="false">Recusar compra</button>`:''}</div></article>`;
}
decoratePurchaseWorkspace=async function(force=false){
 const target=juntoOnline.participantTripId?document.querySelector('#guest-shopping'):db.simplePage==='financeiro'?document.querySelector('#app'):null;
 document.body.classList.remove('market-session-active');if(!target||!juntoOnline.user||!purchaseTripId())return;
 let section=target.querySelector('#purchase-workspace');if(!section){const anchor=target.id==='app'?target.querySelector(':scope > .page-head'):null;const markup='<section class="card purchase-workspace" id="purchase-workspace"><p class="help">Carregando compras…</p></section>';if(anchor)anchor.insertAdjacentHTML('afterend',markup);else target.insertAdjacentHTML('afterbegin',markup);section=target.querySelector('#purchase-workspace')}
 try{
  const data=await loadPurchaseWorkspace(force);if(!data||!section.isConnected)return;const batch=activeMarketBatch();document.body.classList.toggle('market-session-active',Boolean(batch));
  section.innerHTML=`<div class="section-head"><div><h2>Compras de mercado</h2><p>Atualize os itens durante a compra e guarde uma única nota fiscal para o conjunto.</p></div><div class="record-actions"><button type="button" class="button secondary small" data-market-refresh>Atualizar</button>${!batch?'<button type="button" class="button primary small" data-market-start>Iniciar compra</button>':''}</div></div>${batch?marketCartMarkup(batch,data):'<p class="help">Inicie uma compra para usar sua lista no mercado. Os itens anteriores e seus comprovantes continuam preservados.</p>'}<section class="market-completed"><h3>Compras realizadas</h3>${(data.batches||[]).filter(item=>item.status!=='draft').map(item=>completedBatchMarkup(item,data.organizer)).join('')||'<p class="help">Nenhuma compra em conjunto finalizada.</p>'}</section>${data.submissions?.length?`<details><summary>Registros individuais anteriores</summary>${purchaseSubmissionCards(data)}</details>`:''}`;
 }catch(error){if(section.isConnected)section.innerHTML='<p class="notice warn">Não foi possível carregar a compra online. Seu cadastro precisa estar vinculado ao planejamento.</p><button class="button secondary small" data-market-refresh>Tentar novamente</button>'}
};
async function openMarketCartItem(key='',extra=false){
 const data=await loadPurchaseWorkspace(true),batch=activeMarketBatch();if(!data||!batch)return;
 const source=extra?null:(data.items||[]).find(item=>item.id===key),saved=extra?(batch.items||[]).find(item=>item.id===key):(batch.items||[]).find(item=>item.source_item_id===key);
 if(key&&!source&&!saved)return toast('Item não encontrado. Atualize a lista.','error');
 const quantity=Number(saved?.quantity||source?.quantity||1),total=Number(saved?.total_cents??source?.totalCents??0);const lineId=saved?.id||source?.id||crypto.randomUUID();
 modal('Atualizar item da compra','Salvo no seu carrinho online. Os valores oficiais serão atualizados ao confirmar a compra.',`<form id="market-cart-item" data-batch="${esc(batch.id)}" data-version="${batch.revision}" data-line="${esc(lineId)}" data-source="${esc(source?.id||saved?.source_item_id||'')}"><div class="stack">${field('cartName','Item','text',saved?.name||source?.name||'','required maxlength="100"')}<div class="form-grid">${field('cartQuantity','Quantidade','number',quantity,'required min="0.01" max="100000" step="0.01"')}${field('cartUnit','Unidade','text',saved?.unit||source?.unit||'','maxlength="80"')}${field('cartPrice','Preço unitário atual (R$)','number',inputMoney(Math.round(total/quantity)),'required min="0" step="0.01"')}</div><p class="market-line-total">Total deste item: <strong data-cart-line-total>${cash(total)}</strong></p><label class="check"><input name="cartPicked" type="checkbox" ${saved?.picked===false?'':'checked'}> Já coloquei no carrinho / comprado</label><div class="actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary">Salvar item no carrinho</button></div></div></form>`);
}
async function openMarketCheckout(){
 const data=await loadPurchaseWorkspace(true),batch=activeMarketBatch();if(!data||!batch)return;if(!marketPicked(batch).length)return toast('Adicione os itens comprados ao carrinho antes de finalizar.','error');purchaseReceiptFile=null;
 const total=marketBatchTotal(batch);
 modal('Conferir e finalizar compra','Uma única nota fiscal será vinculada a todos os itens abaixo.',`<form id="market-checkout" data-batch="${esc(batch.id)}" data-version="${batch.revision}" data-total="${total}" data-trip="${esc(purchaseTripId())}"><div class="stack">${marketBatchList(batch)}<div class="market-cart-totals"><span>Total dos itens comprados</span><strong>${cash(total)}</strong></div>${field('cartStore','Mercado / nome da compra (opcional)','text','','maxlength="100"')}<div class="form-grid">${field('cartDate','Data da compra','date',today(),'required')}${field('cartInvoiceTotal','Total da nota (R$)','number',inputMoney(total),'required min="0.01" step="0.01"')}</div><p class="help">Se houver diferença, confira os preços dos itens antes de finalizar.</p><label class="field"><span>Origem do dinheiro</span><select name="cartFunds"><option value="personal">Dinheiro de quem comprou · acertar depois</option><option value="fund">Dinheiro da caixinha</option></select></label>${receiptFields()}<p class="help">Você também pode anexar a nota depois, em Compras realizadas. ${data.organizer?'Ao confirmar, a lista oficial será atualizada.':'O conjunto será enviado para conferência do administrador.'} Nenhum reembolso ou pagamento será feito automaticamente.</p><div class="actions"><button type="button" class="button secondary" data-close>Voltar ao carrinho</button><button class="button primary">${data.organizer?'Confirmar compra':'Enviar compra para conferência'}</button></div></div></form>`);
}
async function uploadMarketReceipt(file,remoteId,accountId){
 if(!file)return null;const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'}[file.type];if(!ext||file.size>10485760)throw Error('Use foto ou PDF de até 10 MB.');const path=`${remoteId}/${accountId}/${crypto.randomUUID()}.${ext}`;
 const {error}=await juntoOnline.client.storage.from('shopping-receipts').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;return path;
}
async function refreshAfterMarketChange(official=false){
 purchaseWorkspace=null;
 if(official&&!juntoOnline.participantTripId){const id=purchaseTripId();await loadOnlineTrip(id);db.simplePage='financeiro';db.simpleFinanceTab='mercado';render()}
 else if(official&&juntoOnline.participantTripId)await showParticipantTrip(purchaseTripId());
 await decoratePurchaseWorkspace(true);
}
window.addEventListener('input',event=>{const form=event.target.closest('#market-cart-item');if(!form)return;queueMicrotask(()=>{if(!form.isConnected)return;const total=Math.round(Number(form.elements.cartQuantity.value||0)*cents(form.elements.cartPrice.value||0));form.querySelector('[data-cart-line-total]').textContent=cash(total)})},true);
window.addEventListener('submit',async event=>{
 if(!['market-cart-item','market-checkout','market-batch-receipt'].includes(event.target.id))return;event.preventDefault();event.stopImmediatePropagation();const form=event.target,values=new FormData(form),button=event.submitter,account=juntoOnline.user?.id,remote=purchaseTripId();if(!account)return;if(button)button.disabled=true;
 try{
  if(form.id==='market-cart-item'){
   const quantity=Number(values.get('cartQuantity')),price=cents(values.get('cartPrice'));
   const {error}=await juntoOnline.client.rpc('save_market_purchase_item',{batch_id:form.dataset.batch,expected_revision:Number(form.dataset.version),item:{id:form.dataset.line,source_item_id:form.dataset.source||null,name:values.get('cartName'),quantity,unit:values.get('cartUnit'),total_cents:Math.round(quantity*price),picked:values.has('cartPicked')}});if(error)throw error;
   if(account!==juntoOnline.user?.id||remote!==purchaseTripId())return;closeModal();await refreshAfterMarketChange();toast('Item salvo online no carrinho.');return;
  }
  if(form.id==='market-checkout'){
   if(remote!==form.dataset.trip)return;if(cents(values.get('cartInvoiceTotal'))!==Number(form.dataset.total))return toast('O total da nota não confere com os itens. Confira os preços no carrinho.','error');
   const organizer=purchaseWorkspace?.organizer;if(organizer&&!await syncTripSnapshotById(db.active))return;
   const receipt=await uploadMarketReceipt(purchaseReceiptFile,remote,account);if(account!==juntoOnline.user?.id||remote!==purchaseTripId())return;
   const {error}=await juntoOnline.client.rpc('finalize_market_purchase',{batch_id:form.dataset.batch,expected_revision:Number(form.dataset.version),store_name:values.get('cartStore'),purchase_date:values.get('cartDate'),funds_source:values.get('cartFunds'),invoice_total:cents(values.get('cartInvoiceTotal')),receipt_object:receipt});if(error)throw error;
   if(account!==juntoOnline.user?.id||remote!==purchaseTripId())return;closeModal();purchaseReceiptFile=null;await refreshAfterMarketChange(true);toast(organizer?'Compra inteira confirmada.':'Compra inteira enviada para conferência.');return;
  }
  if(!purchaseReceiptFile)return toast('Escolha a foto ou o PDF da nota fiscal.','error');
  const receipt=await uploadMarketReceipt(purchaseReceiptFile,remote,account);if(account!==juntoOnline.user?.id||remote!==purchaseTripId())return;
  const {error}=await juntoOnline.client.rpc('attach_market_purchase_receipt',{batch_id:form.dataset.batch,receipt_object:receipt});if(error)throw error;
  if(account!==juntoOnline.user?.id||remote!==purchaseTripId())return;closeModal();purchaseReceiptFile=null;await refreshAfterMarketChange();toast('Nota fiscal anexada à compra inteira.');
 }catch(error){marketBatchFailure(error)}finally{if(button?.isConnected)button.disabled=false}
},true);
window.addEventListener('click',async event=>{
 const legacy=event.target.closest('[data-edit-shopping],[data-toggle-shopping],[data-shopping-plus],[data-shopping-minus],[data-add-shopping]');
 if(legacy&&activeMarketBatch()){event.preventDefault();event.stopImmediatePropagation();const id=legacy.dataset.editShopping||legacy.dataset.toggleShopping||legacy.dataset.shoppingPlus||legacy.dataset.shoppingMinus||'';try{await openMarketCartItem(id)}catch(error){marketBatchFailure(error)}return}
 const button=event.target.closest('[data-market-start],[data-market-refresh],[data-cart-item],[data-cart-add],[data-cart-checkout],[data-batch-attach],[data-batch-review]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();button.disabled=true;
 try{
  if(button.matches('[data-market-start]')){if(!juntoOnline.participantTripId&&!await syncTripSnapshotById(db.active))return;const {error}=await juntoOnline.client.rpc('start_market_purchase',{target_trip:purchaseTripId()});if(error)throw error;await refreshAfterMarketChange();return}
  if(button.matches('[data-market-refresh]'))return await decoratePurchaseWorkspace(true);
  if(button.matches('[data-cart-item],[data-cart-add]'))return await openMarketCartItem(button.dataset.cartItem||'',button.dataset.cartExtra==='true');
  if(button.matches('[data-cart-checkout]'))return await openMarketCheckout();
  if(button.matches('[data-batch-attach]')){purchaseReceiptFile=null;modal('Anexar nota fiscal','O arquivo será compartilhado por todos os itens desta compra.',`<form id="market-batch-receipt" data-batch="${esc(button.dataset.batchAttach)}">${receiptFields()}<div class="actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary">Salvar nota fiscal</button></div></form>`);return}
  if(!await syncTripSnapshotById(db.active))return;const {error}=await juntoOnline.client.rpc('review_market_purchase',{batch_id:button.dataset.batchReview,approve:button.dataset.batchApprove==='true'});if(error)throw error;await refreshAfterMarketChange(true);toast(button.dataset.batchApprove==='true'?'Compra inteira aprovada.':'Compra recusada sem alterar os custos.');
 }catch(error){marketBatchFailure(error)}finally{if(button.isConnected)button.disabled=false}
},true);
