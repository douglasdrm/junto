'use strict';
/* Read-only export: use the existing allocation and contribution engines. */
let planningSummaryDraft=null;
function planningSummaryAllowed(){return Boolean(trip()&&juntoOnline.user&&!juntoOnline.user.is_anonymous&&!juntoOnline.participantTripId&&activeOnlineLink())}
function buildPlanningSummary(){
 if(!planningSummaryAllowed())throw Error('Abra um planejamento que você administra.');
 const allocation=financeCostAllocation(),members=people(),payers=planPeople(),goals=personContributionGoals(),split=trip().contributionPlan?.mode==='cost_split';
 if(allocation.unallocated.length)throw Error('Há despesas sem pessoas para dividir. Revise os grupos de consumo antes de compartilhar.');
 const categories=new Map();
 expenses().forEach(e=>{const key=e.category==='mercado'?'Mercado':e.category==='aluguel'?'Espaço / hospedagem':e.name||e.description||'Outras despesas';categories.set(key,(categories.get(key)||0)+(Number(e.plannedCents)||0))});
 if(!hasMarketTotal()){const market=tripShopping().filter(e=>e.year===currentShoppingYear()).reduce((s,e)=>s+Number(e.actualTotalCents??((e.quantity||0)*(e.unitPriceCents||0))),0);if(market)categories.set('Mercado',(categories.get('Mercado')||0)+market)}
 const total=[...categories.values()].reduce((a,b)=>a+b,0),quota=payers.map(p=>({name:p.name,cents:goals[p.id]||0})),values=quota.map(p=>p.cents);
 return {name:trip().name||'Encontro',kind:isEventPlan()?'Evento':'Viagem',date:trip().eventDate||trip().start||'',categories:[...categories].map(([name,cents])=>({name,cents})),total,opening:split?Math.min(Math.max(0,openingBalance()),total):0,split,quota,people:members.map(p=>({name:p.name,exempt:p.contributes===false})),payers:payers.length,amount:values.reduce((a,b)=>a+b,0),min:values.length?Math.min(...values):0,max:values.length?Math.max(...values):0,estimated:shoppingPlannedTotal()>0||expenses().some(e=>(e.plannedCents||0)>(e.paidCents||0)),site:location.origin};
}
function summaryRound(ctx,x,y,w,h,r=20){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()}
function summaryLines(ctx,text,max){const words=String(text).split(/\s+/),lines=[];let line='';for(const word of words){if(ctx.measureText(line+' '+word).width>max&&line){lines.push(line);line=word}else line+=(line?' ':'')+word}if(line)lines.push(line);return lines}
async function drawPlanningSummary(model,names=false,quotas=false){
 await document.fonts?.ready;
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),width=1080,pad=64,rows=[...model.categories],list=quotas?model.quota:names?model.people:[],height=850+rows.length*60+list.length*42+(model.opening?64:0);
 canvas.width=width;canvas.height=height;ctx.fillStyle='#F5F7FC';ctx.fillRect(0,0,width,height);
 ctx.fillStyle='#fff';summaryRound(ctx,28,28,width-56,height-56,28);
 ctx.fillStyle='#315DE7';ctx.font='700 22px "Plus Jakarta Sans",sans-serif';ctx.fillText(model.kind.toUpperCase()+' · RESUMO DO GRUPO',pad,90);
 ctx.fillStyle='#222C4C';ctx.font='800 40px "Plus Jakarta Sans",sans-serif';const title=summaryLines(ctx,model.name,width-pad*2);let y=150;for(const line of title){ctx.fillText(line,pad,y);y+=48}
 // Expand rather than shrinking text when event names wrap.
 const extra=(title.length-1)*48;if(extra){const enlarged=await drawPlanningSummaryWithTitleSpace(model,names,quotas,extra);return enlarged}
 return paintPlanningSummary(canvas,ctx,model,rows,list,names,quotas,y);
}
async function drawPlanningSummaryWithTitleSpace(model,names,quotas,extra){const c=document.createElement('canvas'),ctx=c.getContext('2d');c.width=1080;c.height=850+model.categories.length*60+(quotas?model.quota.length:names?model.people.length:0)*42+(model.opening?64:0)+extra;ctx.fillStyle='#F5F7FC';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#fff';summaryRound(ctx,28,28,c.width-56,c.height-56,28);ctx.fillStyle='#315DE7';ctx.font='700 22px "Plus Jakarta Sans",sans-serif';ctx.fillText(model.kind.toUpperCase()+' · RESUMO DO GRUPO',64,90);ctx.fillStyle='#222C4C';ctx.font='800 40px "Plus Jakarta Sans",sans-serif';let y=150;for(const line of summaryLines(ctx,model.name,952)){ctx.fillText(line,64,y);y+=48}return paintPlanningSummary(c,ctx,model,model.categories,quotas?model.quota:names?model.people:[],names,quotas,y)}
async function paintPlanningSummary(canvas,ctx,m,rows,list,names,quotas,y){
 const money=n=>cash(n),left=64,right=1016;
 function row(label,value,strong=false){ctx.font=`${strong?'800':'500'} ${strong?28:24}px "Plus Jakarta Sans",sans-serif`;ctx.fillStyle='#222C4C';ctx.textAlign='left';ctx.fillText(label,left,y,650);ctx.textAlign='right';ctx.fillText(value,right,y,290);ctx.textAlign='left';y+=60}
 ctx.font='500 20px "Plus Jakarta Sans",sans-serif';ctx.fillStyle='#586780';ctx.fillText((m.date?date(m.date)+' · ':'')+'Gerado em '+new Date().toLocaleDateString('pt-BR'),left,y);y+=58;
 rows.forEach(r=>row(r.name,money(r.cents)));row('Total dos custos lançados',money(m.total),true);
 if(m.opening)row('Saldo anterior utilizado','− '+money(m.opening));
 row(m.people.length+' participantes',m.payers+' pagantes');
 ctx.fillStyle='#eef2ff';summaryRound(ctx,48,y-20,984,100,18);y+=17;
 row(m.split?'Valor a dividir':'Contribuições previstas',money(m.amount),true);y+=30;
 ctx.fillStyle='#315DE7';ctx.font='800 28px "Plus Jakarta Sans",sans-serif';
 ctx.fillText(m.payers?(m.min===m.max?money(m.min)+' por pagante':money(m.min)+' a '+money(m.max)+' por pagante'):'Sem pagantes definidos',left,y);y+=40;
 ctx.font='500 18px "Plus Jakarta Sans",sans-serif';ctx.fillStyle='#586780';ctx.fillText(m.estimated?'Resumo parcial: inclui custos previstos.':'Conforme os lançamentos registrados no planejamento.',left,y);y+=30;
 if(m.min!==m.max){ctx.fillText('As cotas respeitam a divisão individual do planejamento.',left,y);y+=30}
 if(list.length){ctx.font='700 20px "Plus Jakarta Sans",sans-serif';ctx.fillText(quotas?'Cotas individuais — valores previstos':'Participantes',left,y);y+=35;ctx.font='500 20px "Plus Jakarta Sans",sans-serif';for(const p of list){ctx.fillText(p.name+(p.exempt?' · Isento':''),left,y,quotas?700:950);if(quotas){ctx.textAlign='right';ctx.fillText(money(p.cents),right,y);ctx.textAlign='left'}y+=42}}
 // Keep branding separate from financial content, without private invitation links.
 const footer=canvas.height-145;ctx.fillStyle='#D8F17A';ctx.fillRect(left,footer-12,952,2);
 try{const logo=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src='assets/brand/junto-logo.svg'});ctx.drawImage(logo,left,footer+12,170,59)}catch{ctx.font='800 32px sans-serif';ctx.fillStyle='#222C4C';ctx.fillText('Juntô',left,footer+48)}
 ctx.fillStyle='#222C4C';ctx.font='700 21px "Plus Jakarta Sans",sans-serif';ctx.fillText('Organize seu próximo encontro com o Juntô.',265,footer+34);ctx.font='500 18px "Plus Jakarta Sans",sans-serif';ctx.fillText('Viagens, festas e reuniões — tudo junto.',265,footer+65);ctx.fillStyle='#315DE7';ctx.fillText(m.site.replace(/^https?:\/\//,''),265,footer+92);
 return canvas;
}
function summaryPdf(canvas){
 const bytes=Uint8Array.from(atob(canvas.toDataURL('image/jpeg',.92).split(',')[1]),c=>c.charCodeAt(0)),enc=new TextEncoder(),parts=[],offsets=[0];let length=0;
 const add=s=>{const b=typeof s==='string'?enc.encode(s):s;parts.push(b);length+=b.length},obj=(n,s)=>{offsets[n]=length;add(n+' 0 obj\n'+s+'\nendobj\n')};
 const w=595.28,h=w*canvas.height/canvas.width;add('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');obj(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
 offsets[4]=length;add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);add(bytes);add('\nendstream\nendobj\n');const stream=`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;obj(5,`<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`);const xref=length;add('xref\n0 6\n0000000000 65535 f \n');for(let i=1;i<=5;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob(parts,{type:'application/pdf'});
}
async function openPlanningSummary(){
 try{const model=buildPlanningSummary();planningSummaryDraft={tripId:db.active,userId:juntoOnline.user.id,model,sequence:0};modal('Compartilhar resumo','Imagem ou PDF com os mesmos valores do planejamento.',`<div class="summary-export"><label class="check"><input type="checkbox" data-summary-names>Incluir nomes dos participantes</label><label class="check"><input type="checkbox" data-summary-quotas>Incluir nomes e cotas individuais</label><p class="help">Não inclui situação de pagamento nem dados de contato. As cotas não são valores que faltam pagar.</p><div data-summary-preview role="status">Preparando prévia…</div><div class="actions"><button type="button" class="button primary" data-summary-save="png">Salvar imagem</button><button type="button" class="button secondary" data-summary-save="pdf">Salvar PDF</button><button type="button" class="button secondary" data-summary-share>Compartilhar imagem</button></div><p class="help" data-summary-status></p></div>`);await refreshPlanningSummary()}catch(e){toast(e.message||'Não foi possível preparar o resumo.','error')}
}
function summaryDraftCurrent(d){return d&&planningSummaryDraft===d&&planningSummaryAllowed()&&db.active===d.tripId&&juntoOnline.user.id===d.userId&&document.querySelector('.summary-export')}
async function refreshPlanningSummary(){const d=planningSummaryDraft;if(!summaryDraftCurrent(d))return;const seq=++d.sequence;const canvas=await drawPlanningSummary(d.model,document.querySelector('[data-summary-names]').checked,document.querySelector('[data-summary-quotas]').checked);if(!summaryDraftCurrent(d)||d.sequence!==seq)return;d.canvas=canvas;const preview=document.querySelector('[data-summary-preview]');preview.replaceChildren(canvas);canvas.setAttribute('aria-label','Prévia do resumo financeiro para compartilhar')}
function decorateSummaryExport(){if(!planningSummaryAllowed())return;const actions=document.querySelector('.planning-hero-actions')||document.querySelector('#app>.page-head .head-actions,#app>.page-head .actions');if(actions&&!actions.querySelector('[data-planning-summary]'))actions.insertAdjacentHTML('beforeend','<button type="button" class="button secondary small" data-planning-summary>Compartilhar resumo</button>')}
const renderBeforeSummaryExport=render;render=function(...args){renderBeforeSummaryExport(...args);planningSummaryDraft=null;decorateSummaryExport()};
window.addEventListener('change',e=>{if(e.target.matches('[data-summary-names],[data-summary-quotas]'))void refreshPlanningSummary().catch(()=>toast('Não foi possível atualizar a prévia.','error'))});
window.addEventListener('click',async e=>{
 const b=e.target.closest('[data-planning-summary],[data-summary-save],[data-summary-share]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();if(b.hasAttribute('data-planning-summary'))return openPlanningSummary();
 const d=planningSummaryDraft;if(!summaryDraftCurrent(d)||!d.canvas)return;b.disabled=true;
 try{await refreshPlanningSummary();if(!summaryDraftCurrent(d))return;const pdf=b.dataset.summarySave==='pdf',blob=pdf?summaryPdf(d.canvas):await new Promise(r=>d.canvas.toBlob(r,'image/png'));if(!blob)throw Error();if(!summaryDraftCurrent(d))return;const file=new File([blob],`resumo-junto.${pdf?'pdf':'png'}`,{type:pdf?'application/pdf':'image/png'});
 if(b.hasAttribute('data-summary-share')&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:d.model.name});return}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);document.querySelector('[data-summary-status]').textContent=b.hasAttribute('data-summary-share')?'Imagem salva. Anexe no WhatsApp para compartilhar.':'Arquivo gerado.';
 }catch(error){if(error.name!=='AbortError')toast('Não foi possível gerar ou compartilhar. Tente salvar a imagem.','error')}finally{if(b.isConnected)b.disabled=false}
},true);
