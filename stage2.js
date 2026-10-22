'use strict';

/* Etapa 2 funciona sobre o mesmo estado global da aplicação. A migração é aditiva
   e só chega ao localStorage após uma ação explícita do usuário. */
function migrateV3(data){
  data.payments.forEach(payment=>{
    if(!Array.isArray(payment.allocations)){
      const ids=(payment.participantIds||[]).filter(id=>data.people.some(p=>p.id===id&&p.trip===payment.trip));
      const total=Number(payment.amountCents)||0;
      payment.allocations=ids.map((participantId,index)=>({participantId,amountCents:Math.floor(total/Math.max(1,ids.length))+(index<total%Math.max(1,ids.length)?1:0)}));
    }
    payment.participantIds=payment.allocations.map(a=>a.participantId);
    payment.referenceMonth=payment.referenceMonth||(payment.date||'').slice(0,7);
    payment.source=payment.source||{type:'manual',label:'Cadastro no Juntô'};
  });
  data.people.forEach(person=>{
    if(person.contributes==null)person.contributes=true;
    person.familyGroup=person.familyGroup||'';
    person.responsibleId=person.responsibleId||'';
  });
  if(data.financeTab==='contribuicoes')data.financeTab='participantes';
  data.version=3;
  return data;
}
db=migrateV3(db);

const allocations=()=>pays().flatMap(payment=>payment.allocations.map(item=>({...item,paymentId:payment.id,date:payment.date,referenceMonth:payment.referenceMonth,payer:payment.payer})));
const allocatedFor=id=>allocations().filter(a=>a.participantId===id).reduce((sum,a)=>sum+a.amountCents,0);
const paymentMonth=p=>p.referenceMonth||p.date?.slice(0,7)||'';
const monthLabel=value=>value?new Intl.DateTimeFormat('pt-BR',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(value+'-15T12:00:00Z')).replace('.',''):'Sem mês';
const statusFor=(paid,goal,contributes=true)=>!contributes?'Não contribui':paid>=goal?'Quitado':paid>0?'Em andamento':'Não iniciado';

function home(){
  if(!trip())return noTrip();
  const goal=target(),got=received(),out=spent(),future=expenses().reduce((sum,e)=>sum+Math.max(0,e.plannedCents-e.paidCents),0),due=Math.max(0,goal-got),pct=goal?Math.min(100,Math.round(got/goal*100)):0;
  const upcoming=expenses().filter(e=>e.status!=='pago'&&e.date).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
  return head('Seu espaço de viagem','Decisões, caixa e próximos compromissos da viagem em uma única visão.','<button class="button primary" data-new-payment>+ Novo pagamento</button>')+demo()+
  `<section class="hero"><div><small>VIAGEM ATIVA</small><h2>${esc(trip().name)}</h2><p>${esc(trip().region||'Destino a escolher')} · ${trip().start?date(trip().start):'Data a definir'}</p></div><button class="button" data-page="busca">Encontrar uma casa ↗</button></section>
  <div class="grid">${metric('Orçamento total',cash(goal),'Previsto')}${metric('Total arrecadado',cash(got),'Recebido')}${metric('Despesas pagas',cash(out),'Pago')}${metric('Saldo em caixa',cash(got-out),'Recebido menos pago')}${metric('Ainda não recebido',cash(due),'Pendente')}${metric('Compromissos futuros',cash(future),'Previsto menos pago')}${metric('Participantes',people().length,`${people().filter(p=>p.contributes).length} contribuintes`)}${metric('Próximos vencimentos',upcoming.length,'Despesas pendentes')}</div>
  <div class="split">${card('Progresso financeiro',`<div class="progress"><span style="width:${pct}%"></span></div><div class="progress-line"><span>${pct}% arrecadado</span><strong>${cash(due)} pendente</strong></div><div class="actions"><button class="button primary" data-new-payment>Registrar contribuição</button><button class="button secondary" data-add-expense>Registrar despesa</button></div>`)}${card('Próximos vencimentos',upcoming.length?upcoming.map(e=>`<div class="upcoming"><div><strong>${esc(e.description)}</strong><div class="record-meta">${date(e.date)} · ${esc(e.category)}</div></div><strong>${cash(Math.max(0,e.plannedCents-e.paidCents))}</strong></div>`).join(''):empty('✓','Nada pendente','Nenhuma despesa futura foi cadastrada.'))}</div>`;
}

