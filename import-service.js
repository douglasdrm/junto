'use strict';
/* Núcleo independente de importação. Um adaptador XLSX futuro deve converter a
   planilha em linhas normalizadas e então chamar buildDraft. Nenhuma linha é
   persistida por este módulo. */
window.JuntoImport={
  schemaVersion:2,
  requiredSheets:['PGTOS'],
  requiredFields:['payer','referenceMonth','amountCents','allocations','source'],
  normalize(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()},
  fingerprint(row){return row.source?.workbookId&&row.source?.cell?`${row.trip}|${row.source.workbookId}|${row.source.sheet}|${row.source.cell}`.toLowerCase():[row.trip,row.payer,row.date||'',row.referenceMonth,row.amountCents,row.source?.sheet,row.source?.cell||row.source?.row].join('|').toLowerCase()},
  buildDraft(rows,{tripId,people,existingPayments=[]}={}){
    const errors=[],warnings=[],seen=new Set(existingPayments.map(this.fingerprint.bind(this))),payments=[];
    rows.forEach((row,index)=>{
      const line=index+2,amount=Number(row.amountCents),items=Array.isArray(row.allocations)?row.allocations:[],sum=items.reduce((total,item)=>total+Number(item.amountCents||0),0);
      if(!row.payer||(row.date&&!/^\d{4}-\d{2}-\d{2}$/.test(row.date))||!/^\d{4}-\d{2}$/.test(row.referenceMonth||'')||!Number.isInteger(amount)||amount<=0)errors.push({line,message:'Pagador, competência e valor em centavos são obrigatórios; a data pode permanecer vazia.'});
      if(!items.length)errors.push({line,message:'Alocações ausentes; a importação não pode deduzi-las.'});
      if(sum!==amount)errors.push({line,message:`Alocações (${sum}) diferem do total (${amount}).`});
      items.forEach(item=>{if(!people.some(person=>person.id===item.participantId&&person.trip===tripId))errors.push({line,message:`Participante não encontrado: ${item.participantId}.`})});
      const payment={...row,trip:tripId,source:{type:'xlsx',...row.source},participantIds:items.map(item=>item.participantId)};const key=this.fingerprint(payment);
      if(seen.has(key))warnings.push({line,message:'Possível duplicidade com um pagamento existente.'});else seen.add(key);
      payments.push(payment);
    });
    return {version:2,tripId,payments,errors,warnings,valid:errors.length===0,totals:{rows:rows.length,amountCents:payments.reduce((s,p)=>s+(Number(p.amountCents)||0),0)}};
  },
  monthFromCell(cell){
    if(!cell)return null;const text=this.normalize(cell.w??cell.v),months={jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};
    const detectedYear=text.match(/\b(20\d{2})\b/)?.[1]||String(new Date().getFullYear());
    for(const [key,month] of Object.entries(months))if(text.includes(key))return `${detectedYear}-${String(month).padStart(2,'0')}`;
    if(cell.v instanceof Date)return `${cell.v.getFullYear()}-${String(cell.v.getMonth()+1).padStart(2,'0')}`;
    return null;
  },
  analyzeWorkbook(workbook,{fileName='',fileSize=0,lastModified=0}={}){
    const errors=[],warnings=[],unreadFormulas=[],rows=[],foundPeople=new Set(),monthlyColumns=[];
    const missing=this.requiredSheets.filter(name=>!workbook.SheetNames.includes(name));if(missing.length)errors.push({message:`Abas obrigatórias ausentes: ${missing.join(', ')}.`});
    const sheet=workbook.Sheets.PGTOS;if(!sheet)return {valid:false,errors,warnings,rows,foundPeople:[],unreadFormulas,monthlyColumns,fileName};
    const range=XLSX.utils.decode_range(sheet['!ref']||'A1:A1');
    for(let r=range.s.r;r<=Math.min(range.e.r,30);r++)for(let c=range.s.c;c<=range.e.c;c++){const month=this.monthFromCell(sheet[XLSX.utils.encode_cell({r,c})]);if(month&&!monthlyColumns.some(x=>x.c===c))monthlyColumns.push({c,month,headerCell:XLSX.utils.encode_cell({r,c})})}
    if(!monthlyColumns.length)errors.push({message:'Não foi possível identificar colunas mensais na aba PGTOS.'});
    const workbookId=[fileName,fileSize,lastModified].join(':');
    for(let r=range.s.r;r<=range.e.r;r++){
      const values=[];for(let c=range.s.c;c<(monthlyColumns[0]?.c??range.e.c+1);c++){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(typeof cell?.v==='string'&&cell.v.trim())values.push(cell.v.trim())}
      const payer=values.find(value=>!/(pagamento|participante|nome|competencia|m[eê]s)/i.test(value));if(!payer)continue;const normalized=this.normalize(payer);if(/total|saldo|rendimento|meta|or[cç]amento|acumulado|anterior/.test(normalized))continue;
      const paymentCells=monthlyColumns.map(column=>({column,cell:sheet[XLSX.utils.encode_cell({r,c:column.c})],address:XLSX.utils.encode_cell({r,c:column.c})})).filter(item=>item.cell&&(item.cell.f||item.cell.v!==''&&item.cell.v!=null));
      if(!paymentCells.some(item=>typeof item.cell.v==='number'&&item.cell.v>0)){paymentCells.filter(item=>item.cell.f&&(typeof item.cell.v!=='number'||!Number.isFinite(item.cell.v))).forEach(item=>unreadFormulas.push({cell:item.address,formula:item.cell.f,message:'Fórmula sem resultado numérico armazenado.'}));continue}foundPeople.add(payer);
      paymentCells.forEach(({column,cell,address})=>{
        if(typeof cell.v!=='number'||!Number.isFinite(cell.v)||cell.v<=0){if(cell.f)unreadFormulas.push({cell:address,formula:cell.f,message:'Fórmula sem resultado numérico armazenado.'});return}
        const amountCents=Math.round(cell.v*100),beneficiaries=[payer];beneficiaries.forEach(name=>foundPeople.add(name));
        const parts=beneficiaries.map((name,index)=>({participantName:name,amountCents:Math.floor(amountCents/beneficiaries.length)+(index<amountCents%beneficiaries.length?1:0)}));
        rows.push({payer,date:'',referenceMonth:column.month,amountCents,allocations:parts,source:{type:'xlsx',workbookId,sheet:'PGTOS',cell:address,row:r+1,column:XLSX.utils.encode_col(column.c),formula:cell.f||'',rawValue:cell.v,label:`${fileName} · PGTOS!${address}`}});
      });
    }
    const gross=rows.reduce((sum,row)=>sum+row.amountCents,0);
    return {version:2,fileName,workbookId,valid:errors.length===0,errors,warnings,unreadFormulas,rows,foundPeople:[...foundPeople],monthlyColumns,totalCents:gross,sheetNames:workbook.SheetNames};
  }
};