function participantForm(person={}){
  const responsibleOptions=[['','A própria pessoa / não definido'],...people().filter(p=>p.id!==person.id).map(p=>[p.id,p.name])];
  return `<div class="form-grid">${field('name','Nome','text',person.name||'','required maxlength="80"')}${field('familyGroup','Núcleo familiar / grupo','text',person.familyGroup||'','maxlength="80" placeholder="Ex.: Família Silva"')}${select('responsibleId','Responsável financeiro',responsibleOptions,person.responsibleId||'')}${field('target','Meta individual (R$)','number',Number.isInteger(person.targetCents)?inputMoney(person.targetCents):'','min="0" step="0.01"','Vazio usa a meta sugerida da viagem.')}<div class="field full"><label class="check"><input type="checkbox" name="contributes" ${person.contributes!==false?'checked':''}> Participa financeiramente da viagem</label><p class="help">Desmarque para hóspedes que não contribuem diretamente.</p></div></div>`;
}
function participants(){
  if(!trip())return noTrip();
  const list=people().length?people().map(p=>{const responsible=people().find(x=>x.id===p.responsibleId);return `<div class="record"><div><div class="record-title">${esc(p.name)}${p.familyGroup?`<span class="family-tag">${esc(p.familyGroup)}</span>`:''} ${p.demo?'<span class="badge warn">Exemplo</span>':''}</div><div class="record-meta">${p.contributes===false?'Não contribui':`Meta: ${cash(personTarget(p))}`}${responsible?` · Responsável: ${esc(responsible.name)}`:''}</div></div><div class="record-actions"><button class="button ghost small" data-edit-person-v3="${p.id}">Editar</button><button class="button danger small" data-remove="people" data-id="${p.id}" data-label="participante">Excluir</button></div></div>`}).join(''):empty('♙','Nenhum participante','Cadastre hóspedes, contribuintes e responsáveis financeiros.');
  return head('Participantes','Organize hóspedes, núcleos familiares, responsáveis e metas individuais.')+demo()+`<div class="grid">${metric('Hóspedes previstos',trip().guests||0)}${metric('Participantes cadastrados',people().length)}${metric('Pagantes previstos',trip().payers||0)}${metric('Contribuintes marcados',people().filter(p=>p.contributes).length)}</div><div class="split">${card('Pessoas no grupo',list)}${card('Adicionar participante',`<form id="person-v3">${participantForm()}<div class="actions"><button class="button primary">Adicionar participante</button></div></form>`)}</div>`;
}

function finance(){
  if(!trip())return noTrip();
  const tabs=[['participantes','Por participante'],['mensal','Visão mensal'],['evolucao','Evolução'],['resumo','Resumo'],['despesas','Despesas']];
  if(!tabs.some(x=>x[0]===db.financeTab))db.financeTab='participantes';
  const action=db.financeTab==='despesas'?'<button class="button primary" data-add-expense>+ Nova despesa</button>':'<button class="button primary" data-new-payment>+ Novo pagamento</button>';
  const views={participantes:participantFinance,mensal:monthlyFinance,evolucao:evolutionFinance,resumo,despesas:expensesView};
  return head('Financeiro','Uma única fonte de registros para acompanhar pessoas, meses, evolução e caixa.',action)+demo()+`<div class="tabs" role="tablist">${tabs.map(([id,label])=>`<button class="tab ${db.financeTab===id?'selected':''}" data-tab="${id}">${label}</button>`).join('')}</div>${views[db.financeTab]()}`;
}
function participantFinance(){
  const query=(db.financeSearch||'').toLowerCase(),filter=db.financeFilter||'todos';
  const rows=people().filter(p=>p.name.toLowerCase().includes(query)).filter(p=>{const paid=allocatedFor(p.id),goal=personTarget(p);return filter==='todos'||(filter==='quitados'&&paid>=goal)||(filter==='pendentes'&&p.contributes!==false&&paid<goal)||(filter==='nao-contribui'&&p.contributes===false)});
  const content=rows.length?rows.map(p=>{const paid=allocatedFor(p.id),goal=personTarget(p),remaining=Math.max(0,goal-paid),pct=goal?Math.min(100,Math.round(paid/goal*100)):0,status=statusFor(paid,goal,p.contributes);return `<article class="participant-card"><div class="participant-card-top"><div><h3>${esc(p.name)}${p.familyGroup?`<span class="family-tag">${esc(p.familyGroup)}</span>`:''}</h3><div class="record-meta">${status}</div></div><div class="amount">${cash(paid)}</div></div><div class="progress"><span style="width:${pct}%"></span></div><div class="person-values"><span>Meta <strong>${cash(goal)}</strong></span><span>Restante <strong>${cash(remaining)}</strong></span><span><strong>${pct}%</strong></span></div><button class="button ghost small" data-person-history="${p.id}">Ver histórico</button></article>`}).join(''):empty('⌕','Nenhum resultado','Altere a pesquisa ou o filtro para encontrar participantes.');
  const history=pays().length?pays().slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(p=>`<div class="record"><div><div class="record-title">${esc(p.payer)} · ${monthLabel(paymentMonth(p))}</div><div class="record-meta">${date(p.date)} · ${p.allocations.length} beneficiário${p.allocations.length===1?'':'s'}${p.note?' · '+esc(p.note):''}</div></div><div class="record-side"><div class="record-value">${cash(p.amountCents)}</div><div class="record-actions"><button class="button ghost small" data-edit-payment="${p.id}">Editar</button><button class="button danger small" data-remove="payments" data-id="${p.id}" data-label="pagamento">Excluir</button></div></div></div>`).join(''):empty('$','Nenhum pagamento','Use “Novo pagamento” para criar o primeiro lançamento.');
  return `<div class="finance-tools"><div class="field"><label for="finance-search">Pesquisar participante</label><input id="finance-search" type="search" value="${esc(db.financeSearch||'')}" placeholder="Digite um nome"></div><div class="filter-row">${[['todos','Todos'],['pendentes','Pendentes'],['quitados','Quitados'],['nao-contribui','Não contribuem']].map(([id,label])=>`<button class="button ${filter===id?'primary':'secondary'} small" data-finance-filter="${id}">${label}</button>`).join('')}</div></div>${card('Contribuição por participante',content,`${rows.length} pessoa${rows.length===1?'':'s'}`)}<div style="margin-top:16px">${card('Histórico de pagamentos',history,`${pays().length} lançamento${pays().length===1?'':'s'}`)}</div>`;
}
function monthlyFinance(){
  const months=[...new Set(pays().map(paymentMonth).filter(Boolean))].sort();
  if(!months.length)return empty('▦','Sem dados mensais','Registre pagamentos com mês de referência para preencher esta visão.');
  const valueFor=(personId,month)=>allocations().filter(a=>a.participantId===personId&&a.referenceMonth===month).reduce((s,a)=>s+a.amountCents,0);
  const body=people().map(p=>`<tr><td><strong>${esc(p.name)}</strong></td>${months.map(m=>{const value=valueFor(p.id,m);return `<td>${value?`<button class="table-value" data-month-detail="${p.id}|${m}">${cash(value)}</button>`:'—'}</td>`}).join('')}<td><strong>${cash(allocatedFor(p.id))}</strong></td></tr>`).join('');
  const totals=months.map(m=>allocations().filter(a=>a.referenceMonth===m).reduce((s,a)=>s+a.amountCents,0));
  return `<div class="notice info" style="margin-bottom:14px">Toque em um valor para consultar os lançamentos que o originaram.</div><div class="table-wrap" tabindex="0" aria-label="Tabela de contribuições mensais"><table class="finance-table"><thead><tr><th>Participante</th>${months.map(m=>`<th>${monthLabel(m)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td>Total mensal</td>${totals.map(x=>`<td>${cash(x)}</td>`).join('')}<td>${cash(totals.reduce((a,b)=>a+b,0))}</td></tr></tfoot></table></div>`;
}
function evolutionFinance(){
  const months=[...new Set(pays().map(paymentMonth).filter(Boolean))].sort(),monthly=months.map(m=>pays().filter(p=>paymentMonth(p)===m).reduce((s,p)=>s+p.amountCents,0));let run=0;const cumulative=monthly.map(v=>run+=v),max=Math.max(target(),...cumulative,1),points=cumulative.map((v,i)=>`${months.length===1?150:10+i*280/(months.length-1)},${170-v/max*145}`).join(' '),goalY=170-target()/max*145;
  const bars=months.length?months.map((m,i)=>`<div class="bar-column"><strong>${cash(monthly[i])}</strong><i style="height:${Math.max(2,monthly[i]/Math.max(...monthly,1)*130)}px"></i><small>${monthLabel(m)}</small></div>`).join(''):empty('↗','Sem evolução','Os gráficos aparecerão após o primeiro pagamento.');
  return `<div class="chart-grid">${card('Arrecadação acumulada',months.length?`<div class="chart"><svg viewBox="0 0 300 190" role="img" aria-label="Arrecadação acumulada"><line x1="10" x2="290" y1="${goalY}" y2="${goalY}" stroke="#e4be68" stroke-dasharray="5 4"/><polyline points="${points}" fill="none" stroke="var(--brand)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="chart-labels"><span>${monthLabel(months[0])}</span><span>Meta ${cash(target())}</span><span>${monthLabel(months.at(-1))}</span></div></div>`:bars)}${card('Arrecadação por mês',`<div class="bar-chart">${bars}</div>`)}${card('Previsto x realizado',`<div class="person"><div class="person-head"><strong>Meta prevista</strong><strong>${cash(target())}</strong></div><div class="progress"><span style="width:100%"></span></div></div><div class="person"><div class="person-head"><strong>Realizado</strong><strong>${cash(received())}</strong></div><div class="progress"><span style="width:${target()?Math.min(100,received()/target()*100):0}%"></span></div></div>`)}${card('Progresso geral',`<div class="metric">${target()?Math.round(received()/target()*100):0}%</div><p class="help">Todos os gráficos são calculados diretamente dos pagamentos e suas alocações.</p>`)}</div>`;
}

function equalAllocations(ids,total){return ids.map((id,index)=>({participantId:id,amountCents:Math.floor(total/ids.length)+(index<total%ids.length?1:0)}))}
function paymentModal(payment={}){
  const selected=payment.allocations?.map(a=>a.participantId)||[],payerOptions=[['','Selecione'],...people().map(p=>[p.name,p.name])];
  modal(payment.id?'Editar pagamento':'Novo pagamento','Informe o pagamento e distribua-o entre os beneficiários.',`<form id="payment-v3" data-id="${payment.id||''}" data-step="1"><div class="wizard-steps"><i class="wizard-step active"></i><i class="wizard-step"></i><i class="wizard-step"></i></div><div id="payment-step"><div class="form-grid">${select('payer','Pagador',payerOptions,payment.payer||'')}${field('amount','Valor recebido (R$)','number',inputMoney(payment.amountCents),'required min="0.01" step="0.01"')}${field('date','Data','date',payment.date||today(),'required')}${field('referenceMonth','Mês de referência','month',payment.referenceMonth||today().slice(0,7),'required')}<div class="field full"><label>Participantes beneficiados</label><div class="checks">${people().map(p=>`<label class="chip"><input type="checkbox" name="beneficiary" value="${p.id}" ${selected.includes(p.id)?'checked':''}>${esc(p.name)}</label>`).join('')}</div></div>${field('note','Observação','text',payment.note||'','maxlength="240"')}</div><div class="actions"><button type="button" class="button secondary" data-close>Cancelar</button><button type="button" class="button primary" data-payment-next>Distribuir valor →</button></div></div></form>`);
  $('.modal')?.classList.add('wide');
}
function renderAllocationStep(form,payment){
  const formData=new FormData(form),ids=formData.getAll('beneficiary'),total=cents(formData.get('amount'));
  if(!formData.get('payer'))return toast('Selecione o pagador.','error');if(!Number.isInteger(total)||total<=0)return toast('Informe um valor recebido válido.','error');if(!ids.length)return toast('Selecione ao menos um beneficiário.','error');
  const existing=payment?.allocations?.filter(a=>ids.includes(a.participantId)),allocs=existing?.length===ids.length?existing:equalAllocations(ids,total);
  form.dataset.step='2';form.dataset.paymentDraft=JSON.stringify({payer:formData.get('payer'),amountCents:total,date:formData.get('date'),referenceMonth:formData.get('referenceMonth'),note:formData.get('note')});
  $('#payment-step').innerHTML=`<div class="allocation-list"><p class="help">A distribuição igualitária foi sugerida. Ajuste os valores se necessário.</p>${allocs.map(a=>`<div class="allocation-row" data-allocation="${a.participantId}"><div><strong>${esc(people().find(p=>p.id===a.participantId)?.name)}</strong></div>${field('allocation-'+a.participantId,'Valor atribuído (R$)','number',inputMoney(a.amountCents),'required min="0" step="0.01"')}</div>`).join('')}<div class="allocation-total" id="allocation-total"><span>Total distribuído</span><strong></strong></div></div><div class="actions"><button type="button" class="button secondary" data-payment-back>← Voltar</button><button type="button" class="button primary" data-payment-review>Revisar →</button></div>`;updateAllocationTotal();
}
function readAllocationDraft(form){const base=JSON.parse(form.dataset.paymentDraft),items=[...form.querySelectorAll('[data-allocation]')].map(row=>({participantId:row.dataset.allocation,amountCents:cents(row.querySelector('input').value)}));return {...base,allocations:items}}
function updateAllocationTotal(){const form=$('#payment-v3');if(!form||form.dataset.step!=='2')return;const draft=readAllocationDraft(form),sum=draft.allocations.reduce((s,a)=>s+a.amountCents,0),box=$('#allocation-total');box.classList.toggle('invalid',sum!==draft.amountCents);box.querySelector('strong').textContent=`${cash(sum)} de ${cash(draft.amountCents)}`}
function renderReview(form){const draft=readAllocationDraft(form),sum=draft.allocations.reduce((s,a)=>s+a.amountCents,0);if(draft.allocations.some(a=>a.amountCents<0)||sum!==draft.amountCents)return toast(`A distribuição precisa totalizar exatamente ${cash(draft.amountCents)}.`,'error');form.dataset.step='3';form.dataset.paymentDraft=JSON.stringify(draft);$('#payment-step').innerHTML=`<div class="payment-review"><div class="review-line"><span>Pagador</span><strong>${esc(draft.payer)}</strong></div><div class="review-line"><span>Recebido</span><strong>${cash(draft.amountCents)}</strong></div><div class="review-line"><span>Data / referência</span><strong>${date(draft.date)} · ${monthLabel(draft.referenceMonth)}</strong></div>${draft.allocations.map(a=>`<div class="review-line"><span>${esc(people().find(p=>p.id===a.participantId)?.name)}</span><strong>${cash(a.amountCents)}</strong></div>`).join('')}</div><div class="actions"><button type="button" class="button secondary" data-payment-back-allocation>← Ajustar</button><button class="button primary">Confirmar pagamento</button></div>`}

function showOrigins(personId,month=''){const person=people().find(p=>p.id===personId),items=pays().filter(p=>p.allocations.some(a=>a.participantId===personId)&&(!month||paymentMonth(p)===month));modal(`Histórico de ${esc(person?.name)}`,month?monthLabel(month):'Todos os pagamentos atribuídos',items.length?items.map(p=>{const allocation=p.allocations.find(a=>a.participantId===personId);return `<div class="record"><div><div class="record-title">${esc(p.payer)}</div><div class="record-meta">${date(p.date)} · ${monthLabel(paymentMonth(p))} · ${esc(p.source?.label||'Cadastro no Juntô')}</div></div><strong>${cash(allocation.amountCents)}</strong></div>`}).join(''):empty('$','Sem lançamentos','Nenhum pagamento encontrado.'))}

function admin(){return head('Administração','Backups locais e preparação segura para importar a planilha real.')+`<div class="grid">${metric('Esquema de dados','v'+db.version)}${metric('Viagens',db.trips.length)}${metric('Participantes',db.people.length)}${metric('Lançamentos',db.payments.length+db.expenses.length)}</div><div class="split">${card('Exportar ou restaurar backup',`<p class="help">A restauração substitui os dados somente após confirmação explícita.</p><div class="stack" style="margin-top:15px"><button class="button secondary" id="export">Baixar backup JSON</button><div class="field"><label for="import">Restaurar backup JSON</label><input id="import" type="file" accept="application/json,.json"></div></div>`)}${card('Importação da planilha PGTOS',`<div class="import-zone"><strong>Validador de importação preparado</strong><p class="help">O módulo aceita linhas normalizadas, preserva planilha/linha de origem, valida centavos, vínculos, soma das alocações e possíveis duplicidades.</p><div class="import-status"><div class="import-row">✓ Estrutura de prévia e validação</div><div class="import-row">✓ Nenhuma gravação automática</div><div class="import-row">Pendente: leitor XLSX e mapeamento confirmado das fórmulas da planilha real</div></div></div><p class="help" style="margin-top:12px">Não são inferidos beneficiários sem comprovação ou revisão administrativa.</p>`)}</div><div style="margin-top:16px">${card('Privacidade',`<div class="notice">Este protótipo continua sem autenticação ou servidor. Não use dados sensíveis de terceiros.</div><button class="button danger" id="reset" style="margin-top:16px">Restaurar demonstração</button>`)}</div>`}

function personModal(person){modal('Editar participante','Atualize organização, responsabilidade e meta.',`<form id="person-v3-edit" data-id="${person.id}">${participantForm(person)}<div class="actions"><button type="button" class="button secondary" data-close>Cancelar</button><button class="button primary">Salvar alterações</button></div></form>`)}

document.addEventListener('click',event=>{
  if(event.target.closest('[data-new-payment]')){db.page='financeiro';db.financeTab='participantes';paymentModal();return}
  const filter=event.target.closest('[data-finance-filter]');if(filter){db.financeFilter=filter.dataset.financeFilter;render();return}
  const editPerson=event.target.closest('[data-edit-person-v3]');if(editPerson){personModal(db.people.find(p=>p.id===editPerson.dataset.editPersonV3));return}
  const history=event.target.closest('[data-person-history]');if(history){showOrigins(history.dataset.personHistory);return}
  const detail=event.target.closest('[data-month-detail]');if(detail){const [personId,month]=detail.dataset.monthDetail.split('|');showOrigins(personId,month);return}
  const form=$('#payment-v3');if(!form)return;
  if(event.target.closest('[data-payment-next]')){renderAllocationStep(form,db.payments.find(p=>p.id===form.dataset.id));return}
  if(event.target.closest('[data-payment-back]')){paymentModal(db.payments.find(p=>p.id===form.dataset.id)||{});return}
  if(event.target.closest('[data-payment-review]')){renderReview(form);return}
  if(event.target.closest('[data-payment-back-allocation]')){const draft=JSON.parse(form.dataset.paymentDraft),fake={...draft,id:form.dataset.id};paymentModal(fake);setTimeout(()=>renderAllocationStep($('#payment-v3'),fake));return}
});
let financeSearchTimer;
document.addEventListener('input',event=>{if(event.target.id==='finance-search'){db.financeSearch=event.target.value;clearTimeout(financeSearchTimer);financeSearchTimer=setTimeout(()=>{render();const input=$('#finance-search');input?.focus();input?.setSelectionRange(input.value.length,input.value.length)},180)}if(event.target.closest('[data-allocation]'))updateAllocationTotal()});
document.addEventListener('submit',event=>{
  const id=event.target.id;if(!['payment-v3','person-v3','person-v3-edit'].includes(id))return;event.preventDefault();event.stopImmediatePropagation();const formData=new FormData(event.target);
  if(id==='payment-v3'){
    if(event.target.dataset.step!=='3')return;const draft=JSON.parse(event.target.dataset.paymentDraft),existing=db.payments.find(p=>p.id===event.target.dataset.id),duplicate=pays().find(p=>p.id!==existing?.id&&p.payer===draft.payer&&p.date===draft.date&&p.referenceMonth===draft.referenceMonth&&p.amountCents===draft.amountCents);if(duplicate&&!confirm('Já existe um pagamento com mesmo pagador, data, mês e valor. Deseja registrar mesmo assim?'))return;const record={trip:db.active,payer:draft.payer,beneficiary:'Caixa da viagem',amountCents:draft.amountCents,value:draft.amountCents/100,date:draft.date,referenceMonth:draft.referenceMonth,note:draft.note,allocations:draft.allocations,participantIds:draft.allocations.map(a=>a.participantId),source:existing?.source||{type:'manual',label:'Cadastro no Juntô'}};existing?Object.assign(existing,record):db.payments.push({id:uid(),...record});closeModal();commit(existing?'Pagamento atualizado.':'Pagamento registrado.');return;
  }
  const targetValue=formData.get('target')?cents(formData.get('target')):null,data={name:formData.get('name').trim(),familyGroup:formData.get('familyGroup').trim(),responsibleId:formData.get('responsibleId'),targetCents:targetValue,contributes:formData.has('contributes'),share:formData.has('contributes')?1:0};
  if(id==='person-v3')db.people.push({id:uid(),trip:db.active,...data});else Object.assign(db.people.find(p=>p.id===event.target.dataset.id),data);closeModal();commit(id==='person-v3'?'Participante adicionado.':'Participante atualizado.');
},true);

document.addEventListener('click',event=>{const reset=event.target.closest('#reset');if(reset){event.preventDefault();event.stopImmediatePropagation();if(confirm('Apagar todos os dados e restaurar a demonstração?')){db=migrateV3(clone(DEMO));commit('Demonstração restaurada.')}return}const button=event.target.closest('[data-remove="people"]');if(!button)return;const linked=db.payments.some(payment=>payment.trip===db.active&&payment.allocations?.some(a=>a.participantId===button.dataset.id));if(linked){event.preventDefault();event.stopImmediatePropagation();toast('Este participante possui pagamentos vinculados. Remova ou edite esses vínculos primeiro.','error')}},true);

async function importData(file){
  if(!file)return;
  try{const parsed=JSON.parse(await file.text());if(!parsed||!['trips','people','payments','houses'].every(key=>Array.isArray(parsed[key])))throw Error('estrutura incompatível');if(!confirm('Substituir os dados locais pelo backup?'))return;db=migrateV3(migrate(parsed));commit('Backup importado e migrado com sucesso.')}catch(error){toast('Não foi possível importar: '+error.message,'error')}
}

render();
